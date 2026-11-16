import "dotenv/config";
import "reflect-metadata";
import { BullMqQueueAdapter } from "@postbot/jobs";
import { recoverQueues } from "./queue-recovery.js";
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
  const recoveryQueue = new BullMqQueueAdapter(config.REDIS_URL);
  let recovering = false;
  const recover = async (): Promise<void> => {
    if (recovering) return;
    recovering = true;
    try { await recoverQueues(app.get<PrismaClient>("PRISMA_CLIENT"), recoveryQueue, config.QUEUE_RECOVERY_STALE_AFTER_MS); }
    catch { logger.error("Queue recovery failed; durable jobs retained for the next pass."); }
    finally { recovering = false; }
  };
  const recoveryInterval = setInterval(() => void recover(), 30_000);
  void recover();
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    health.close();
    clearInterval(interval);
    clearInterval(recoveryInterval);
    await recoveryQueue.close();
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
