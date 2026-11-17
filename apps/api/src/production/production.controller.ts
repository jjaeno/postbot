import { Controller, Get, Inject, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { ProductionService } from "./production.service.js";

@Controller("content/:contentItemId/production")
@UseGuards(AccessTokenGuard)
export class ProductionController {
  constructor(@Inject(ProductionService) private readonly production: ProductionService) {}
  @Get() get(@Req() req: AuthenticatedRequest, @Param("contentItemId") id: string, @Query("sceneVersionId") version?: string) {
    return this.production.get(req.auth.workspaceId, id, version);
  }
}
