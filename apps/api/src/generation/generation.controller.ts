import { Controller, ForbiddenException, Post, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";

@Controller("generation")
@UseGuards(AccessTokenGuard)
export class GenerationController {
  @Post("script-scene")
  generate() {
    throw new ForbiddenException({ code: "DOMAIN_WORKFLOW_REQUIRED", message: "Start production through /automation/runs with an ideaId so budget, platform and cancellation gates apply." });
  }
}
