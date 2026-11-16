import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DeterministicJobProcessor } from "./job-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" &&
  new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");

describe.skipIf(!enabled)("completed job redelivery", () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });
  it("rolls back a claim when its automation state write fails and safely retries once", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@claim.test`, displayName: "Claim fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Claim fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Claim fixture", slug: key } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key } });
    const payload = { automation: { runId: run.id, stage: "COLLECT" } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: "COLLECT", queueName: "collect", idempotencyKey: key, payload } });
    const step = await prisma.automationStep.create({ data: { automationRunId: run.id, stage: "COLLECT", branchKey: "COMMON", status: "QUEUED", productionJobId: job.id } });
    const processor = new DeterministicJobProcessor(prisma);
    const markRunning = processor["markAutomationStepRunning"].bind(processor);
    processor["markAutomationStepRunning"] = () => Promise.reject(new Error("CLAIM_STATE_WRITE_FAILED"));
    await expect(processor.process({ id: job.id, type: "COLLECT", queueName: "collect", payload, runAfter: null })).rejects.toThrow("CLAIM_STATE_WRITE_FAILED");
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "QUEUED", startedAt: null });
    expect(await prisma.jobAttempt.count({ where: { productionJobId: job.id } })).toBe(0);
    expect(await prisma.automationStep.findUniqueOrThrow({ where: { id: step.id } })).toMatchObject({ status: "QUEUED" });
    processor["markAutomationStepRunning"] = markRunning;
    expect(await processor["start"](job.id)).toBe(1);
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RUNNING" });
    expect(await prisma.automationStep.findUniqueOrThrow({ where: { id: step.id } })).toMatchObject({ status: "RUNNING", attemptCount: 1 });
    expect(await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "RUNNING" });
    expect(await prisma.jobAttempt.count({ where: { productionJobId: job.id } })).toBe(1);
    expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
  });
  it("does not revive a cancelled run from late worker completion or queued redelivery", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@cancel.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key, status: "RUNNING" } });
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: "COLLECT", queueName: "collect", idempotencyKey: key, payload: { automation: { runId: run.id, stage: "COLLECT" }, deterministicBehavior: "timeout", timeoutMs: 200 } } });
    const processor = new DeterministicJobProcessor(prisma);
    // The private completion routine is exercised through its actual typed method, without replacing DB calls.
    const complete = processor as unknown as { succeed(jobId: string, attemptNumber: number, result: Record<string, unknown>): Promise<void> };
    await prisma.jobAttempt.create({ data: { productionJobId: job.id, attemptNumber: 1, status: "RUNNING", startedAt: new Date() } });
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "CANCELLED" } });
    await complete.succeed(job.id, 1, { done: true });
    expect(await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "CANCELLED" });
    const queued = await prisma.productionJob.create({ data: { channelId: channel.id, type: "COLLECT", queueName: "collect", idempotencyKey: `${key}:queued`, payload: { automation: { runId: run.id, stage: "COLLECT" } } } });
    await processor.process({ id: queued.id, type: "COLLECT", queueName: "collect", payload: { automation: { runId: run.id, stage: "COLLECT" } }, runAfter: null });
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await prisma.jobAttempt.count({ where: { productionJobId: queued.id } })).toBe(0);
  });

  it("preserves the DB result after Redis loses its completed-job key", async () => {
    const key = randomUUID();
    const job = await prisma.productionJob.create({ data: {
      type: "COLLECT", queueName: "collect", idempotencyKey: key, payload: {}
    } });
    const input = { id: job.id, type: "COLLECT" as const, queueName: "collect" as const, payload: {}, runAfter: null };
    const processor = new DeterministicJobProcessor(prisma);
    await processor.process(input);
    const completed = await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id }, include: { attempts: true } });
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.attempts).toHaveLength(1);
    await processor.process(input);
    const redelivered = await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id }, include: { attempts: true } });
    expect(redelivered.status).toBe("SUCCEEDED");
    expect(redelivered.attempts).toHaveLength(1);
    expect(redelivered.result).toEqual(completed.result);
    expect(redelivered.finishedAt).toEqual(completed.finishedAt);
    expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
  });
});
