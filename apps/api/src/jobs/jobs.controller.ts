import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { JobsService } from "./jobs.service.js";

const writeSse = (response: Response, event: { id: string; data: unknown }): void => {
  response.write(`id: ${event.id}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
};

@Controller("jobs")
@UseGuards(AccessTokenGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.jobs.create(req.auth.workspaceId, body);
  }

  @Get(":jobId")
  get(@Req() req: AuthenticatedRequest, @Param("jobId") jobId: string) {
    return this.jobs.get(req.auth.workspaceId, jobId);
  }

  @Post(":jobId/cancel")
  cancel(@Req() req: AuthenticatedRequest, @Param("jobId") jobId: string) {
    return this.jobs.cancel(req.auth.workspaceId, jobId);
  }

  @Post(":jobId/recover")
  recover(@Req() req: AuthenticatedRequest, @Param("jobId") jobId: string, @Body() body: unknown) {
    return this.jobs.recover(req.auth.workspaceId, jobId, body);
  }

  @Get(":jobId/events")
  async events(
    @Req() req: AuthenticatedRequest,
    @Param("jobId") jobId: string,
    @Res() response: Response
  ): Promise<void> {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    while (!closed) {
      const event = await this.jobs.progressEvent(req.auth.workspaceId, jobId);
      writeSse(response, { id: event.id, data: event });
      if (event.progress === 100) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    response.end();
  }
}
