import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { AutomationService } from "./automation.service.js";

@Controller("automation")
@UseGuards(AccessTokenGuard)
export class AutomationController {
  constructor(@Inject(AutomationService) private readonly automation: AutomationService) {}

  @Get("runs")
  list(@Req() req: AuthenticatedRequest, @Query("channelId") channelId?: string) {
    return this.automation.list(req.auth.workspaceId, channelId);
  }

  @Get("runs/:runId")
  get(@Req() req: AuthenticatedRequest, @Param("runId") runId: string) {
    return this.automation.get(req.auth.workspaceId, runId);
  }

  @Post("runs")
  start(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.automation.start(req.auth.workspaceId, body);
  }

  @Post("budgets")
  setBudget(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.automation.setBudget(req.auth.workspaceId, body);
  }

  @Post("switches")
  setSwitch(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.automation.setSwitch(req.auth.workspaceId, body);
  }

  @Post("runs/:runId/control")
  control(@Req() req: AuthenticatedRequest, @Param("runId") runId: string, @Body() body: unknown) {
    return this.automation.control(req.auth.workspaceId, runId, body);
  }
}
