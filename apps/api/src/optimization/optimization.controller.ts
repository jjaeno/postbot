import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { OptimizationService } from "./optimization.service.js";

@Controller("optimization")
@UseGuards(AccessTokenGuard)
export class OptimizationController {
  constructor(@Inject(OptimizationService) private readonly optimization: OptimizationService) {}
  @Get("settings") settings(@Req() req: AuthenticatedRequest, @Query("channelId") channelId: string) { return this.optimization.getSettings(req.auth.workspaceId, channelId); }
  @Post("settings") updateSettings(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.optimization.updateSettings(req.auth.workspaceId, req.auth.workspace.role, req.auth.userId, body); }
  @Post("suggestions/generate") generate(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.optimization.generate(req.auth.workspaceId, body); }
  @Get("suggestions") suggestions(@Req() req: AuthenticatedRequest, @Query("channelId") channelId: string) { return this.optimization.listSuggestions(req.auth.workspaceId, channelId); }
  @Get("channels/:channelId/strategies") strategies(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string) { return this.optimization.listStrategies(req.auth.workspaceId, channelId); }
  @Post("suggestions/:suggestionId/action") suggestionAction(@Req() req: AuthenticatedRequest, @Param("suggestionId") id: string, @Body() body: unknown) { return this.optimization.suggestionAction(req.auth.workspaceId, req.auth.workspace.role, req.auth.userId, id, body); }
  @Post("experiments") createExperiment(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.optimization.createExperiment(req.auth.workspaceId, req.auth.workspace.role, body); }
  @Post("experiments/:experimentId/action") experimentAction(@Req() req: AuthenticatedRequest, @Param("experimentId") id: string, @Body() body: unknown) { return this.optimization.experimentAction(req.auth.workspaceId, req.auth.workspace.role, id, body); }
  @Post("experiments/:experimentId/assign") assignExperiment(@Req() req: AuthenticatedRequest, @Param("experimentId") id: string, @Body() body: unknown) { return this.optimization.assignExperiment(req.auth.workspaceId, id, body); }
  @Post("channels/:channelId/rollback/:version") rollback(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string, @Param("version") version: string) { return this.optimization.rollback(req.auth.workspaceId, req.auth.workspace.role, req.auth.userId, channelId, Number.parseInt(version, 10)); }
}
