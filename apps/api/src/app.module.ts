import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { ChannelsModule } from "./channels/channels.module.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { DatabaseModule } from "./database/database.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { IdeasModule } from "./ideas/ideas.module.js";
import { GenerationModule } from "./generation/generation.module.js";
import { PlatformAccountsModule } from "./platform-accounts/platform-accounts.module.js";
import { ReviewModule } from "./review/review.module.js";
import { ContentModule } from "./content/content.module.js";
import { PublishingModule } from "./publishing/publishing.module.js";
import { AutomationModule } from "./automation/automation.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { OptimizationModule } from "./optimization/optimization.module.js";
import { OperationsModule } from "./operations/operations.module.js";

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60
      }
    ]),
    DatabaseModule,
    AuthModule,
    ChannelsModule,
    GenerationModule,
    IdeasModule,
    JobsModule,
    PlatformAccountsModule,
    ReviewModule,
    ContentModule,
    PublishingModule,
    AutomationModule,
    AnalyticsModule,
    OptimizationModule,
    OperationsModule
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard
    }
  ]
})
export class AppModule {}
