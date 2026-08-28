import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { AccessTokenGuard } from "./access-token.guard.js";
import { CsrfGuard } from "./csrf.guard.js";
import { WorkspaceGuard } from "./workspace.guard.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, AccessTokenGuard, CsrfGuard, WorkspaceGuard],
  exports: [AccessTokenGuard, CsrfGuard, WorkspaceGuard]
})
export class AuthModule {}
