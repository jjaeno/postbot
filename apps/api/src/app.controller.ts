import { Controller, Get } from "@nestjs/common";
import { createHealthResponse, type HealthResponse } from "@postbot/contracts";

@Controller()
export class AppController {
  @Get("health")
  health(): HealthResponse {
    return createHealthResponse("api", "0.1.0");
  }
}
