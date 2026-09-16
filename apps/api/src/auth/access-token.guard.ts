import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AuthSession } from "@postbot/contracts";
import { AUTH_REPOSITORY, type AuthRepository } from "./auth.repository.js";
import { authCookieNames } from "./auth-cookies.js";
import type { AuthenticatedRequest, CookieRequest } from "./request-types.js";
import { TokenService } from "./token.service.js";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieRequest = request as CookieRequest;
    const accessToken = cookieRequest.cookies?.[authCookieNames.access];
    if (!accessToken) {
      throw new UnauthorizedException("로그인이 필요합니다.");
    }

    const payload = this.tokens.verifyAccessToken(accessToken);
    const session: AuthSession | null = await this.repository.findSessionByUserId(payload.sub);
    if (!session || session.workspace.id !== payload.workspaceId) {
      throw new UnauthorizedException("인증이 만료되었습니다. 다시 로그인해 주세요.");
    }

    request.auth = {
      ...session,
      userId: payload.sub,
      workspaceId: payload.workspaceId
    };
    return true;
  }
}
