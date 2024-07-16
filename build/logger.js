"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = require("winston");
const { combine, timestamp, printf, colorize } = winston_1.format;
const customFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`;
});
const logger = (0, winston_1.createLogger)({
    format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), colorize(), customFormat),
    transports: [
        new winston_1.transports.Console(),
        new winston_1.transports.File({ filename: "combined.log" }),
    ],
});
exports.default = logger;
