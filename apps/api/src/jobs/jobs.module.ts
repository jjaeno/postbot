import { Module } from "@nestjs/common";
import { JobsController } from "./jobs.controller.js";
import { JOBS_REPOSITORY } from "./jobs.repository.js";
import { JobsService, QUEUE_ADAPTER, createBullMqQueueAdapter } from "./jobs.service.js";
import { PrismaJobsRepository } from "./prisma-jobs.repository.js";

@Module({
  controllers: [JobsController],
  providers: [
    JobsService,
    {
      provide: JOBS_REPOSITORY,
      useClass: PrismaJobsRepository
    },
    {
      provide: QUEUE_ADAPTER,
      useFactory: createBullMqQueueAdapter
    }
  ],
  exports: [JobsService, JOBS_REPOSITORY]
})
export class JobsModule {}
