import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { DeterministicJobProcessor } from "./job-processor.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("channel failure policy isolation", () => {
  const prisma = new PrismaClient(); afterAll(() => prisma.$disconnect());
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("holds a legacy paid job before any provider call when no budgeted run exists", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    const fetch = vi.fn(() => Promise.reject(new Error("External calls are forbidden in this test")));
    vi.stubGlobal("fetch", fetch);
    const job = await prisma.productionJob.create({ data: { type: "SCRIPT", queueName: "script", idempotencyKey: randomUUID(), payload: {} } });
    await new DeterministicJobProcessor(prisma).process({ id: job.id, type: "SCRIPT", queueName: "script", payload: {}, runAfter: null });
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "BUDGET_WORKFLOW_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled(); expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
  });
  it.each(["notify_only", "pause_channel"])("honors %s and leaves the sibling channel/provider available", async (policy) => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@failures.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, errorAction: { onConsecutiveFailures: policy } } });
    const sibling = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Sibling", slug: `${key}-sibling` } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key, status: "RUNNING" } });
    const processor = new DeterministicJobProcessor(prisma);
    const fail = async () => {
      const payload = { automation: { runId: run.id, stage: "SCRIPT" } };
      const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: "SCRIPT", queueName: "script", idempotencyKey: randomUUID(), payload } });
      await expect(processor.process({ id: job.id, type: "SCRIPT", queueName: "script", payload, runAfter: null })).rejects.toThrow();
    };
    await fail(); await fail(); await fail();
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(policy === "notify_only" ? "RUNNING" : "PAUSED");
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe(policy === "notify_only" ? "ACTIVE" : "PAUSED");
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: sibling.id } })).status).toBe("ACTIVE");
    expect(await prisma.automationSwitch.count({ where: { workspaceId: workspace.id } })).toBe(0);
    if (policy === "notify_only") {
      const payload = { automation: { runId: run.id, stage: "COLLECT" }, collect: { channelId: channel.id, topic: "rocket", language: "ko", keywords: [], allowedSources: [], excludedSources: [], excludedKeywords: [], excludedTopics: [], recencyHours: 72, idempotencyKey: randomUUID() } };
      const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: "COLLECT", queueName: "collect", idempotencyKey: randomUUID(), payload } });
      await processor.process({ id: job.id, type: "COLLECT", queueName: "collect", payload, runAfter: null });
      expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).failureCount).toBe(0);
      await fail(); expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).failureCount).toBe(1);
    }
  });
});
