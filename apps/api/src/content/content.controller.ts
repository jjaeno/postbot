import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { ContentService } from "./content.service.js";
@Controller("content") @UseGuards(AccessTokenGuard)
export class ContentController { constructor(@Inject(ContentService) private readonly content: ContentService) {} @Get() list(@Req() req: AuthenticatedRequest, @Query("channelId") channelId?: string) { return this.content.list(req.auth.workspaceId, channelId); } }
