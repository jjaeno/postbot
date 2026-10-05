import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { loadConfig } from "@postbot/config";
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
  completeYouTube(@Query() query: unknown, @Headers("accept") accept: string | undefined, @Res({ passthrough: true }) response: Response): Promise<OAuthCallbackResult | undefined> {
    return this.completeBrowserCallback(() => this.accounts.completeYouTube(query), accept, response);
  }

  @Get("instagram/callback")
  completeInstagram(@Query() query: unknown, @Headers("accept") accept: string | undefined, @Res({ passthrough: true }) response: Response): Promise<OAuthCallbackResult | undefined> {
    return this.completeBrowserCallback(() => this.accounts.completeInstagram(query), accept, response);
  }

  @Get("tiktok/callback")
  completeTikTok(@Query() query: unknown, @Headers("accept") accept: string | undefined, @Res({ passthrough: true }) response: Response): Promise<OAuthCallbackResult | undefined> {
    return this.completeBrowserCallback(() => this.accounts.completeTikTok(query), accept, response);
  }

  private async completeBrowserCallback(complete: () => Promise<OAuthCallbackResult>, accept: string | undefined, response: Response): Promise<OAuthCallbackResult | undefined> {
    if (!accept?.includes("text/html")) return complete();
    const target = new URL(loadConfig().WEB_BASE_URL);
    target.hash = "channels";
    try {
      const result = await complete();
      target.searchParams.set("oauth", "connected");
      if (result.account.channelId) target.searchParams.set("channel", result.account.channelId);
    } catch {
      // No authorization code, token or provider error is reflected in the URL.
      target.searchParams.set("oauth", "failed");
    }
    response.redirect(303, target.toString());
    return undefined;
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
