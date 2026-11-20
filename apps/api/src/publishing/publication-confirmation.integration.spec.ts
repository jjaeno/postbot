import { PrismaClient } from "@postbot/database";
import { BullMqQueueAdapter } from "@postbot/jobs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { JobsService } from "../jobs/jobs.service.js";
import { PrismaJobsRepository } from "../jobs/prisma-jobs.repository.js";
import { PublishingService } from "./publishing.service.js";
import { schedulePublicationConfirmations } from "./schedule-publication-confirmation.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("publication confirmation outbox", () => {
  const prisma = new PrismaClient(); const queue = new BullMqQueueAdapter(process.env.REDIS_URL ?? "redis://127.0.0.1:16379", `publication-${randomUUID()}`);
  const jobs = new JobsService(new PrismaJobsRepository(prisma), queue); const service = new PublishingService(prisma, jobs);
  afterAll(async () => { await queue.close(); await prisma.$disconnect(); });
  async function fixture() {
    const key = randomUUID(); const user = await prisma.user.create({ data: { email: `${key}@confirmation.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key } });
    const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, platformAccountId: account.id, platform: "YOUTUBE", title: "Fixture", status: "HELD", idempotencyKey: key, scheduledAt: new Date() } });
    return { key, user, workspace, channel, account, content, plan };
  }
  it("authorizes a read-only reconciliation and preserves request identity after runtime retries", async () => {
    const f = await fixture();
    await prisma.publishAttempt.create({ data: { publishPlanId: f.plan.id, attemptNumber: 1, status: "RETRY_WAIT", idempotencyKey: f.key, protectedProviderEvidence: { encryptedSession: "mock-protected-evidence" } } });
    const input = { idempotencyKey: f.key, externalVideoId: "native-recovered", evidenceHash: "a".repeat(64) };
    const first = await service.reconcile(f.workspace.id, f.user.id, "OWNER", f.plan.id, input);
    const job = await prisma.productionJob.findUniqueOrThrow({ where: { id: first.jobId } });
    const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
    await prisma.productionJob.update({ where: { id: job.id }, data: { status: "RETRY_WAIT", runAfter: new Date(Date.now() + 300000), payload: { ...payload, _mediaCalls: { fixture: "COMPLETED" } } } });
    expect(await service.reconcile(f.workspace.id, f.user.id, "OWNER", f.plan.id, input)).toEqual(first);
    expect(await prisma.productionJob.count({ where: { contentItemId: f.content.id } })).toBe(1);
    expect(job.payload).toMatchObject({ publish: { publishPlanId: f.plan.id, externalVideoId: input.externalVideoId } });
    expect(await queue.state(job.id, "publish")).toBe("waiting");
    expect(JSON.stringify(await service.list(f.workspace.id))).not.toContain("mock-protected-evidence");
    await expect(service.reconcile(f.workspace.id, f.user.id, "MEMBER", f.plan.id, input)).rejects.toThrow("OWNER_ROLE_REQUIRED");
    await expect(service.reconcile("foreign", f.user.id, "OWNER", f.plan.id, input)).rejects.toThrow("PUBLISH_PLAN_NOT_FOUND");
    await expect(service.reconcile(f.workspace.id, f.user.id, "OWNER", f.plan.id, { ...input, externalVideoId: "different" })).rejects.toMatchObject({ response: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("rebuilds one status job from a durable upload and blocks a local-only cancellation", async () => {
    const f = await fixture();
    await prisma.publishPlan.update({ where: { id: f.plan.id }, data: { status: "PROCESSING" } });
    const post = await prisma.platformPost.create({ data: { publishPlanId: f.plan.id, platformAccountId: f.account.id, platform: "YOUTUBE", externalPostId: f.key, postUrl: "https://example.com/native", publishedAt: null, policyVersion: 1, publicationState: "PROCESSING" } });
    await schedulePublicationConfirmations(prisma, jobs, new Date(), null);
    await schedulePublicationConfirmations(prisma, jobs, new Date(), null);
    const queued = await prisma.productionJob.findMany({ where: { contentItemId: f.content.id } });
    expect(queued).toHaveLength(1); expect(queued[0]?.payload).toMatchObject({ publish: { publishPlanId: f.plan.id, externalVideoId: f.key } });
    await expect(service.cancel(f.workspace.id, f.plan.id)).rejects.toThrow("게시가 이미 시작되었거나 종료되어 예약을 변경할 수 없습니다.");
    await prisma.platformPost.update({ where: { id: post.id }, data: { publicationState: "FAILED", publicationFailureCode: "transcodeFailed" } });
    await prisma.publishPlan.update({ where: { id: f.plan.id }, data: { status: "FAILED" } });
    await service.cancel(f.workspace.id, f.plan.id);
    expect((await prisma.publishPlan.findUniqueOrThrow({ where: { id: f.plan.id } })).status).toBe("CANCELLED");
    expect((await prisma.platformPost.findUniqueOrThrow({ where: { id: post.id } })).publicationState).toBe("FAILED");
  });
});
