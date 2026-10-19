import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { assertOperationalConfig, loadConfig } from "@postbot/config";
import { createLogger } from "@postbot/logger";
import { WorkerModule } from "./worker.module.js";
import * as Sentry from "@sentry/node";
import type { WorkerAdapter } from "@postbot/jobs";
import { startWorkerHealthServer } from "./health-server.js";
import type { PrismaClient } from "@postbot/database";

const keepAlive = (): NodeJS.Timeout => setInterval(() => undefined, 60_000);

const bootstrap = async (): Promise<void> => {
  const config = loadConfig();
  assertOperationalConfig(config);
  if (config.SENTRY_DSN) {
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.SENTRY_ENVIRONMENT });
  }
  const logger = createLogger("postbot-worker");
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const interval = keepAlive();
  const workers = app.get<WorkerAdapter>("JOB_WORKERS");
  const maintenance = app.get<WorkerAdapter | null>("MAINTENANCE_WORKER");
  const health = startWorkerHealthServer(async () => await workers.isHealthy() && (!maintenance || await maintenance.isHealthy()));
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    health.close();
    clearInterval(interval);
    await app.close();
    await app.get<PrismaClient>("PRISMA_CLIENT").$disconnect();
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
