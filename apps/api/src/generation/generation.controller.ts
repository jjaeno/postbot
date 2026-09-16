import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { GenerationService } from "./generation.service.js";

@Controller("generation")
@UseGuards(AccessTokenGuard)
export class GenerationController {
  constructor(@Inject(GenerationService) private readonly generation: GenerationService) {}

  @Post("script-scene")
  generate(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.generation.enqueue(req.auth.workspaceId, body);
  }
}
