import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { authCookieNames } from "./auth-cookies.js";
import type { CookieRequest } from "./request-types.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CookieRequest>();
    if (!unsafeMethods.has(request.method)) {
      return true;
    }

    if (request.path === "/auth/register" || request.path === "/auth/login") {
      return true;
    }

    const csrfCookie = request.cookies?.[authCookieNames.csrf];
    const csrfHeader = request.get("x-csrf-token");
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ForbiddenException("요청 보안 토큰이 올바르지 않습니다. 페이지를 새로고침해 주세요.");
    }
    return true;
  }
}
