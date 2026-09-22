import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { createHealthResponse, type HealthResponse } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";

@Controller()
export class AppController {
  @Get("health")
  health(): HealthResponse {
    return createHealthResponse("api", "0.1.0");
  }

  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  @Get("ready")
  async ready(): Promise<{ status: "ok"; database: "ok" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok" };
    } catch {
      throw new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE", message: "Database dependency is unavailable." });
    }
  }
}
