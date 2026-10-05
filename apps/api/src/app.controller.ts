import { Controller, Get, Inject, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { createHealthResponse, type HealthResponse } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { loadConfig } from "@postbot/config";
import { createRedisConnection } from "@postbot/jobs";

@Controller()
export class AppController implements OnModuleDestroy {
  private readonly config = loadConfig();
  private readonly redis = createRedisConnection(this.config.REDIS_URL);
  @Get("health")
  @SkipThrottle()
  health(): HealthResponse {
    return createHealthResponse("api", "0.1.0");
  }

  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  @Get("ready")
  @SkipThrottle()
  async ready(): Promise<{ status: "ok"; database: "ok"; redis: "ok"; storage: "ok" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
      if (this.config.STORAGE_PROVIDER === "s3") {
        const response = await fetch(this.config.S3_ENDPOINT, { method: "HEAD", signal: AbortSignal.timeout(3_000) });
        if (response.status >= 500) throw new Error("STORAGE_UNAVAILABLE");
      }
      return { status: "ok", database: "ok", redis: "ok", storage: "ok" };
    } catch {
      throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE", message: "One or more required dependencies are unavailable." });
    }
  }

  onModuleDestroy(): void { this.redis.disconnect(); }
}
