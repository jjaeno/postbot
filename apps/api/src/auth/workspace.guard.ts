import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "./auth.repository.js";
import type { AuthenticatedRequest } from "./request-types.js";

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const workspaceId = request.params["workspaceId"];
    if (typeof workspaceId !== "string") {
      return true;
    }

    const allowed = await this.repository.hasWorkspaceAccess(request.auth.userId, workspaceId);
    if (!allowed) {
      throw new ForbiddenException("이 워크스페이스에 접근할 권한이 없습니다.");
    }
    return true;
  }
}
