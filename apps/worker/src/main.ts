import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "@postbot/config";
import { createLogger } from "@postbot/logger";
import { WorkerModule } from "./worker.module.js";
import * as Sentry from "@sentry/node";

const keepAlive = (): NodeJS.Timeout => setInterval(() => undefined, 60_000);

const bootstrap = async (): Promise<void> => {
  const config = loadConfig();
  if (config.SENTRY_DSN) {
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.SENTRY_ENVIRONMENT });
  }
  const logger = createLogger("postbot-worker");
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const interval = keepAlive();

  const shutdown = async (): Promise<void> => {
    clearInterval(interval);
    await app.close();
    logger.info("Worker stopped");
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  logger.info({ environment: config.APP_ENV }, "Worker started");
};

await bootstrap();
