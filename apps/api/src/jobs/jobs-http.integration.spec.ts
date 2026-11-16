import "reflect-metadata";
import { type ExecutionContext, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { JobsController } from "./jobs.controller.js";
import { JobsService } from "./jobs.service.js";
import { PrismaJobsRepository } from "./prisma-jobs.repository.js";
import { GenerationController } from "../generation/generation.controller.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("job HTTP authorization boundary", () => {
  const prisma = new PrismaClient(); let app: INestApplication;
  const service = new JobsService(new PrismaJobsRepository(prisma), { enqueue: () => Promise.resolve(), cancel: () => Promise.resolve(), close: () => Promise.resolve() });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [JobsController, GenerationController], providers: [{ provide: JobsService, useValue: service }] })
      .overrideGuard(AccessTokenGuard).useValue({ canActivate: (context: ExecutionContext) => { context.switchToHttp().getRequest<{ auth: { workspaceId: string } }>().auth = { workspaceId: "isolated-other-workspace" }; return true; } }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
  it("rejects injected publish, analytics and automation instructions without creating jobs", async () => {
    const prefix = `http-negative-${randomUUID()}`;
    for (const type of ["PUBLISH", "ANALYTICS", "ASSET", "TTS", "SCRIPT", "RENDER", "COLLECT", "POLICY"]) {
      await request(app.getHttpServer() as Server).post("/jobs").send({ type, idempotencyKey: `${prefix}-${type}`, channelId: "foreign", contentItemId: "foreign", payload: { automation: { runId: "foreign" }, deterministicBehavior: "success", publish: { publishPlanId: "foreign" } } }).expect(403);
    }
    expect(await prisma.productionJob.count({ where: { idempotencyKey: { startsWith: prefix } } })).toBe(0);
    await request(app.getHttpServer() as Server).post("/generation/script-scene").send({ ideaId: "foreign", idempotencyKey: prefix }).expect(403);
  });
  it("does not disclose, cancel or recover another workspace job", async () => {
    const job = await prisma.productionJob.create({ data: { type: "COLLECT", queueName: "collect", idempotencyKey: randomUUID(), payload: {} } });
    await request(app.getHttpServer() as Server).get(`/jobs/${job.id}`).expect(404);
    await request(app.getHttpServer() as Server).post(`/jobs/${job.id}/cancel`).expect(404);
    await request(app.getHttpServer() as Server).post(`/jobs/${job.id}/recover`).send({}).expect(403);
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
  });
});
