import { collectionProfilePreset } from "@postbot/contracts";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AutomationService } from "./automation.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import { PrismaJobsRepository } from "../jobs/prisma-jobs.repository.js";
import type { QueueAdapter } from "@postbot/jobs";
import type { OperationsService } from "../operations/operations.service.js";

const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("scheduler and manual start concurrency", () => {
  afterEach(() => vi.unstubAllEnvs());
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
  it("enforces visual evidence for manually selected profile ideas before paid work", async () => {
    vi.stubEnv("ENABLED_PLATFORMS", "youtube"); const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@manual-visual.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, outputProfiles: { create: { platform: "YOUTUBE", minDurationSeconds: 35, maxDurationSeconds: 55 } }, collectionRules: { create: { profile: collectionProfilePreset("SCIENCE", "en"), recencyHours: 72, collectionFrequencyMinutes: 360, keywords: [], excludedKeywords: [], allowedSources: [], excludedSources: [] } } } });
    const idea = await prisma.contentIdea.create({ data: { channelId: channel.id, title: "Fixture", canonicalUrl: "https://example.com/fixture", urlHash: key, contentHash: key, sourceName: "Fixture", sourceKind: "OFFICIAL", provider: "fixture", suitabilityScore: 1, freshnessScore: 1, reliabilityScore: 1, expectedValueScore: 1, rawSnapshot: { body: "Fixture without visual evidence" } } });
    const queue: QueueAdapter = { enqueue: () => Promise.resolve(), cancel: () => Promise.resolve(), close: () => Promise.resolve() };
    const service = new AutomationService(prisma, new JobsService(new PrismaJobsRepository(prisma), queue), { notify: vi.fn(() => Promise.resolve()), audit: vi.fn(() => Promise.resolve()) } as unknown as OperationsService);
    await expect(service.start(workspace.id, { channelId: channel.id, ideaId: idea.id, idempotencyKey: key })).rejects.toThrow("VISUAL_REFERENCE_REQUIRED");
    expect(await prisma.productionJob.count({ where: { channelId: channel.id } })).toBe(0);
    expect(await prisma.providerUsage.count({ where: { contentItem: { channelId: channel.id } } })).toBe(0);
    await prisma.contentIdea.update({ where: { id: idea.id }, data: { rawSnapshot: { body: "NASA space reference", visualReferences: { references: [{ href: "https://images-assets.nasa.gov/image/SPACE/SPACE~thumb.jpg", rel: "preview", render: "image" }], rights: "ITEM_REVIEW_REQUIRED" } } } });
    await expect(service.start(workspace.id, { channelId: channel.id, ideaId: idea.id, idempotencyKey: `${key}:nasa` })).resolves.toMatchObject({ channelId: channel.id });
    expect(await prisma.providerUsage.count({ where: { contentItem: { channelId: channel.id } } })).toBe(0);
  });
  it("holds only the affected account branch before paid production", async () => {
    vi.stubEnv("ENABLED_PLATFORMS", "youtube,instagram");
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@account-preflight.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    await prisma.policyRule.createMany({ skipDuplicates: true, data: { platform: "INSTAGRAM", region: "GLOBAL", version: 1, effectiveAt: new Date(0), checkedAt: new Date(), durationRule: { minSeconds: 30, maxSeconds: 90 }, originalityRule: {}, aiDisclosureRule: {}, rightsRule: {}, restrictedTopics: [] } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, outputProfiles: { create: [{ platform: "YOUTUBE", minDurationSeconds: 35, maxDurationSeconds: 55 }, { platform: "INSTAGRAM", minDurationSeconds: 35, maxDurationSeconds: 55, publicSetting: "PUBLIC" }] }, collectionRules: { create: { keywords: ["science"], recencyHours: 24, collectionFrequencyMinutes: 60 } } } });
    await prisma.platformAccount.createMany({ data: [{ workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: key, status: "EXPIRED" }, { workspaceId: workspace.id, channelId: channel.id, platform: "INSTAGRAM", externalAccountId: key, status: "CONNECTED" }] });
    const queue: QueueAdapter = { enqueue: () => Promise.resolve(), cancel: () => Promise.resolve(), close: () => Promise.resolve() };
    const service = new AutomationService(prisma, new JobsService(new PrismaJobsRepository(prisma), queue), {} as OperationsService);
    const run = await service.start(workspace.id, { channelId: channel.id, idempotencyKey: key });
    expect(run.steps.find((step) => step.stage === "SCRIPT" && step.platform === "YOUTUBE")).toMatchObject({ status: "HELD", errorCode: "ACCOUNT_REAUTH_REQUIRED" });
    expect(run.steps.find((step) => step.stage === "SCRIPT" && step.platform === "INSTAGRAM")).toMatchObject({ status: "PENDING" });
    expect(await prisma.productionJob.count({ where: { channelId: channel.id, type: { in: ["SCRIPT", "ASSET", "TTS"] } } })).toBe(0);
  });
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

  it.each(["unlinked", "queued", "SUCCEEDED", "FAILED", "NEEDS_REVIEW", "CANCELLED"] as const)("recovers a stale %s step without replaying terminal work", async (mode) => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@automation-start.test`, displayName: "Recovery fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Recovery fixture", slug: key } });
    const channel = await prisma.channel.create({ data: {
      workspaceId: workspace.id, name: "Recovery fixture", slug: key,
      outputProfiles: { create: { platform: "YOUTUBE", minDurationSeconds: 35, maxDurationSeconds: 55 } },
      collectionRules: { create: { keywords: ["science"], recencyHours: 24, collectionFrequencyMinutes: 1440 } }
    } });
    let enqueued = 0;
    const queue: QueueAdapter = {
      enqueue: async (input) => {
        enqueued += 1;
        if (mode === "queued" && enqueued === 1) throw new Error("QUEUE_UNAVAILABLE");
        const status = mode === "unlinked" || mode === "queued" ? "SUCCEEDED" : mode;
        await prisma.productionJob.update({ where: { id: input.id }, data: { status, result: { recovered: true }, finishedAt: new Date() } });
        // Terminal modes simulate a worker stopping after saving the job but
        // before notifying the automation step.
        if (mode === "unlinked" || mode === "queued") {
          await prisma.automationStep.updateMany({ where: { productionJobId: input.id }, data: { status: "SUCCEEDED", output: { recovered: true } } });
        }
      },
      cancel: () => Promise.resolve(), close: () => Promise.resolve()
    };
    const jobs = new JobsService(new PrismaJobsRepository(prisma), queue);
    if (mode === "unlinked") vi.spyOn(jobs, "create").mockRejectedValueOnce(new Error("CREATE_INTERRUPTED"));
    const service = new AutomationService(prisma, jobs, {} as OperationsService);
    const started = service.start(workspace.id, { channelId: channel.id, idempotencyKey: key });
    if (mode === "unlinked" || mode === "queued") await expect(started).rejects.toThrow();
    else await started;
    const run = await prisma.automationRun.findUniqueOrThrow({ where: { idempotencyKey: key } });
    await prisma.automationStep.updateMany({ where: { automationRunId: run.id, stage: "COLLECT" }, data: { updatedAt: new Date(Date.now() - 120_000) } });
    const stale = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id }, include: { channel: { select: { workspaceId: true } }, steps: true } });
    // Exercise one scheduler pass without starting global background timers.
    await service["resumeNextStep"](stale);
    const recovered = (await service.get(workspace.id, run.id)).steps.find((step) => step.stage === "COLLECT");
    const expected = mode === "NEEDS_REVIEW" ? "HELD" : mode === "FAILED" || mode === "CANCELLED" ? "FAILED" : "SUCCEEDED";
    expect(recovered?.status).toBe(expected);
    expect(enqueued).toBe(mode === "queued" ? 2 : 1);
    expect(await prisma.productionJob.count({ where: { channelId: channel.id } })).toBe(1);
    if (expected === "SUCCEEDED") expect(recovered?.output).toMatchObject({ recovered: true });
  });
});
