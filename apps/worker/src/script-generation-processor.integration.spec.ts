import { PrismaClient } from "@postbot/database";
import { BullMqQueueAdapter, createBullMqWorkers, type EnqueueJobInput } from "@postbot/jobs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DeterministicJobProcessor } from "./job-processor.js";

const databaseUrl = process.env.DATABASE_URL;
const runIntegration = process.env.RUN_DB_INTEGRATION === "1" && databaseUrl?.includes("_test") === true;
const describeIntegration = runIntegration ? describe : describe.skip;
const prisma = new PrismaClient();

const waitForCompletion = async (jobId: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const job = await prisma.productionJob.findUniqueOrThrow({ where: { id: jobId } });
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("SCRIPT job did not reach a terminal state within 10 seconds.");
};

const waitForStatus = async (jobId: string, status: "RUNNING"): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await prisma.productionJob.findUniqueOrThrow({ where: { id: jobId } })).status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`SCRIPT job did not reach ${status}.`);
};

describeIntegration("SCRIPT generation worker integration", () => {
  afterAll(async () => prisma.$disconnect());

  it("persists one version, usage, and ledger entry through the worker", async () => {
    process.env.LLM_PROVIDER = "fake";
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `worker-${suffix}@example.org`, displayName: "Worker Test", passwordHash: "test-password" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Worker Test", slug: `worker-${suffix}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Worker Test", slug: `worker-${suffix}`, topic: "science", language: "en" } });
    const idea = await prisma.contentIdea.create({
      data: {
        channelId: channel.id, title: "Reusable rocket test", summary: "A public test improved recovery.", canonicalUrl: "https://example.org/rocket", urlHash: suffix, contentHash: suffix,
        sourceName: "Example", sourceKind: "RSS", provider: "fixture", suitabilityScore: "0.8", freshnessScore: "0.8", reliabilityScore: "0.8", expectedValueScore: "0.8"
      }
    });
    const idempotencyKey = `script-${suffix}`;
    const job = await prisma.productionJob.create({
      data: {
        channelId: channel.id, type: "SCRIPT", queueName: "script", idempotencyKey,
        payload: { generation: { request: { ideaId: idea.id, idempotencyKey, platform: "YOUTUBE", partial: "full" }, idea: { id: idea.id, channelId: channel.id, title: idea.title, summary: idea.summary ?? "", canonicalUrl: idea.canonicalUrl, sourceName: idea.sourceName, sourceKind: idea.sourceKind, publishedAt: null, topic: "science", language: "en" } } }
      }
    });
    const input: EnqueueJobInput = { id: job.id, type: "SCRIPT", queueName: "script", runAfter: null, payload: job.payload as Record<string, unknown> };
    const queue = new BullMqQueueAdapter("redis://localhost:6379");
    const workers = createBullMqWorkers("redis://localhost:6379", (bullJob) => new DeterministicJobProcessor(prisma).process(bullJob.data));
    try {
      await queue.enqueue(input);
      await waitForCompletion(job.id);
    } finally {
      await workers.close();
      await queue.close();
    }

    const completed = await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id }, include: { attempts: true, providerUsages: { include: { costLedger: true } } } });
    const contentItem = await prisma.contentItem.findFirstOrThrow({ where: { channelId: channel.id, topicKey: `idea:${idea.id}` }, include: { scriptVersions: true, sceneVersions: true } });
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.attempts).toHaveLength(1);
    expect(contentItem.status).toBe("REVIEW_REQUIRED");
    expect(contentItem.scriptVersions).toHaveLength(1);
    expect(contentItem.sceneVersions).toHaveLength(1);
    expect(completed.providerUsages).toHaveLength(1);
    expect(completed.providerUsages[0]?.costLedger).toHaveLength(1);
  });

  it("cancels a running SCRIPT job before it creates generation records", async () => {
    process.env.LLM_PROVIDER = "fake";
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `cancel-${suffix}@example.org`, displayName: "Cancel Test", passwordHash: "test-password" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Cancel Test", slug: `cancel-${suffix}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Cancel Test", slug: `cancel-${suffix}`, topic: "science", language: "en" } });
    const idea = await prisma.contentIdea.create({ data: { channelId: channel.id, title: "Cancellation test", summary: "A public test.", canonicalUrl: "https://example.org/cancel", urlHash: suffix, contentHash: suffix, sourceName: "Example", sourceKind: "RSS", provider: "fixture", suitabilityScore: "0.8", freshnessScore: "0.8", reliabilityScore: "0.8", expectedValueScore: "0.8" } });
    const idempotencyKey = `cancel-${suffix}`;
    const payload = { deterministicBehavior: "timeout", timeoutMs: 250, generation: { request: { ideaId: idea.id, idempotencyKey, platform: "YOUTUBE", partial: "full" }, idea: { id: idea.id, channelId: channel.id, title: idea.title, summary: idea.summary ?? "", canonicalUrl: idea.canonicalUrl, sourceName: idea.sourceName, sourceKind: idea.sourceKind, publishedAt: null, topic: "science", language: "en" } } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: "SCRIPT", queueName: "script", idempotencyKey, payload } });
    const queue = new BullMqQueueAdapter("redis://localhost:6379");
    const workers = createBullMqWorkers("redis://localhost:6379", (bullJob) => new DeterministicJobProcessor(prisma).process(bullJob.data));
    try {
      await queue.enqueue({ id: job.id, type: "SCRIPT", queueName: "script", runAfter: null, payload });
      await waitForStatus(job.id, "RUNNING");
      await prisma.productionJob.update({ where: { id: job.id }, data: { status: "CANCEL_REQUESTED" } });
      await waitForCompletion(job.id);
    } finally {
      await workers.close();
      await queue.close();
    }
    await expect(prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(prisma.providerUsage.count({ where: { productionJobId: job.id } })).resolves.toBe(0);
    await expect(prisma.contentItem.count({ where: { channelId: channel.id } })).resolves.toBe(0);
  });
});
