import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { ProductionService } from "./production.service.js";

@Controller("automation/runs/:runId/production")
@UseGuards(AccessTokenGuard)
export class ProductionRunsController {
  constructor(@Inject(ProductionService) private readonly production: ProductionService) {}
  @Get() get(@Req() req: AuthenticatedRequest, @Param("runId") id: string) {
    return this.production.forRun(req.auth.workspaceId, id);
  }
}
