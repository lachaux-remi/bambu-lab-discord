import type { Logger } from "pino";
import pino from "pino";

import { APP_DEBUG } from "../../constants";

const REDACTED_LOG_PATHS = [
  "accessCode",
  "*.accessCode",
  "*.*.accessCode",
  "CONFIG_ENCRYPTION_KEY",
  "*.CONFIG_ENCRYPTION_KEY",
  "*.*.CONFIG_ENCRYPTION_KEY",
  "DISCORD_BOT_TOKEN",
  "*.DISCORD_BOT_TOKEN",
  "*.*.DISCORD_BOT_TOKEN",
  "token",
  "*.token",
  "*.*.token",
  "password",
  "*.password",
  "*.*.password",
  "authorization",
  "*.authorization",
  "*.*.authorization",
  "ciphertext",
  "*.ciphertext",
  "*.*.ciphertext",
  "encryptedValue",
  "*.encryptedValue",
  "*.*.encryptedValue"
];

const configuredLogFormat = process.env.LOG_FORMAT?.toLowerCase();
const usePrettyLogs =
  configuredLogFormat === "pretty" ||
  (configuredLogFormat !== "json" && process.env.NODE_ENV !== "production" && process.stdout.isTTY === true);

const logger = pino({
  level: APP_DEBUG ? "debug" : "info",
  redact: { paths: REDACTED_LOG_PATHS, censor: "[REDACTED]" },
  serializers: { error: pino.stdSerializers.err },
  transport: usePrettyLogs
    ? {
        target: "pino-pretty",
        options: {
          colorize: process.stdout.isTTY === true,
          ignore: "pid,hostname",
          translateTime: "SYS:standard"
        }
      }
    : undefined
});

export const getLogger = (name: string): Logger => logger.child({ service: name });
