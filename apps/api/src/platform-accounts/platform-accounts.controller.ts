import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type {
  DisconnectPlatformAccountResponse,
  OAuthCallbackResult,
  PlatformAccountListResponse,
  StartOAuthConnectionResponse
} from "@postbot/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { PlatformAccountsService } from "./platform-accounts.service.js";
import { OperationsService } from "../operations/operations.service.js";

@ApiTags("platform-accounts")
@Controller("platform-accounts")
export class PlatformAccountsController {
  constructor(@Inject(PlatformAccountsService) private readonly accounts: PlatformAccountsService, private readonly operations: OperationsService) {}

  @Get()
  @UseGuards(AccessTokenGuard)
  @ApiOkResponse({ description: "List platform accounts in the authenticated workspace." })
  list(@Req() req: AuthenticatedRequest): Promise<PlatformAccountListResponse> {
    return this.accounts.list(req.auth.workspaceId);
  }

  @Post("youtube/connect")
  @UseGuards(AccessTokenGuard)
  @ApiOkResponse({ description: "Start YouTube OAuth with state and PKCE." })
  startYouTube(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<StartOAuthConnectionResponse> {
    return this.accounts.startYouTube(req.auth.workspaceId, body);
  }

  @Post("instagram/connect")
  @UseGuards(AccessTokenGuard)
  startInstagram(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<StartOAuthConnectionResponse> {
    return this.accounts.startInstagram(req.auth.workspaceId, body);
  }

  @Post("tiktok/connect")
  @UseGuards(AccessTokenGuard)
  startTikTok(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<StartOAuthConnectionResponse> {
    return this.accounts.startTikTok(req.auth.workspaceId, body);
  }

  @Get("youtube/callback")
  @ApiOkResponse({ description: "Complete YouTube OAuth callback." })
  completeYouTube(@Query() query: unknown): Promise<OAuthCallbackResult> {
    return this.accounts.completeYouTube(query);
  }

  @Get("instagram/callback")
  completeInstagram(@Query() query: unknown): Promise<OAuthCallbackResult> {
    return this.accounts.completeInstagram(query);
  }

  @Get("tiktok/callback")
  completeTikTok(@Query() query: unknown): Promise<OAuthCallbackResult> {
    return this.accounts.completeTikTok(query);
  }

  @Post(":platformAccountId/disconnect")
  @UseGuards(AccessTokenGuard)
  @ApiOkResponse({ description: "Revoke and disconnect a platform account." })
  disconnect(
    @Req() req: AuthenticatedRequest,
    @Param("platformAccountId") platformAccountId: string
  ): Promise<DisconnectPlatformAccountResponse> {
    return this.accounts.disconnect(req.auth.workspaceId, platformAccountId).then(async (result) => { await this.operations.audit(req.auth.workspaceId, req.auth.userId, "oauth.disconnect", "platform_account", platformAccountId); return result; });
  }
}
