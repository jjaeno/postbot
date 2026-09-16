import { Module } from "@nestjs/common";
import { createPrismaClient } from "@postbot/database";
import { createBullMqWorkers } from "@postbot/jobs";
import { loadConfig } from "@postbot/config";
import { DeterministicJobProcessor } from "./job-processor.js";

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
        return createBullMqWorkers(loadConfig().REDIS_URL, (job) => processor.process(job.data));
      }
    }
  ]
})
export class WorkerModule {}
