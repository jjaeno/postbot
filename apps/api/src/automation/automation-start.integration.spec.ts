import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AutomationService } from "./automation.service.js";
import type { JobsService } from "../jobs/jobs.service.js";
import type { OperationsService } from "../operations/operations.service.js";

const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("scheduler and manual start concurrency", () => {
  afterAll(() => prisma.$disconnect());
  it("reuses one active run even when the callers have different idempotency keys", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@automation-start.test`, displayName: "Start fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Start fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Start fixture", slug: key, outputProfiles: { create: { platform: "YOUTUBE" } } } });
    const service = new AutomationService(prisma, {} as JobsService, {} as OperationsService);
    // Missing collection setup intentionally holds the single run before any queue work.
    const runs = await Promise.all([service.start(workspace.id, { channelId: channel.id, idempotencyKey: `manual:${key}` }), service.start(workspace.id, { channelId: channel.id, idempotencyKey: `scheduler:${key}` })]);
    expect(runs[0]?.id).toBe(runs[1]?.id);
    expect(await prisma.automationRun.count({ where: { channelId: channel.id } })).toBe(1);
  });
});
