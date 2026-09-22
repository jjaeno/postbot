import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { AnalyticsService } from "./analytics.service.js";
@Controller("analytics") @UseGuards(AccessTokenGuard)
export class AnalyticsController { constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {} @Post("sync") sync(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.analytics.sync(req.auth.workspaceId, body); } @Get("report") report(@Req() req: AuthenticatedRequest, @Query() query: { channelId: string; periodStart: string; periodEnd: string; platform?: "YOUTUBE" | "INSTAGRAM" | "TIKTOK" }) { return this.analytics.report(req.auth.workspaceId, query.channelId, query.periodStart, query.periodEnd, query.platform); } }
