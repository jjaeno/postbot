import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { OperationsService } from "./operations.service.js";

@Controller("operations")
@UseGuards(AccessTokenGuard)
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}
  @Get("costs") costs(@Req() req: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) { return this.operations.costReport(req.auth.workspaceId, query); }
  @Get("notifications") notifications(@Req() req: AuthenticatedRequest) { return this.operations.listNotifications(req.auth.workspaceId); }
  @Post("notifications/:notificationId/acknowledge") acknowledge(@Req() req: AuthenticatedRequest, @Param("notificationId") id: string) { return this.operations.acknowledge(req.auth.workspaceId, req.auth.userId, id); }
  @Get("audit-logs") audit(@Req() req: AuthenticatedRequest) { return this.operations.listAudit(req.auth.workspaceId); }
  @Post("oauth/rotate-keys") rotateOAuthKeys(@Req() req: AuthenticatedRequest) { return this.operations.rotateOAuthKeys(req.auth.workspaceId, req.auth.userId, req.auth.workspace.role); }
  @Post("data-lifecycle") createLifecycleRequest(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.operations.createLifecycleRequest(req.auth.workspaceId, req.auth.userId, req.auth.workspace.role, body); }
  @Get("data-lifecycle/:requestId") getLifecycleRequest(@Req() req: AuthenticatedRequest, @Param("requestId") requestId: string) { return this.operations.getLifecycleRequest(req.auth.workspaceId, req.auth.userId, requestId); }
}
