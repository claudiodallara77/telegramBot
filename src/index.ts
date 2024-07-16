// Importa i moduli necessari e configura dotenv per la gestione delle variabili d'ambiente
const dotenv = require("dotenv");
dotenv.config({ path: "./config.env" });

const express = require("express");
const app = express();
const cron = require("node-cron");
const { Telegraf, Context } = require("telegraf");

// Importa le route e le funzioni utility
import groupLimitRoutes from "./routes/groupLimitRoutes";
import { getParticipantsCount } from "./utils/getMemberCount";
import { calculateMessageSizeKB } from "./utils/getKbSize";
import { GroupStats } from "./types/types";
import { getTypemessages } from "./utils/getTypeMessage";
import { initializeGroupStats } from "./utils/statsUtils";
import { isBotAdmin } from "./utils/isBotAdmin";
import { updateStats } from "./utils/updateStats";
import { sendEmptyReport, sendReport } from "./utils/reportUtils";
import { getAdminIds } from "./utils/getAdminsIds";
import {
  startCommand,
  helpCommand,
  limitCommand,
  statsCommand,
  getAdminsCommand,
} from "./botCommands";

// Inizializza il bot di Telegraf con il token specificato nelle variabili d'ambiente
const bot = new Telegraf(process.env.BOT_TOKEN);
const bodyParser = require("body-parser");

// Configura il body parser per elaborare i dati JSON delle richieste
app.use(bodyParser.json());

// Oggetti per memorizzare statistiche e limiti dei gruppi
let groupStats: Record<string, GroupStats> = {};
let groupLimitGeneric: Record<string, number> = {};

// Configura i comandi del bot con i rispettivi handler
bot.start(startCommand);
bot.help(helpCommand);
bot.command("get_admins", getAdminsCommand);
bot.command("stats", (ctx: typeof Context) => statsCommand(ctx, groupStats));
bot.command("limits", (ctx: typeof Context) =>
  limitCommand(ctx, groupLimitGeneric)
);

// Intercetta i messaggi del bot
bot.on("message", async (ctx: typeof Context, next: () => void) => {
  const chatId = ctx.message?.chat?.id;
  const chatType = ctx.message?.chat?.type;

  // Inizializza le statistiche del gruppo se necessario
  if (!groupStats[chatId as string] && chatType === "supergroup") {
    initializeGroupStats(chatId as string, groupStats);
  }

  const isAdmin = await isBotAdmin(ctx);

  // Aggiorna le statistiche del gruppo se il bot è amministratore e il gruppo è registrato
  if (isAdmin && groupStats[chatId as string]) {
    const messageSizeKB = parseFloat(
      calculateMessageSizeKB(ctx.message).toString()
    );

    const typeOfMessage = getTypemessages(ctx.message);

    // Aggiorna le statistiche del gruppo in base al messaggio ricevuto
    updateStats(chatId as string, messageSizeKB, typeOfMessage, groupStats);

    // Verifica se il messaggio supera il limite generico impostato
    const genericLimitReached =
      groupLimitGeneric[chatId as string] &&
      messageSizeKB > groupLimitGeneric[chatId as string];

    // Elimina il messaggio se supera il limite e notifica il gruppo
    if (genericLimitReached) {
      ctx.deleteMessage();
      ctx.reply(
        `Il messaggio è stato rimosso perché supera il limite di dimensione generico di ${groupLimitGeneric[chatId]} KB impostato per il gruppo.`
      );
    }
  } else {
    console.log(`Il bot con ID ${bot.botInfo.id} non è più un amministratore.`);
  }

  next(); // Passa il controllo al middleware successivo
});

// Avvia il bot e lo rende pronto a ricevere messaggi
bot.launch();

// Configura le rotte per la gestione delle richieste HTTP
app.use(groupLimitRoutes);

// Configura il server Express per ascoltare le richieste sulla porta specificata
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  // Pianifica il job cron per inviare report ogni 5 min
  cron.schedule("*/5 * * * *", async () => {
    console.log("Object.keys(groupStats)", Object.keys(groupStats));
    console.log(
      "(Object.keys(groupStats).length > 0)",
      Object.keys(groupStats).length > 0
    );
    if (Object.keys(groupStats).length > 0) {
      const chatInfos: { [key: string]: any } = {}; // Mappa chatId a chatInfo

      for (const chatId in groupStats) {
        if (groupStats.hasOwnProperty(chatId)) {
          const chatInfo = await bot.telegram.getChat(chatId);

          chatInfos[chatId] = {
            title: chatInfo.title,
            membersCount: await getParticipantsCount(chatId),
            adminIds: await getAdminIds(chatId, bot),
          };
        }
      }

      // Invia il report con le statistiche aggregate
      await sendReport(groupStats, chatInfos);
    } else {
      console.log("Nessun dato da inviare.");

      // Invia un report vuoto per ogni chat
      const allChats = await bot.telegram.getMyCommands();
      for (const chat of allChats) {
        const chatId = chat.chat.id;
        const chatInfo = await bot.telegram.getChat(chatId);
        await sendEmptyReport(chatId, chatInfo);
      }
    }
  });
});
