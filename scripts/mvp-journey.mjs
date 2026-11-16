// Run inside the isolated worker verification container with current compiled
// packages, API modules in /app/api, and this file in /app/qa.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@postbot/database";
import { BullMqQueueAdapter } from "@postbot/jobs";
import { CollectProcessor } from "../dist/collect-processor.js";
import { ScriptGenerationProcessor } from "../dist/script-generation-processor.js";
import { AssetPreparationProcessor } from "../dist/asset-preparation-processor.js";
import { RenderProcessor } from "../dist/render-processor.js";
import { PublishProcessor } from "../dist/publish-processor.js";
import { AnalyticsProcessor } from "../dist/analytics-processor.js";
import { JobsService } from "../api/jobs/jobs.service.js";
import { PrismaJobsRepository } from "../api/jobs/prisma-jobs.repository.js";
import { PrismaReviewRepository } from "../api/review/prisma-review.repository.js";
import { ReviewService } from "../api/review/review.service.js";
import { PublishingService } from "../api/publishing/publishing.service.js";
import { scheduleAnalytics } from "../api/analytics/schedule-analytics.js";

if (!new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test") || process.env.LLM_PROVIDER !== "fake" || process.env.IMAGE_PROVIDER !== "fake" || process.env.TTS_PROVIDER !== "fake" || process.env.YOUTUBE_OAUTH_PROVIDER !== "fake") throw new Error("Isolated DB and explicit Fake providers required");
const prisma = new PrismaClient(); const queue = new BullMqQueueAdapter(process.env.REDIS_URL, `journey-${randomUUID()}`);
try {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { email: `${key}@journey.test`, displayName: "Local journey", passwordHash: "fixture" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Journey", slug: key } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Science", slug: key, topic: "science", language: "ko-KR", outputProfiles: { create: { platform: "YOUTUBE", minDurationSeconds: 1, maxDurationSeconds: 60 } } } });
  const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key } });
  const collected = await new CollectProcessor(prisma).process({ automation: { runId: run.id, stage: "COLLECT" }, collect: { channelId: channel.id, topic: "rocket", language: "ko-KR", keywords: [], allowedSources: [], excludedSources: [], excludedKeywords: [], excludedTopics: [], recencyHours: 72, idempotencyKey: key } });
  const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: "SCRIPT", queueName: "script", idempotencyKey: key, payload: {} } });
  const generated = await new ScriptGenerationProcessor(prisma).process(job.id, { generation: { request: { ideaId: collected.idea.id, platform: "YOUTUBE", partial: "full", idempotencyKey: key }, idea: collected.idea } });
  const scope = { channelId: channel.id, contentItemId: generated.contentItemId, sceneVersionId: generated.sceneVersionId, platform: "YOUTUBE" };
  const makeJob = (type) => prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: generated.contentItemId, type, queueName: type.toLowerCase(), idempotencyKey: randomUUID(), payload: {} } });
  const preparation = new AssetPreparationProcessor(prisma);
  const imageJob = await makeJob("ASSET"); await preparation.processAsset({ assetPreparation: { ...scope, prompt: "science illustration", idempotencyKey: imageJob.id } }, imageJob.id);
  const script = await prisma.scriptVersion.findUniqueOrThrow({ where: { id: generated.scriptVersionId } });
  const ttsJob = await makeJob("TTS"); await preparation.processTts({ ttsPreparation: { ...scope, text: [script.hook, script.body, script.callToAction].filter(Boolean).join(" "), voice: "fixture", idempotencyKey: ttsJob.id } }, ttsJob.id);
  const repository = new PrismaReviewRepository(prisma); const review = new ReviewService(repository);
  const usages = await prisma.assetUsage.findMany({ where: { sceneVersionId: generated.sceneVersionId } });
  for (const usage of usages) {
    await prisma.assetLicense.create({ data: { assetId: usage.assetId, status: "PENDING", licenseName: "Simulated rights wait", commercialUseAllowed: false, derivativeAllowed: false } });
    await review.reviewAssetLicense(workspace.id, "OWNER", user.id, generated.contentItemId, { assetId: usage.assetId, status: "VERIFIED", licenseName: "Owner confirmed fixture", proofUrl: "https://example.com/owner-proof", commercialUseAllowed: true, derivativeAllowed: true });
  }
  const renderJob = await makeJob("RENDER"); const rendered = await new RenderProcessor(prisma).process({ render: { channelId: channel.id, contentItemId: generated.contentItemId, sceneVersionId: generated.sceneVersionId, idempotencyKey: renderJob.id } }, renderJob.id);
  assert.equal(rendered.qa.hasAudio, true);
  await review.updateMetadata(workspace.id, generated.contentItemId, { platform: "YOUTUBE", title: "최신 한국어 제목", description: "AI generated. Source-linked local fixture; owner reviewed.", hashtags: ["science"] });
  await prisma.policyRule.create({ data: { platform: "YOUTUBE", region: key.slice(0,32), version: 1, effectiveAt: new Date(0), checkedAt: new Date(), durationRule: { minSeconds: 1, maxSeconds: 60 }, originalityRule: { minimumSourceCount: 1, minimumSourceReliability: 0, minimumOriginalityScore: 0 }, aiDisclosureRule: {}, rightsRule: { requireVerifiedAssets: true, commercialUseRequired: true }, restrictedTopics: [] } });
  const checked = await review.check(workspace.id, generated.contentItemId, { platform: "YOUTUBE", region: key.slice(0,32) });
  assert.equal(checked.outputs.find((output) => output.platform === "YOUTUBE").policy.status, "pass");
  await review.action(workspace.id, generated.contentItemId, { action: "approve", platform: "YOUTUBE" });
  const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: key } });
  const jobs = new JobsService(new PrismaJobsRepository(prisma), queue); const publishing = new PublishingService(prisma, jobs);
  const plan = await publishing.schedule(workspace.id, { contentItemId: generated.contentItemId, platformAccountId: account.id, scheduledAt: new Date(Date.now()+3600000).toISOString(), idempotencyKey: randomUUID() });
  const publisher = new PublishProcessor(prisma); await publisher.process({ publish: { publishPlanId: plan.id } });
  assert.equal((await publisher.process({ publish: { publishPlanId: plan.id } })).duplicate, true);
  const post = await prisma.platformPost.findUniqueOrThrow({ where: { publishPlanId: plan.id } });
  await prisma.platformPost.update({ where: { id: post.id }, data: { publishedAt: new Date(Date.now()-8*86400000) } });
  await scheduleAnalytics(prisma, jobs);
  const syncs = await prisma.analyticsSync.findMany({ where: { idempotencyKey: { startsWith: `post:${post.id}:` } } });
  assert.equal(syncs.length, 3);
  for (const sync of syncs) await new AnalyticsProcessor(prisma).process({ analytics: { syncId: sync.id, platformPostId: post.id } });
  console.log(JSON.stringify({ status: "PASS", collected: true, generated: true, rightsReviewed: usages.length, qa: rendered.qa, reviewed: true, edited: true, title: plan.title, fakePublishedOnce: true, periodicSyncs: syncs.length }));
} finally { await queue.close(); await prisma.$disconnect(); }
