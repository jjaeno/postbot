import { collectionProfilePreset } from "@postbot/contracts";
import { PrismaClient } from "@postbot/database";
import { BullMqQueueAdapter } from "@postbot/jobs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AutomationService } from "./automation.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import { PrismaJobsRepository } from "../jobs/prisma-jobs.repository.js";
import type { OperationsService } from "../operations/operations.service.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("production demand with MySQL and Redis", () => {
  const prisma = new PrismaClient();
  const queue = new BullMqQueueAdapter(process.env.REDIS_URL ?? "redis://127.0.0.1:16379", `demand-${randomUUID()}`);
  const service = new AutomationService(prisma, new JobsService(new PrismaJobsRepository(prisma), queue), {} as OperationsService);
  beforeAll(async () => { await prisma.policyRule.createMany({ skipDuplicates: true, data: { platform: "YOUTUBE", region: "GLOBAL", version: 1, effectiveAt: new Date("2020-01-01"), checkedAt: new Date("2020-01-01"), durationRule: { minSeconds: 30, maxSeconds: 90 }, originalityRule: {}, aiDisclosureRule: {}, rightsRule: {}, restrictedTopics: [] } }); });
  afterAll(async () => { await queue.close(); await prisma.$disconnect(); });
  const seed = async (concurrency = 1) => {
    const key = randomUUID(); const profile = collectionProfilePreset("SCIENCE", "en"); profile.production.producerConcurrency = concurrency;
    const user = await prisma.user.create({ data: { email: `${key}@demand.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, minInventoryCount: 3, outputProfiles: { create: { platform: "YOUTUBE", minDurationSeconds: 30, maxDurationSeconds: 60 } }, collectionRules: { create: { profile, keywords: ["science"], recencyHours: 72, collectionFrequencyMinutes: 60 } } } });
    return { key, channel, workspace, profile };
  };
  it("does not let approval waits or distant reservations occupy the producer", async () => {
    const { key, channel, workspace } = await seed();
    const old = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: `${key}:old`, status: "PAUSED", pausedReason: "APPROVAL_REQUIRED", steps: { create: [
      { stage: "COLLECT", branchKey: "COMMON", status: "SUCCEEDED" },
      ...(["SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH"] as const).map((stage) => ({ stage, platform: "YOUTUBE" as const, branchKey: "YOUTUBE", status: stage === "POLICY" ? "HELD" as const : stage === "PUBLISH" ? "PENDING" as const : "SUCCEEDED" as const }))
    ] } } });
    await prisma.contentItem.create({ data: { channelId: channel.id, title: "Review", topicKey: key, status: "REVIEW_REQUIRED" } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: key, displayName: "Fixture" } });
    for (const index of [1, 2, 3]) {
      const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: `Future ${index}`, topicKey: `${key}:${index}`, status: "SCHEDULED" } });
      await prisma.publishPlan.create({ data: { contentItemId: content.id, platform: "YOUTUBE", platformAccountId: account.id, title: content.title, status: "SCHEDULED", scheduledAt: new Date(Date.now() + 7 * 86400000), idempotencyKey: `${key}:future:${index}` } });
    }
    const run = await service.start(workspace.id, { channelId: channel.id, idempotencyKey: key });
    expect(run.id).not.toBe(old.id); expect(run.checkpoint?.deficit).toBe(3);
    expect(run.productionState).toBe("PRODUCING"); expect((await service.get(workspace.id, old.id)).productionState).toBe("REVIEW_REQUIRED");
    const job = await prisma.productionJob.findFirstOrThrow({ where: { channelId: channel.id } });
    expect(await queue.state(job.id, "collect")).toBe("waiting");
  });
  it("atomically limits competing producers and enforces review capacity", async () => {
    const { key, channel, workspace } = await seed(2);
    const runs = await Promise.all([0, 1, 2, 3].map((index) => service.start(workspace.id, { channelId: channel.id, idempotencyKey: `${key}:${index}` })));
    expect(new Set(runs.map((run) => run.id)).size).toBe(2);
    expect(await prisma.automationRun.count({ where: { channelId: channel.id } })).toBe(2);
    await prisma.automationRun.updateMany({ where: { channelId: channel.id }, data: { status: "SUCCEEDED" } });
    await prisma.contentItem.createMany({ data: Array.from({ length: 5 }, (_, index) => ({ channelId: channel.id, title: "Review", topicKey: `${key}:review:${index}`, status: "REVIEW_REQUIRED" })) });
    await expect(service.start(workspace.id, { channelId: channel.id, idempotencyKey: `${key}:cap` })).rejects.toThrow("PRODUCTION_REVIEW_CAP_REACHED");
  });
  it("schedules collection and ranking independently without multiplying empty production runs", async () => {
    const { channel, workspace } = await seed();
    await Promise.all([service["scheduleCollectionPass"](workspace.id, channel.id, "DISCOVER", 1), service["scheduleCollectionPass"](workspace.id, channel.id, "DISCOVER", 1)]);
    await service["scheduleCollectionPass"](workspace.id, channel.id, "RANK", 5);
    expect(await prisma.automationRun.count({ where: { channelId: channel.id } })).toBe(2);
    const jobs = await prisma.productionJob.findMany({ where: { channelId: channel.id } });
    expect(jobs.map((job) => JSON.stringify(job.payload))).toEqual(expect.arrayContaining([expect.stringContaining('"mode":"DISCOVER"'), expect.stringContaining('"mode":"RANK"')]));
    await prisma.channel.update({ where: { id: channel.id }, data: { status: "PAUSED" } });
    await service["scheduleCollectionPass"](workspace.id, channel.id, "DISCOVER", 2);
    await expect(service.start(workspace.id, { channelId: channel.id, idempotencyKey: randomUUID() })).rejects.toThrow("ACTIVE_CHANNEL_NOT_FOUND");
    expect(await prisma.automationRun.count({ where: { channelId: channel.id } })).toBe(2);
  });
});
