import { Module } from "@nestjs/common";
import { IdeasController } from "./ideas.controller.js";
import { IDEAS_REPOSITORY } from "./ideas.repository.js";
import { IdeasService } from "./ideas.service.js";
import { PrismaIdeasRepository } from "./prisma-ideas.repository.js";
import { TopicSourceProviderFactory } from "./topic-source-provider.factory.js";

@Module({
  controllers: [IdeasController],
  providers: [
    IdeasService,
    TopicSourceProviderFactory,
    {
      provide: IDEAS_REPOSITORY,
      useClass: PrismaIdeasRepository
    }
  ]
})
export class IdeasModule {}
