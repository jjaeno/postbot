import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthResponse, AuthSession } from "@postbot/contracts";
import { AccessTokenGuard } from "./access-token.guard.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest, CookieRequest } from "./request-types.js";
import { WorkspaceGuard } from "./workspace.guard.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  @ApiOkResponse({ description: "회원가입 후 보안 쿠키를 설정합니다." })
  register(
    @Body() body: unknown,
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: Response
  ): Promise<AuthResponse> {
    return this.auth.register(body, req, res);
  }

  @Post("login")
  @ApiOkResponse({ description: "로그인 후 access/refresh 쿠키를 설정합니다." })
  login(
    @Body() body: unknown,
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: Response
  ): Promise<AuthResponse> {
    return this.auth.login(body, req, res);
  }

  @Post("refresh")
  @ApiOkResponse({ description: "refresh token을 회전하고 새 access token을 발급합니다." })
  refresh(@Req() req: CookieRequest, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    return this.auth.refresh(req, res);
  }

  @Post("logout")
  @ApiOkResponse({ description: "현재 refresh token을 폐기하고 쿠키를 지웁니다." })
  logout(@Req() req: CookieRequest, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    return this.auth.logout(req, res);
  }

  @Get("me")
  @UseGuards(AccessTokenGuard)
  @ApiOkResponse({ description: "현재 로그인한 사용자와 기본 워크스페이스를 반환합니다." })
  me(@Req() req: AuthenticatedRequest): Promise<AuthSession> {
    return this.auth.me(req.auth.userId);
  }

  @Get("workspaces/:workspaceId/access-check")
  @UseGuards(AccessTokenGuard, WorkspaceGuard)
  @ApiOkResponse({ description: "워크스페이스 접근 권한 guard 확인용 엔드포인트입니다." })
  accessCheck(@Req() req: AuthenticatedRequest): AuthSession {
    return req.auth;
  }
}
