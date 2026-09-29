import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";
import { JobsModule } from "../jobs/jobs.module.js";
@Module({ imports: [JobsModule], controllers: [AnalyticsController], providers: [AnalyticsService] }) export class AnalyticsModule {}
