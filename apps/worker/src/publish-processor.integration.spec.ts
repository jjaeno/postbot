import { PrismaClient, jobExecution } from "@postbot/database";
import { FakeStorageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AmbiguousPublishError, FakeYouTubePublisherProvider, encryptOAuthToken, decryptOAuthToken, youtubeAnalyticsScope, youtubeReadonlyScope, youtubeUploadScope } from "@postbot/publishers";
import { PublishProcessor } from "./publish-processor.js";
import { DeterministicJobProcessor } from "./job-processor.js";
import { collectionProfilePreset } from "@postbot/contracts";

const enabled = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();

enabled("publish processor integration", () => {
  afterAll(async () => prisma.$disconnect());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const fixture = async () => {
    vi.stubEnv("YOUTUBE_UPLOAD_PRIVACY", "public");
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
    const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, platform: "YOUTUBE", platformAccountId: account.id, sceneVersionId: scene.id, status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000), idempotencyKey: `publish-${suffix}`, title: "Publish" } });
    const storage = new FakeStorageProvider(); await storage.upload({ key: `renders/${suffix}.mp4`, body: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" });
    const processor = new PublishProcessor(prisma, storage);
    return { processor, plan, script, scene };
  };
  it("stores a resumable upload capability only as protected ciphertext", async () => {
    const { processor, plan } = await fixture(); const nativeId = `mock-upload-${plan.id}`;
    const key = "fixture-encryption-key"; const session = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=mock-capability";
    vi.stubEnv("YOUTUBE_OAUTH_PROVIDER", "google"); vi.stubEnv("OAUTH_ENCRYPTION_KEY", key);
    await prisma.oAuthCredential.create({ data: { platformAccountId: plan.platformAccountId, encryptedAccessToken: encryptOAuthToken("fixture-access", key), encryptedRefreshToken: null, tokenCipher: "aes-256-gcm", tokenKeyVersion: 1, scopes: [youtubeAnalyticsScope, youtubeReadonlyScope, youtubeUploadScope], scopeHash: "fixture", expiresAt: new Date(Date.now() + 3600000) } });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: session } })).mockResolvedValueOnce(Response.json({ id: nativeId, status: { privacyStatus: "public" } }));
    vi.stubGlobal("fetch", request);
    expect(await processor.process({ publish: { publishPlanId: plan.id } })).toMatchObject({ pending: true, published: false });
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { publishPlanId: plan.id } });
    const evidence = attempt.protectedProviderEvidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || typeof evidence.encryptedSession !== "string") throw new Error("Protected session fixture missing");
    expect(decryptOAuthToken(evidence.encryptedSession, "aes-256-gcm", key)).toBe(session);
    expect(JSON.stringify(attempt.responseSnapshot)).not.toContain("mock-capability");
    expect(JSON.stringify(evidence)).not.toContain("mock-capability"); expect(request).toHaveBeenCalledTimes(2);
  });
  it("records upload and processing separately, and never turns a processing failure into publication", async () => {
    const { processor, plan } = await fixture(); const nativeId = `native-upload-${plan.id}`;
    const upload = vi.spyOn(FakeYouTubePublisherProvider.prototype, "upload").mockResolvedValueOnce({ externalVideoId: nativeId, url: "https://example.com/native", status: "uploaded", visibility: "public", publishedAt: null });
    const lookup = vi.spyOn(FakeYouTubePublisherProvider.prototype, "getPublicationStatus")
      .mockResolvedValueOnce({ externalVideoId: nativeId, url: "https://example.com/native", status: "processing", publishedAt: null })
      .mockResolvedValueOnce({ externalVideoId: nativeId, url: "https://example.com/native", status: "failed", failureReason: "transcodeFailed", publishedAt: null });
    expect(await processor.process({ publish: { publishPlanId: plan.id } })).toMatchObject({ pending: true, published: false });
    expect(await prisma.platformPost.findUniqueOrThrow({ where: { publishPlanId: plan.id } })).toMatchObject({ publicationState: "UPLOADED", publishedAt: null });
    await processor.process({ publish: { publishPlanId: plan.id } });
    expect((await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("PROCESSING");
    expect(await processor.process({ publish: { publishPlanId: plan.id } })).toMatchObject({ reviewRequired: true, published: false, reason: "transcodeFailed" });
    expect(await prisma.platformPost.findUniqueOrThrow({ where: { publishPlanId: plan.id } })).toMatchObject({ publicationState: "FAILED", publishedAt: null });
    expect(upload).toHaveBeenCalledTimes(1); expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("waits for the platform's actual publication timestamp without uploading again", async () => {
    const { processor, plan } = await fixture(); const nativeId = `pending-native-${plan.id}`; const nativeTime = new Date(Date.now() - 500).toISOString();
    const upload = vi.spyOn(FakeYouTubePublisherProvider.prototype, "upload").mockResolvedValueOnce({ externalVideoId: nativeId, url: "https://example.com/native", status: "uploaded", publishedAt: null });
    await processor.process({ publish: { publishPlanId: plan.id } });
    vi.spyOn(FakeYouTubePublisherProvider.prototype, "getPublicationStatus").mockResolvedValueOnce({ externalVideoId: nativeId, url: "https://example.com/native", status: "processing", publishedAt: null }).mockResolvedValueOnce({ externalVideoId: nativeId, url: "https://example.com/native", status: "published", publishedAt: nativeTime });
    const content = await prisma.contentItem.findUniqueOrThrow({ where: { id: plan.contentItemId } });
    const payload = { publish: { publishPlanId: plan.id } };
    const job = await prisma.productionJob.create({ data: { channelId: content.channelId, contentItemId: content.id, type: "PUBLISH", queueName: "publish", idempotencyKey: randomUUID(), payload } });
    const worker = new DeterministicJobProcessor(prisma);
    await expect(worker.process({ id: job.id, type: "PUBLISH", queueName: "publish", runAfter: null, payload })).rejects.toThrow("PUBLICATION_CONFIRMATION_PENDING");
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("RETRY_WAIT");
    await worker.process({ id: job.id, type: "PUBLISH", queueName: "publish", runAfter: null, payload });
    expect((await prisma.platformPost.findUniqueOrThrow({ where: { publishPlanId: plan.id } })).publishedAt?.toISOString()).toBe(nativeTime);
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED"); expect(upload).toHaveBeenCalledTimes(1);
  });
  it("keeps an intentionally private Fake upload out of PUBLISHED", async () => {
    const { processor, plan } = await fixture(); vi.stubEnv("YOUTUBE_UPLOAD_PRIVACY", "private");
    expect(await processor.process({ publish: { publishPlanId: plan.id } })).toMatchObject({ published: false, pending: false });
    expect(await prisma.platformPost.findUniqueOrThrow({ where: { publishPlanId: plan.id } })).toMatchObject({ publicationState: "UPLOADED", visibility: "private", publishedAt: null });
    expect((await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("UPLOADED");
  });
  it("does not upload before the reserved time", async () => {
    const { processor, plan } = await fixture(); const future = new Date(Date.now() + 3600000);
    await prisma.publishPlan.update({ where: { id: plan.id }, data: { scheduledAt: future } });
    const upload = vi.spyOn(FakeYouTubePublisherProvider.prototype, "upload");
    expect(await processor.process({ publish: { publishPlanId: plan.id } })).toMatchObject({ pending: true, nextCheckAt: future.toISOString() });
    expect(upload).not.toHaveBeenCalled(); expect(await prisma.publishAttempt.count({ where: { publishPlanId: plan.id } })).toBe(0);
  });
  it.each(["REVIEW", "NEXT_SLOT", "IMMEDIATE"] as const)("applies the configured %s missed-slot policy before uploading", async (policy) => {
    const { processor, plan } = await fixture(); const content = await prisma.contentItem.findUniqueOrThrow({ where: { id: plan.contentItemId } });
    const profile = collectionProfilePreset("SCIENCE", "en"); profile.production.missedPublishPolicy = policy;
    await prisma.collectionRule.create({ data: { channelId: content.channelId, profile, keywords: [], recencyHours: 24, collectionFrequencyMinutes: 60 } });
    await prisma.publishPlan.update({ where: { id: plan.id }, data: { scheduledAt: new Date(Date.now() - 3600000) } });
    const next = new Date(Date.now() + 3600000);
    await prisma.scheduleRule.create({ data: { channelId: content.channelId, platform: "YOUTUBE", dayOfWeek: next.getUTCDay(), timeOfDayUtc: next.toISOString().slice(11, 19), timezone: "UTC" } });
    const upload = vi.spyOn(FakeYouTubePublisherProvider.prototype, "upload");
    const result = await processor.process({ publish: { publishPlanId: plan.id } });
    if (policy === "IMMEDIATE") { expect(result.published).toBe(true); expect(upload).toHaveBeenCalledTimes(1); }
    else { expect(upload).not.toHaveBeenCalled(); expect(result[policy === "NEXT_SLOT" ? "rescheduled" : "reviewRequired"]).toBe(true); }
    if (policy === "NEXT_SLOT") expect((await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id } })).scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });
  it("reconciles a known external result into the original held plan without another upload", async () => {
    const { processor, plan } = await fixture(); const nativeId = `recovered-native-${plan.id}`;
    await prisma.publishPlan.update({ where: { id: plan.id }, data: { status: "HELD" } });
    const content = await prisma.contentItem.findUniqueOrThrow({ where: { id: plan.contentItemId } });
    const job = await prisma.productionJob.create({ data: { channelId: content.channelId, contentItemId: content.id, type: "PUBLISH", queueName: "publish", status: "NEEDS_REVIEW", errorCode: "AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED", idempotencyKey: randomUUID(), payload: { publish: { publishPlanId: plan.id } } } });
    const upload = vi.spyOn(FakeYouTubePublisherProvider.prototype, "upload");
    const nativeTime = new Date(Date.now() - 1000).toISOString();
    vi.spyOn(FakeYouTubePublisherProvider.prototype, "getPublicationStatus").mockResolvedValueOnce({ externalVideoId: nativeId, url: "https://example.com/recovered", status: "published", publishedAt: nativeTime });
    expect(await processor.process({ publish: { publishPlanId: plan.id, externalVideoId: nativeId } })).toMatchObject({ published: true });
    expect(upload).not.toHaveBeenCalled(); expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED");
    expect((await prisma.platformPost.findUniqueOrThrow({ where: { publishPlanId: plan.id } })).publishedAt?.toISOString()).toBe(nativeTime);
  });
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
    let rejectPersistence = true;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (operation, options) => {
      const current = await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id } });
      if (rejectPersistence && current.status === "PUBLISHING") { rejectPersistence = false; throw new Error("Injected persistence failure"); }
      return transaction(operation, options);
    });
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
      await prisma.platformPost.create({ data: { publicationState: "PUBLISHED", publishPlanId: plan.id, platformAccountId: plan.platformAccountId, platform: "YOUTUBE", externalPostId: `new-${job.id}`, postUrl: "https://example.com/new", publishedAt: new Date(), policyVersion: 1 } });
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
