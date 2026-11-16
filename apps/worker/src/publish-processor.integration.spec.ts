import { PrismaClient, jobExecution } from "@postbot/database";
import { FakeStorageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AmbiguousPublishError, FakeYouTubePublisherProvider } from "@postbot/publishers";
import { PublishProcessor } from "./publish-processor.js";
import { DeterministicJobProcessor } from "./job-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();

enabled("publish processor integration", () => {
  afterAll(async () => prisma.$disconnect());
  afterEach(() => vi.restoreAllMocks());
  const fixture = async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `${suffix}@publish.test`, displayName: "Publisher", passwordHash: "test" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Publish", slug: suffix, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Publish", slug: suffix } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: `fake-${suffix}`, status: "CONNECTED" } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Publish", topicKey: suffix, status: "SCHEDULED" } });
    const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "YOUTUBE", version: 1, hook: "Hook", body: "Body", language: "ko", qualitySnapshot: { reviewStatus: "APPROVED" } } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform: "YOUTUBE", version: 1, schemaVersion: "1.0.0", sceneDocument: { schemaVersion: "1.0.0" }, renderManifest: { videoKey: `renders/${suffix}.mp4` } } });
    await prisma.sceneVersion.update({ where: { id: scene.id }, data: { renderManifest: { videoKey: `renders/${suffix}.mp4`, productionFeatures: { version: "published-features-v1", sceneVersionId: scene.id, scriptVersionId: script.id, actualDurationSeconds: 30, hookType: "QUESTION", sceneTemplates: ["HOOK"] } } } });
    await prisma.sourceReference.create({ data: { contentItemId: content.id, kind: "OFFICIAL", title: "Official source", url: `https://example.com/${suffix}`, urlHash: suffix, sourceName: "Acceptance", reliabilityScore: 1, isPrimary: true } });
    const asset = await prisma.asset.create({ data: { channelId: channel.id, kind: "IMAGE", origin: "AI_GENERATED", storageKey: `assets/${suffix}.png`, checksumSha256: suffix.replaceAll("-", "").padEnd(64, "0"), mimeType: "image/png", licenses: { create: { status: "VERIFIED", licenseName: "Acceptance fixture", commercialUseAllowed: true, derivativeAllowed: true, checkedAt: new Date() } } } });
    await prisma.assetUsage.create({ data: { assetId: asset.id, contentItemId: content.id, sceneVersionId: scene.id, purpose: "scene-background" } });
    const rule = await prisma.policyRule.create({ data: { platform: "YOUTUBE", region: suffix.slice(0, 32), version: 1, effectiveAt: new Date(0), checkedAt: new Date(), durationRule: {}, originalityRule: {}, aiDisclosureRule: {}, rightsRule: {}, restrictedTopics: [] } });
    await prisma.policyCheck.create({ data: { contentItemId: content.id, policyRuleId: rule.id, platform: "YOUTUBE", status: "PASS", reasons: [] } });
    const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, platform: "YOUTUBE", platformAccountId: account.id, sceneVersionId: scene.id, status: "SCHEDULED", scheduledAt: new Date(Date.now() + 60_000), idempotencyKey: `publish-${suffix}`, title: "Publish" } });
    const storage = new FakeStorageProvider(); await storage.upload({ key: `renders/${suffix}.mp4`, body: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" });
    const processor = new PublishProcessor(prisma, storage);
    return { processor, plan, script, scene };
  };
  it("rolls back PUBLISHING when durable attempt creation fails", async () => {
    const { processor, plan } = await fixture();
    // The stale read selects attempt 2, then a competing insert wins that key.
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (operation, options) => {
      await prisma.publishAttempt.create({ data: { publishPlanId: plan.id, attemptNumber: 1, status: "FAILED", idempotencyKey: randomUUID() } });
      return original(operation, options);
    });
    await expect(processor.process({ publish: { publishPlanId: plan.id } })).rejects.toThrow();
    expect((await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("SCHEDULED");
    expect(await prisma.platformPost.count({ where: { publishPlanId: plan.id } })).toBe(0);
  });
  it("publishes a scheduled fake YouTube plan once and persists its attempt", async () => {
    const { processor, plan } = await fixture();
    const first = await processor.process({ publish: { publishPlanId: plan.id } }); const second = await processor.process({ publish: { publishPlanId: plan.id } });
    expect(second).toMatchObject({ duplicate: true }); expect(first).toHaveProperty("externalVideoId");
    const saved = await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { attempts: true, platformPost: true } });
    expect(saved.platformPost?.productionSnapshot).toMatchObject({ version: "published-features-v1", sceneVersionId: plan.sceneVersionId, actualDurationSeconds: 30, hookType: "QUESTION" });
    expect(saved.status).toBe("PUBLISHED"); expect(saved.attempts[0]?.status).toBe("SUCCEEDED"); expect(saved.platformPost?.externalPostId).toBeTruthy();
  });
  it("holds a confirmed publication after a database failure instead of uploading twice", async () => {
    const { processor, plan } = await fixture();
    const upload = vi.spyOn(FakeYouTubePublisherProvider.prototype, "upload");
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((operation, options) => transaction(operation, options)).mockRejectedValueOnce(new Error("Injected persistence failure"));
    await expect(processor.process({ publish: { publishPlanId: plan.id } })).rejects.toBeInstanceOf(AmbiguousPublishError);
    const saved = await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { attempts: true, platformPost: true } });
    expect(saved.status).toBe("HELD"); expect(saved.platformPost).toBeNull();
    expect(saved.attempts[0]).toMatchObject({ status: "RETRY_WAIT", errorCode: "AMBIGUOUS_PUBLISH" });
    const snapshot = saved.attempts[0]?.responseSnapshot;
    expect(Boolean(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot.externalOperationId === "string" && snapshot.externalOperationId.length > 0)).toBe(true);
    await expect(processor.process({ publish: { publishPlanId: plan.id } })).rejects.toThrow("PUBLISH_GATE_FAILED");
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("preserves a newer publication and records a late owner's remote receipt without overwriting it", async () => {
    const { processor, plan } = await fixture();
    const token = randomUUID(); const payload = { publish: { publishPlanId: plan.id } };
    const content = await prisma.contentItem.findUniqueOrThrow({ where: { id: plan.contentItemId } });
    const job = await prisma.productionJob.create({ data: { channelId: content.channelId, contentItemId: content.id, type: "PUBLISH", queueName: "publish", idempotencyKey: randomUUID(), payload, status: "RUNNING", executionToken: token } });
    const upload = vi.spyOn(FakeYouTubePublisherProvider.prototype, "upload").mockImplementationOnce(async () => {
      await prisma.productionJob.update({ where: { id: job.id }, data: { executionToken: randomUUID() } });
      await prisma.platformPost.create({ data: { publishPlanId: plan.id, platformAccountId: plan.platformAccountId, platform: "YOUTUBE", externalPostId: `new-${job.id}`, postUrl: "https://example.com/new", publishedAt: new Date(), policyVersion: 1 } });
      await prisma.publishPlan.update({ where: { id: plan.id }, data: { status: "PUBLISHED" } });
      return { provider: "fake-youtube", idempotencyKey: plan.idempotencyKey, publishedAt: new Date().toISOString(), status: "published", externalVideoId: `old-${job.id}`, url: "https://example.com/old" };
    });
    await expect(jobExecution.run({ jobId: job.id, token }, () => processor.process(payload))).rejects.toBeInstanceOf(AmbiguousPublishError);
    const saved = await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { platformPost: true, attempts: true } });
    expect(saved.status).toBe("PUBLISHED"); expect(saved.platformPost?.externalPostId).toBe(`new-${job.id}`);
    expect(saved.attempts[0]?.responseSnapshot).toEqual({ externalOperationId: `old-${job.id}` });
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("holds the job for reconciliation without scheduling automatic upload retries", async () => {
    const { plan } = await fixture();
    vi.spyOn(PublishProcessor.prototype, "process").mockRejectedValueOnce(new AmbiguousPublishError("PUBLISH_PERSISTENCE_RECONCILIATION_REQUIRED", "fixture-post-id"));
    const payload = { publish: { publishPlanId: plan.id } };
    const job = await prisma.productionJob.create({ data: { channelId: (await prisma.contentItem.findUniqueOrThrow({ where: { id: plan.contentItemId } })).channelId, contentItemId: plan.contentItemId, type: "PUBLISH", queueName: "publish", idempotencyKey: randomUUID(), payload } });
    await new DeterministicJobProcessor(prisma).process({ id: job.id, type: "PUBLISH", queueName: "publish", runAfter: null, payload });
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED", result: { reconciliationRequired: true, externalOperationId: "fixture-post-id" } });
  });
});
