import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AutomationService } from "./automation.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import { PrismaJobsRepository } from "../jobs/prisma-jobs.repository.js";
import type { QueueAdapter } from "@postbot/jobs";
import type { OperationsService } from "../operations/operations.service.js";

const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("scheduler and manual start concurrency", () => {
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
  it("rejects invalid policy duration before creating jobs and restores all legacy duplicate circuit breakers", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@preflight.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, outputProfiles: { create: { platform: "YOUTUBE", minDurationSeconds: 15, maxDurationSeconds: 55 } } } });
    const operations = { audit: vi.fn() } as unknown as OperationsService;
    const service = new AutomationService(prisma, {} as JobsService, operations);
    await expect(service.start(workspace.id, { channelId: channel.id, idempotencyKey: key })).rejects.toMatchObject({ response: { code: "OUTPUT_DURATION_POLICY_CONFLICT" } });
    expect(await prisma.productionJob.count({ where: { channelId: channel.id } })).toBe(0);
    expect(await prisma.automationRun.count({ where: { channelId: channel.id } })).toBe(0);
    await prisma.automationSwitch.createMany({ data: [{ workspaceId: workspace.id, provider: null, isEnabled: false }, { workspaceId: workspace.id, provider: null, isEnabled: true }] });
    expect(await service.listSwitches(workspace.id)).toMatchObject([{ provider: null, isEnabled: false }]);
    await expect(service.setSwitch(workspace.id, { provider: null, isEnabled: true }, "EDITOR", user.id)).rejects.toThrow("OWNER_ROLE_REQUIRED");
    await Promise.all([service.setSwitch(workspace.id, { provider: null, isEnabled: true }, "OWNER", user.id), service.setSwitch(workspace.id, { provider: null, isEnabled: true }, "OWNER", user.id)]);
    expect(await prisma.automationSwitch.count({ where: { workspaceId: workspace.id, provider: null, isEnabled: false } })).toBe(0);
    expect(await service.listSwitches("foreign-workspace")).toEqual([]);
  });
  it("reuses one active run even when the callers have different idempotency keys", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@automation-start.test`, displayName: "Start fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Start fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Start fixture", slug: key, outputProfiles: { create: { platform: "YOUTUBE", minDurationSeconds: 35, maxDurationSeconds: 55 } } } });
    const service = new AutomationService(prisma, {} as JobsService, {} as OperationsService);
    // Missing collection setup intentionally holds the single run before any queue work.
    const runs = await Promise.all([service.start(workspace.id, { channelId: channel.id, idempotencyKey: `manual:${key}` }), service.start(workspace.id, { channelId: channel.id, idempotencyKey: `scheduler:${key}` })]);
    expect(runs[0]?.id).toBe(runs[1]?.id);
    expect(await prisma.automationRun.count({ where: { channelId: channel.id } })).toBe(1);
  });
  it("links the automation step before a fast worker can finish the queued job", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@automation-start.test`, displayName: "Start fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Start fixture", slug: key } });
    const channel = await prisma.channel.create({ data: {
      workspaceId: workspace.id, name: "Start fixture", slug: key,
      outputProfiles: { create: { platform: "YOUTUBE", minDurationSeconds: 35, maxDurationSeconds: 55 } },
      collectionRules: { create: { keywords: ["science"], recencyHours: 24, collectionFrequencyMinutes: 1440 } }
    } });
    const queue: QueueAdapter = {
      enqueue: async (input) => {
        const step = await prisma.automationStep.findUnique({ where: { productionJobId: input.id } });
        expect(step).not.toBeNull();
        if (!step) throw new Error("Automation step was not linked before enqueue");
        await prisma.$transaction([
          prisma.productionJob.update({ where: { id: input.id }, data: { status: "SUCCEEDED", result: {}, finishedAt: new Date() } }),
          prisma.automationStep.update({ where: { id: step.id }, data: { status: "SUCCEEDED", output: {}, finishedAt: new Date() } })
        ]);
      },
      cancel: () => Promise.resolve(),
      close: () => Promise.resolve()
    };
    const jobs = new JobsService(new PrismaJobsRepository(prisma), queue);
    const service = new AutomationService(prisma, jobs, {} as OperationsService);
    const run = await service.start(workspace.id, { channelId: channel.id, idempotencyKey: key });
    expect(run.steps.find((step) => step.stage === "COLLECT")?.status).toBe("SUCCEEDED");
    expect(await prisma.productionJob.count({ where: { channelId: channel.id } })).toBe(1);
    expect((await service.start(workspace.id, { channelId: channel.id, idempotencyKey: key })).id).toBe(run.id);
    expect(await prisma.productionJob.count({ where: { channelId: channel.id } })).toBe(1);
  });
});
