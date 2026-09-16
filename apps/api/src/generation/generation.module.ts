import { Module } from "@nestjs/common";
import { GenerationController } from "./generation.controller.js";
import { GENERATION_REPOSITORY } from "./generation.repository.js";
import { GenerationService } from "./generation.service.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";
import { PrismaGenerationRepository } from "./prisma-generation.repository.js";
import { JobsModule } from "../jobs/jobs.module.js";

@Module({
  imports: [JobsModule],
  controllers: [GenerationController],
  providers: [
    GenerationService,
    LlmProviderFactory,
    {
      provide: GENERATION_REPOSITORY,
      useClass: PrismaGenerationRepository
    }
  ]
})
export class GenerationModule {}
