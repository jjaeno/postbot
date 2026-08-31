import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { IdeasService } from "./ideas.service.js";

@Controller("ideas")
@UseGuards(AccessTokenGuard)
export class IdeasController {
  constructor(@Inject(IdeasService) private readonly ideas: IdeasService) {}

  @Post("collect")
  collect(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.ideas.collect(req.auth.workspaceId, body);
  }

  @Get("channels/:channelId")
  list(
    @Req() req: AuthenticatedRequest,
    @Param("channelId") channelId: string,
    @Query("status") status: string | undefined
  ) {
    return this.ideas.list(req.auth.workspaceId, channelId, status);
  }

  @Patch(":ideaId/status")
  updateStatus(@Req() req: AuthenticatedRequest, @Param("ideaId") ideaId: string, @Body() body: unknown) {
    return this.ideas.updateStatus(req.auth.workspaceId, ideaId, body);
  }
}
