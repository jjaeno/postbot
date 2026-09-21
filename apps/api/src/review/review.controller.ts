import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { ReviewService } from "./review.service.js";
@Controller("content/:contentItemId/review")
@UseGuards(AccessTokenGuard)
export class ReviewController {
  constructor(@Inject(ReviewService) private readonly review: ReviewService) {}
  @Get() get(@Req() req: AuthenticatedRequest, @Param("contentItemId") id: string) { return this.review.get(req.auth.workspaceId, id); }
  @Post("policy-check") check(@Req() req: AuthenticatedRequest, @Param("contentItemId") id: string, @Body() body: unknown) { return this.review.check(req.auth.workspaceId, id, body); }
  @Post("action") action(@Req() req: AuthenticatedRequest, @Param("contentItemId") id: string, @Body() body: unknown) { return this.review.action(req.auth.workspaceId, id, body); }
}
