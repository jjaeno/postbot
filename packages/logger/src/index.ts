import pino from "pino";

export const createLogger = (name: string) =>
  pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "authorization",
        "cookie",
        "accessToken",
        "refreshToken",
        "apiKey",
        "password"
      ],
      censor: "[REDACTED]"
    }
  });

export type PostbotLogger = ReturnType<typeof createLogger>;
