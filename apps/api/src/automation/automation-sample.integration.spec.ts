import "reflect-metadata";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AutomationService } from "./automation.service.js";
import type { JobsService } from "../jobs/jobs.service.js";
import type { OperationsService } from "../operations/operations.service.js";

const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();
suite("wizard sample publishing guard", () => {
  beforeAll(async () => {
    await prisma.policyRule.createMany({
      skipDuplicates: true,
      data: {
        platform: "YOUTUBE", region: "GLOBAL", version: 1,
        effectiveAt: new Date("2020-01-01T00:00:00.000Z"), checkedAt: new Date("2020-01-01T00:00:00.000Z"),
        durationRule: { minSeconds: 30, maxSeconds: 90 }, originalityRule: {}, aiDisclosureRule: {}, rightsRule: {}, restrictedTopics: []
      }
    });
  });
  afterAll(() => prisma.$disconnect());
  it("allows a paused draft sample and cannot publish even in full auto or after an explicit retry", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@sample.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, status: "PAUSED", automationMode: "FULL_AUTO", outputProfiles: { create: { platform: "YOUTUBE" } } } });
    const create = vi.fn(); const recover = vi.fn();
    const service = new AutomationService(prisma, { create, recover } as unknown as JobsService, {} as OperationsService);
    await expect(service.start(workspace.id, { channelId: channel.id, idempotencyKey: `${key}:normal` })).rejects.toThrow("ACTIVE_CHANNEL_NOT_FOUND");
    const run = await service.start(workspace.id, { channelId: channel.id, idempotencyKey: `${key}:sample`, sample: true });
    expect(run.checkpoint).toMatchObject({ sample: true, deficit: 1 });
    await prisma.automationStep.updateMany({ where: { automationRunId: run.id, stage: "PUBLISH" }, data: { status: "HELD", errorCode: "SAMPLE_REVIEW_REQUIRED" } });
    const retried = await service.control(workspace.id, run.id, { action: "retry", stage: "PUBLISH", platform: "YOUTUBE" });
    expect(retried.steps.find((step) => step.stage === "PUBLISH")).toMatchObject({ status: "HELD", errorCode: "SAMPLE_REVIEW_REQUIRED", productionJobId: null });
    expect(create).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
    expect(await prisma.publishPlan.count({ where: { contentItem: { channelId: channel.id } } })).toBe(0);
    await expect(service.completeSampleSetup(workspace.id, run.id)).rejects.toThrow("CONNECTED_PLATFORM_ACCOUNT_REQUIRED");
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe("PAUSED");
  });
});
