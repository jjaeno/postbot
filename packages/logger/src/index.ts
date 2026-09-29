import pino from "pino";
import { AsyncLocalStorage } from "node:async_hooks";

export type LogContext = { correlationId?: string; jobId?: string; workspaceId?: string; channelId?: string; contentItemId?: string; provider?: string };
const logContext = new AsyncLocalStorage<LogContext>();
export const runWithLogContext = <Result>(context: LogContext, callback: () => Result): Result => logContext.run({ ...logContext.getStore(), ...context }, callback);
export const getLogContext = (): LogContext => logContext.getStore() ?? {};

export const createLogger = (name: string) =>
  pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    mixin: () => getLogContext(),
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "authorization",
        "cookie",
        "accessToken",
        "refreshToken",
        "apiKey",
        "password",
        "encryptedAccessToken",
        "encryptedRefreshToken",
        "encryptedCodeVerifier",
        "providerResponse",
        "req.body"
      ],
      censor: "[REDACTED]"
    }
  });

export type PostbotLogger = ReturnType<typeof createLogger>;
