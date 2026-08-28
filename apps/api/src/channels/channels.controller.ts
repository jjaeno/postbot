import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { ChannelListResponse, ChannelResponse } from "@postbot/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { ChannelsService } from "./channels.service.js";

@ApiTags("channels")
@UseGuards(AccessTokenGuard)
@Controller("channels")
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  @Get()
  @ApiOkResponse({ description: "List channels for the authenticated workspace." })
  list(@Req() req: AuthenticatedRequest): Promise<ChannelListResponse> {
    return this.channels.list(req.auth.workspaceId);
  }

  @Post()
  @ApiOkResponse({ description: "Create a channel from the eight-step wizard payload." })
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<ChannelResponse> {
    return this.channels.create(req.auth.workspaceId, body);
  }

  @Get(":channelId")
  @ApiOkResponse({ description: "Return one channel scoped to the authenticated workspace." })
  get(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string): Promise<ChannelResponse> {
    return this.channels.get(req.auth.workspaceId, channelId);
  }

  @Patch(":channelId")
  @ApiOkResponse({ description: "Update channel settings." })
  update(
    @Req() req: AuthenticatedRequest,
    @Param("channelId") channelId: string,
    @Body() body: unknown
  ): Promise<ChannelResponse> {
    return this.channels.update(req.auth.workspaceId, channelId, body);
  }

  @Post(":channelId/pause")
  @ApiOkResponse({ description: "Pause channel automation." })
  pause(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string): Promise<ChannelResponse> {
    return this.channels.setStatus(req.auth.workspaceId, channelId, "PAUSED");
  }

  @Post(":channelId/resume")
  @ApiOkResponse({ description: "Resume channel automation." })
  resume(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string): Promise<ChannelResponse> {
    return this.channels.setStatus(req.auth.workspaceId, channelId, "ACTIVE");
  }

  @Put(":channelId/platform-accounts/:platformAccountId")
  @ApiOkResponse({ description: "Assign one existing platform account to one channel." })
  assignPlatformAccount(
    @Req() req: AuthenticatedRequest,
    @Param("channelId") channelId: string,
    @Param("platformAccountId") platformAccountId: string
  ): Promise<{ ok: true }> {
    return this.channels.assignPlatformAccount(req.auth.workspaceId, channelId, platformAccountId);
  }
}
