import { Module } from "@nestjs/common";
import { createPrismaClient } from "@postbot/database";
import { JobQueueNameSchema, createBullMqWorkers, createMaintenanceWorker } from "@postbot/jobs";
import { loadConfig } from "@postbot/config";
import { DeterministicJobProcessor } from "./job-processor.js";
import { runWithLogContext } from "@postbot/logger";
import * as Sentry from "@sentry/node";
import { DataLifecycleProcessor } from "./data-lifecycle-processor.js";

@Module({
  providers: [
    {
      provide: "PRISMA_CLIENT",
      useFactory: () => createPrismaClient()
    },
    {
      provide: "JOB_WORKERS",
      inject: ["PRISMA_CLIENT"],
      useFactory: (prisma: ReturnType<typeof createPrismaClient>) => {
        const processor = new DeterministicJobProcessor(prisma);
        const config = loadConfig();
        const queueNames = config.WORKER_QUEUES.split(",").map((value) => JobQueueNameSchema.parse(value.trim()));
        return createBullMqWorkers(config.REDIS_URL, (job) => {
          const trace = job.data.payload._trace;
          const value = trace && typeof trace === "object" && !Array.isArray(trace) ? trace as Record<string, unknown> : {};
          return runWithLogContext({ correlationId: typeof value.correlationId === "string" ? value.correlationId : undefined, jobId: job.data.id, channelId: typeof value.channelId === "string" ? value.channelId : undefined, contentItemId: typeof value.contentItemId === "string" ? value.contentItemId : undefined }, async () => {
            try { await processor.process(job.data); }
            catch (error) { Sentry.captureException(error); throw error; }
          });
        }, queueNames);
      }
    },
    {
      provide: "MAINTENANCE_WORKER",
      inject: ["PRISMA_CLIENT"],
      useFactory: (prisma: ReturnType<typeof createPrismaClient>) => {
        const config = loadConfig();
        if (!config.MAINTENANCE_WORKER_ENABLED) return null;
        const processor = new DataLifecycleProcessor(prisma);
        return createMaintenanceWorker(config.REDIS_URL, async (job) => {
          try { await processor.process(job.data.requestId); }
          catch (error) { Sentry.captureException(error); throw error; }
        });
      }
    }
  ]
})
export class WorkerModule {}
