import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PrismaClient, assertJobScope } from "../packages/database/dist/index.js";
import { BullMqQueueAdapter, createBullMqWorkers } from "../packages/jobs/dist/index.js";
import { AssetPreparationService, AssetRepository } from "../packages/asset-library/dist/index.js";
import { FakeImageProvider, FakeTtsProvider, FakeStorageProvider } from "../packages/providers/dist/index.js";
import { JobsService } from "../apps/api/dist/jobs/jobs.service.js";
import { PrismaJobsRepository } from "../apps/api/dist/jobs/prisma-jobs.repository.js";
import { PrismaReviewRepository } from "../apps/api/dist/review/prisma-review.repository.js";
import { PublishingService } from "../apps/api/dist/publishing/publishing.service.js";
import { PublishProcessor } from "../apps/worker/dist/publish-processor.js";
import { DeterministicJobProcessor } from "../apps/worker/dist/job-processor.js";
import { CollectProcessor } from "../apps/worker/dist/collect-processor.js";
import { scheduleAnalytics } from "../apps/api/dist/analytics/schedule-analytics.js";
import { AnalyticsProcessor } from "../apps/worker/dist/analytics-processor.js";

if (!new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test") || !process.env.REDIS_URL) throw new Error("An isolated _test MySQL database and Redis are required");
const prisma = new PrismaClient();
const prefix = `mvp-${randomUUID()}`;
const queue = new BullMqQueueAdapter(process.env.REDIS_URL, prefix);
const jobs = new JobsService(new PrismaJobsRepository(prisma), queue);
const review = new PrismaReviewRepository(prisma);
const publishing = new PublishingService(prisma, jobs);
const processor = new DeterministicJobProcessor(prisma);
// Consumer shares the real isolated Redis prefix and calls the production worker.
const workers = createBullMqWorkers(process.env.REDIS_URL, (job) => processor.process(job.data), ["asset", "tts", "script", "collect", "analytics"], prefix);


const wait = async (id, status, queueName) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const job = await prisma.productionJob.findUniqueOrThrow({ where: { id } });
    if (job.status === status && (!queueName || ["completed", "failed"].includes(await queue.state(id, queueName)))) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timeout waiting for ${id}: ${JSON.stringify(await prisma.productionJob.findUnique({ where: { id } }))}`);
};
const fixture = async (ratio = 1) => {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { email: `${key}@mvp.test`, displayName: "Fixture", passwordHash: "unused" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "MVP", slug: key } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "MVP", slug: key } });
  const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: key, topicKey: key, status: "REVIEW_REQUIRED" } });
  const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "YOUTUBE", version: 1, hook: "첫", body: "문장", qualitySnapshot: { facts: [{ claim: "첫 문장", sourceUrl: "https://example.com/source" }] } } });
  const document = { schemaVersion: "1.0.0", title: key, width: 1080, height: 1920, fps: 30, durationInFrames: 450, aiStockRatio: ratio, scenes: [{ id: "one", startFrame: 0, durationInFrames: 450, visualPrompt: "fixture", narration: { text: "첫 문장", sourceUrl: "https://example.com/source" }, overlays: [{ kind: "title", text: key }] }] };
  const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform: "YOUTUBE", version: 1, schemaVersion: "1.0.0", sceneDocument: document } });
  return { key, user, workspace, channel, content, scene, script };
};
const input = (f, type, domain) => ({ type, channelId: f.channel.id, contentItemId: f.content.id, idempotencyKey: randomUUID(), payload: { [type === "ASSET" ? "assetPreparation" : "ttsPreparation"]: { channelId: f.channel.id, contentItemId: f.content.id, sceneVersionId: f.scene.id, platform: "YOUTUBE", idempotencyKey: randomUUID(), ...domain } } });
const approve = (f, assetId) => review.reviewAssetLicense(f.workspace.id, f.user.id, f.content.id, { assetId, status: "VERIFIED", licenseName: "Owner fixture proof", proofUrl: "https://example.com/license", commercialUseAllowed: true, derivativeAllowed: true });

await test("real Redis completed image/TTS rights waits resume with the same assets and one provider call", async () => {
  const f = await fixture(); const storage = new FakeStorageProvider(); const assets = new AssetRepository(prisma, storage);
  let imageCalls = 0; let voiceCalls = 0;
  const preparation = new AssetPreparationService(assets, { generate: async (request) => { imageCalls++; return { ...await new FakeImageProvider().generate(request), provider: "mock-real-image" }; } }, { synthesize: async (request) => { voiceCalls++; return { ...await new FakeTtsProvider().synthesize(request), provider: "mock-real-voice" }; } });
  const image = await preparation.prepareImage({ channelId: f.channel.id, contentItemId: f.content.id, sceneVersionId: f.scene.id, purpose: "scene-image:YOUTUBE:one", key: f.key, prompt: f.key, model: "fixture", idempotencyKey: f.key });
  const job = await jobs.create(f.workspace.id, input(f, "ASSET", { prompt: f.key }));
  await wait(job.id, "NEEDS_REVIEW", "asset");
  await approve(f, image.assetId);
  await Promise.all(Array.from({ length: 8 }, () => jobs.recover(f.workspace.id, job.id, {})));
  const resumed = await wait(job.id, "SUCCEEDED", "asset");
  assert.equal(resumed.result.assets[0].assetId, image.assetId); assert.equal(imageCalls, 1);
  const voice = await preparation.prepareTts({ channelId: f.channel.id, contentItemId: f.content.id, sceneVersionId: f.scene.id, purpose: "tts-narration:YOUTUBE", key: `${f.key}-voice`, text: "첫 문장", voice: "fixture", model: "fixture", idempotencyKey: `${f.key}-voice` });
  const speechJob = await jobs.create(f.workspace.id, input(f, "TTS", { text: "첫 문장", voice: "fixture" }));
  await wait(speechJob.id, "NEEDS_REVIEW", "tts"); await approve(f, voice.assetId);
  await jobs.recover(f.workspace.id, speechJob.id, {});
  const speech = await wait(speechJob.id, "SUCCEEDED", "tts");
  assert.equal(speech.result.assetId, voice.assetId); assert.equal(voiceCalls, 1);
  const attempts = await prisma.jobAttempt.count({ where: { productionJobId: speechJob.id } });
  await queue.enqueue({ id: speechJob.id, type: "TTS", queueName: "tts", payload: {}, runAfter: null });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await prisma.jobAttempt.count({ where: { productionJobId: speechJob.id } }), attempts);
});

await test("stock shortage resumes the retained Redis job after stock registration", async () => {
  const f = await fixture(0);
  const job = await jobs.create(f.workspace.id, input(f, "ASSET", { prompt: "fixture" }));
  await wait(job.id, "NEEDS_REVIEW", "asset");
  await new AssetRepository(prisma, new FakeStorageProvider()).store({ channelId: f.channel.id, kind: "IMAGE", origin: "STOCK_FREE", key: f.key, body: new TextEncoder().encode(f.key), mimeType: "image/png", source: { provider: "owner-stock" }, license: { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: "https://example.com/stock-proof" } });
  await jobs.recover(f.workspace.id, job.id, {}); await wait(job.id, "SUCCEEDED", "asset");
  assert.equal(await prisma.providerUsage.count({ where: { productionJobId: job.id } }), 0);
});

await test("failed, active, missing and ambiguous deliveries keep their recovery semantics", async () => {
  const f = await fixture();
  const failed = await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "SCRIPT", queueName: "script", idempotencyKey: randomUUID(), payload: { deterministicBehavior: "retry-then-success", failAttempts: 1 } } });
  await queue.enqueue({ id: failed.id, type: "SCRIPT", queueName: "script", payload: {}, runAfter: null });
  await wait(failed.id, "SUCCEEDED", "script");
  assert.equal(await prisma.jobAttempt.count({ where: { productionJobId: failed.id } }), 2);
  const dead = await jobs.create(f.workspace.id, { channelId: f.channel.id, type: "SCRIPT", idempotencyKey: randomUUID(), payload: { deterministicBehavior: "fail" } });
  await wait(dead.id, "FAILED", "script");
  await prisma.productionJob.update({ where: { id: dead.id }, data: { payload: {} } });
  await Promise.all([jobs.recover(f.workspace.id, dead.id, {}), jobs.recover(f.workspace.id, dead.id, {})]);
  await wait(dead.id, "SUCCEEDED", "script");
  const runAfter = new Date(Date.now() + 60_000);
  const scheduled = await jobs.create(f.workspace.id, { channelId: f.channel.id, type: "SCRIPT", idempotencyKey: randomUUID(), payload: {}, runAfter: runAfter.toISOString() });
  assert.equal(await queue.state(scheduled.id, "script"), "delayed");
  await queue.cancel(scheduled.id, "script"); // Isolated Redis key loss.
  await jobs.recover(f.workspace.id, scheduled.id, {});
  assert.equal(await queue.state(scheduled.id, "script"), "delayed");
  assert.equal((await prisma.productionJob.findUniqueOrThrow({ where: { id: scheduled.id } })).runAfter.toISOString(), runAfter.toISOString());
  await jobs.cancel(f.workspace.id, scheduled.id);
  const uncertain = await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "ASSET", queueName: "asset", status: "NEEDS_REVIEW", idempotencyKey: randomUUID(), payload: {}, result: { reconciliationRequired: true }, errorCode: "AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED" } });
  await assert.rejects(jobs.recover(f.workspace.id, uncertain.id, {}), /Confirm/);
  assert.equal(await queue.state(uncertain.id, "asset"), "unknown");
  const active = await jobs.create(f.workspace.id, { channelId: f.channel.id, type: "SCRIPT", idempotencyKey: randomUUID(), payload: { deterministicBehavior: "timeout", timeoutMs: 300 } });
  await wait(active.id, "RUNNING");
  await Promise.all(Array.from({ length: 4 }, () => jobs.recover(f.workspace.id, active.id, {})));
  await wait(active.id, "SUCCEEDED", "script");
  assert.equal(await prisma.jobAttempt.count({ where: { productionJobId: active.id } }), 1);
});

await test("USED first candidate is skipped and concurrent automatic collectors reserve different ideas", async () => {
  const f = await fixture();
  const candidates = [1, 2, 3].map((n) => ({ title: `candidate ${n}`, summary: `summary ${n}`, body: `body ${n}`, url: `https://example.com/${f.key}/${n}`, sourceName: "Fixture", sourceKind: "OFFICIAL", publishedAt: new Date().toISOString(), reliabilityScore: 1 - n / 10 }));
  const collector = new CollectProcessor(prisma, { collect: async () => ({ provider: "fixture", candidates }) });
  const run = await prisma.automationRun.create({ data: { channelId: f.channel.id, idempotencyKey: randomUUID() } });
  const payload = { automation: { runId: run.id, stage: "COLLECT" }, collect: { channelId: f.channel.id, topic: "science", language: "ko", keywords: [], allowedSources: [], excludedSources: [], excludedKeywords: [], excludedTopics: [], recencyHours: 72, idempotencyKey: randomUUID() } };
  const first = await collector.process(payload);
  await prisma.contentIdea.update({ where: { id: first.idea.id }, data: { status: "USED" } });
  const secondRun = await prisma.automationRun.create({ data: { channelId: f.channel.id, idempotencyKey: randomUUID() } });
  const selected = await Promise.all([collector.process(payload), collector.process({ ...payload, automation: { ...payload.automation, runId: secondRun.id } })]);
  assert.notEqual(selected[0].idea.id, first.idea.id); assert.notEqual(selected[0].idea.id, selected[1].idea.id);
  await prisma.contentIdea.updateMany({ where: { channelId: f.channel.id }, data: { status: "USED" } });
  await assert.rejects(collector.process(payload), /NO_UNUSED/);
});

await test("worker scope rejects another channel's scene, publish plan and analytics sync", async () => {
  const f = await fixture(); const foreign = await fixture();
  await assert.rejects(assertJobScope(prisma, { channelId: f.channel.id, contentItemId: f.content.id, type: "RENDER", payload: { render: { channelId: f.channel.id, contentItemId: f.content.id, sceneVersionId: foreign.scene.id } } }), /SCOPE/);
  const sync = await prisma.analyticsSync.create({ data: { channelId: foreign.channel.id, platform: "YOUTUBE", status: "RUNNING", idempotencyKey: randomUUID(), periodStart: new Date(0), periodEnd: new Date(), timezone: "UTC" } });
  await assert.rejects(jobs.create(f.workspace.id, { channelId: f.channel.id, type: "ANALYTICS", idempotencyKey: randomUUID(), payload: { analytics: { syncId: sync.id } } }));
  const job = await prisma.productionJob.create({ data: { channelId: f.channel.id, contentItemId: f.content.id, type: "ANALYTICS", queueName: "analytics", idempotencyKey: randomUUID(), payload: { analytics: { syncId: sync.id } } } });
  await assert.rejects(processor.process({ id: job.id, type: "COLLECT", queueName: "collect", payload: {}, runAfter: null }), /SCOPE/);
  assert.equal((await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status, "FAILED");
});

await test("held metadata plan cancels, reapproves and publishes the latest title once; manual publication receives periodic analytics", async () => {
  const f = await fixture();
  const account = await prisma.platformAccount.create({ data: { workspaceId: f.workspace.id, channelId: f.channel.id, platform: "YOUTUBE", externalAccountId: f.key } });
  const storage = new FakeStorageProvider(); await storage.upload({ key: f.key, body: new Uint8Array([1,2,3]), mimeType: "video/mp4" });
  await prisma.sceneVersion.update({ where: { id: f.scene.id }, data: { renderManifest: { videoKey: f.key } } });
  await prisma.sourceReference.create({ data: { contentItemId: f.content.id, kind: "OFFICIAL", url: "https://example.com/source", urlHash: f.key, title: "Fixture", sourceName: "Fixture", reliabilityScore: 1 } });
  const assets = new AssetRepository(prisma, storage);
  const asset = await assets.store({ channelId: f.channel.id, kind: "IMAGE", origin: "INTERNAL", key: `${f.key}-image`, body: new TextEncoder().encode(f.key), mimeType: "image/png", source: { provider: "fixture" }, license: { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: "https://example.com/proof" } });
  await assets.attachUsage({ assetId: asset.assetId, contentItemId: f.content.id, sceneVersionId: f.scene.id, purpose: "image", snapshot: {} });
  const rule = await prisma.policyRule.create({ data: { platform: "YOUTUBE", region: f.key.slice(0,32), version: 1, effectiveAt: new Date(0), checkedAt: new Date(), durationRule: {}, originalityRule: {}, aiDisclosureRule: {}, rightsRule: {}, restrictedTopics: [] } });
  const check = () => prisma.policyCheck.create({ data: { contentItemId: f.content.id, platform: "YOUTUBE", policyRuleId: rule.id, status: "PASS", reasons: [] } });
  await check(); await review.act(f.workspace.id, f.content.id, "approve", "YOUTUBE");
  const request = { contentItemId: f.content.id, platformAccountId: account.id, scheduledAt: new Date(Date.now()+3600000).toISOString(), idempotencyKey: randomUUID() };
  const old = await publishing.schedule(f.workspace.id, request);
  await review.updateMetadata(f.workspace.id, f.content.id, { platform: "YOUTUBE", title: "최신 제목", description: "AI generated", hashtags: ["latest"] });
  assert.equal((await prisma.publishPlan.findUniqueOrThrow({ where: { id: old.id } })).status, "HELD");
  await publishing.cancel(f.workspace.id, old.id);
  await check(); assert.notEqual(await review.act(f.workspace.id, f.content.id, "approve", "YOUTUBE"), "POLICY_GATE");
  const replacement = await publishing.schedule(f.workspace.id, { ...request, idempotencyKey: randomUUID() });
  const publisher = new PublishProcessor(prisma, storage);
  assert.equal((await publisher.process({ publish: { publishPlanId: old.id } })).cancelled, true);
  await prisma.publishPlan.update({ where: { id: replacement.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
  await publisher.process({ publish: { publishPlanId: replacement.id } });
  assert.equal((await publisher.process({ publish: { publishPlanId: replacement.id } })).duplicate, true);
  assert.equal(await prisma.platformPost.count({ where: { publishPlanId: replacement.id } }), 1);
  assert.equal((await prisma.publishPlan.findUniqueOrThrow({ where: { id: replacement.id } })).title, "최신 제목");
  await assert.rejects(publishing.cancel(f.workspace.id, replacement.id));
  const post = await prisma.platformPost.findUniqueOrThrow({ where: { publishPlanId: replacement.id } });
  await prisma.platformPost.update({ where: { id: post.id }, data: { publishedAt: new Date(Date.now()-8*86400000) } });
  await scheduleAnalytics(prisma, jobs);
  const syncs = await prisma.analyticsSync.findMany({ where: { idempotencyKey: { startsWith: `post:${post.id}:` } } });
  assert.equal(syncs.length, 3);
  for (const sync of syncs) await new AnalyticsProcessor(prisma).process({ analytics: { syncId: sync.id, platformPostId: post.id } });
  assert.equal((await prisma.publishPlan.findUniqueOrThrow({ where: { id: replacement.id } })).status, "PUBLISHED");
});

await test("legacy mapping migration quarantines ambiguous values and preserves raw evidence", async () => {
  const f = await fixture();
  const account = await prisma.platformAccount.create({ data: { workspaceId: f.workspace.id, channelId: f.channel.id, platform: "YOUTUBE", externalAccountId: f.key } });
  const plan = await prisma.publishPlan.create({ data: { contentItemId: f.content.id, platformAccountId: account.id, platform: "YOUTUBE", status: "PUBLISHED", scheduledAt: new Date(), idempotencyKey: f.key, title: "Legacy" } });
  const post = await prisma.platformPost.create({ data: { publishPlanId: plan.id, platformAccountId: account.id, platform: "YOUTUBE", externalPostId: f.key, postUrl: "https://example.com/legacy", publishedAt: new Date(), policyVersion: 1 } });
  const sync = await prisma.analyticsSync.create({ data: { channelId: f.channel.id, platform: "YOUTUBE", status: "SUCCEEDED", idempotencyKey: f.key, periodStart: new Date(0), periodEnd: new Date(), timezone: "UTC" } });
  const raw = { averageViewPercentage: 50 };
  const legacy = await prisma.analyticsMetricSnapshot.create({ data: { analyticsSyncId: sync.id, platformPostId: post.id, metric: "completion_rate", mappingVersion: "v1", status: "AVAILABLE", value: 0.5, observedAt: new Date(), rawSnapshot: raw } });
  const source = await readFile(new URL("../packages/database/prisma/migrations/20261021000000_quarantine_ambiguous_analytics/migration.sql", import.meta.url), "utf8");
  await prisma.$executeRawUnsafe(source);
  const quarantined = await prisma.analyticsMetricSnapshot.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(quarantined.status, "UNAVAILABLE"); assert.equal(quarantined.value, null);
  assert.deepEqual(quarantined.rawSnapshot, raw); assert.equal(quarantined.mappingVersion, "legacy-ambiguous-v1");
});

await workers.close(); await queue.close(); await prisma.$disconnect();
