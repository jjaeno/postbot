import { Module } from "@nestjs/common"; import { JobsModule } from "../jobs/jobs.module.js"; import { PublishingController } from "./publishing.controller.js"; import { PublishingService } from "./publishing.service.js";
@Module({ imports: [JobsModule], controllers: [PublishingController], providers: [PublishingService] }) export class PublishingModule {}
