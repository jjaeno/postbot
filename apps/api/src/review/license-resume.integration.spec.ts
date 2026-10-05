import "reflect-metadata";
import { PrismaClient } from "@postbot/database";
import { AssetPreparationService, AssetRepository } from "@postbot/asset-library";
import { FakeImageProvider, FakeStorageProvider, FakeTtsProvider } from "@postbot/providers";
import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaReviewRepository } from "./prisma-review.repository.js";

const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();
const seed = async () => {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { email: `${key}@rights-resume.test`, displayName: "Fixture", passwordHash: "fixture" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, status: "PAUSED" } });
  const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key, status: "SCHEDULED" } });
  const assets = new AssetRepository(prisma, new FakeStorageProvider());
  const pending = await assets.store({ channelId: channel.id, kind: "IMAGE", origin: "AI_GENERATED", key, body: new TextEncoder().encode(key), mimeType: "image/png", source: { provider: "mock-real" }, license: { status: "unknown", commercialUseAllowed: false, derivativeAllowed: false, attributionRequired: false, attributionText: null, proofUrl: null } });
  const scripts = []; const scenes = []; const plans = [];
  for (const platform of ["YOUTUBE", "INSTAGRAM"] as const) {
    const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform, version: 1, hook: "hook", body: "body", qualitySnapshot: { reviewStatus: "APPROVED" } } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform, version: 1, schemaVersion: "1.0.0", sceneDocument: {} } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform, externalAccountId: `${key}:${platform}` } });
    const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, platform, platformAccountId: account.id, sceneVersionId: scene.id, status: "SCHEDULED", scheduledAt: new Date(Date.now() + 3600000), idempotencyKey: `${key}:${platform}`, title: "Fixture" } });
    const rule = await prisma.policyRule.create({ data: { platform, region: key.slice(0, 32), version: 1, effectiveAt: new Date(), checkedAt: new Date(), durationRule: {}, originalityRule: {}, aiDisclosureRule: {}, rightsRule: {}, restrictedTopics: [] } });
    await prisma.policyCheck.create({ data: { contentItemId: content.id, platform, policyRuleId: rule.id, status: "PASS", reasons: [] } });
    scripts.push(script); scenes.push(scene); plans.push(plan);
  }
  const scene = scenes[0]!;
  await assets.attachUsage({ assetId: pending.assetId, contentItemId: content.id, sceneVersionId: scene.id, purpose: "scene-image:YOUTUBE:only", snapshot: {} });
  const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "ASSET", queueName: "asset", status: "NEEDS_REVIEW", idempotencyKey: `${key}:asset`, payload: { assetPreparation: { channelId: channel.id, contentItemId: content.id, sceneVersionId: scene.id, platform: "YOUTUBE", prompt: key, idempotencyKey: `${key}:image` } } } });
  const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: `${key}:run`, status: "PAUSED", pausedReason: "ASSET_LICENSE_REVIEW_REQUIRED", steps: { create: { stage: "ASSET", platform: "YOUTUBE", branchKey: "YOUTUBE", status: "HELD", errorCode: "ASSET_LICENSE_REVIEW_REQUIRED", productionJobId: job.id, output: { assets: [{ assetId: pending.assetId }], needsReview: true } } } } });
  return { key, user, workspace, channel, content, pending, assets, scripts, scenes, plans, run, job };
};

suite("rights proof recovery and platform isolation", () => {
  afterAll(() => prisma.$disconnect());
  it("resumes the held asset step and reuses the approved image without another provider call", async () => {
    const fixture = await seed();
    const repository = new PrismaReviewRepository(prisma);
    expect(await repository.reviewAssetLicense(fixture.workspace.id, fixture.user.id, fixture.content.id, { assetId: fixture.pending.assetId, status: "VERIFIED", proofUrl: "https://example.com/license", licenseName: "Reviewed evidence", commercialUseAllowed: true, derivativeAllowed: true })).toBe(true);
    expect(await prisma.automationRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).toMatchObject({ status: "QUEUED", pausedReason: null });
    expect(await prisma.automationStep.findFirstOrThrow({ where: { automationRunId: fixture.run.id } })).toMatchObject({ status: "PENDING", productionJobId: fixture.job.id });
    const image = new FakeImageProvider(); const call = vi.spyOn(image, "generate");
    const service = new AssetPreparationService(fixture.assets, image, new FakeTtsProvider());
    expect(await service.prepareImage({ channelId: fixture.channel.id, contentItemId: fixture.content.id, sceneVersionId: fixture.scenes[0]!.id, purpose: "scene-image:YOUTUBE:only", key: `${fixture.key}:retry`, prompt: fixture.key, model: "mock", idempotencyKey: `${fixture.key}:retry` })).toMatchObject({ assetId: fixture.pending.assetId, needsReview: false });
    expect(call).not.toHaveBeenCalled();
    expect(await prisma.providerUsage.count({ where: { contentItemId: fixture.content.id } })).toBe(0);
    expect(await prisma.publishPlan.findUniqueOrThrow({ where: { id: fixture.plans[0]!.id } })).toMatchObject({ status: "HELD" });
    expect(await prisma.publishPlan.findUniqueOrThrow({ where: { id: fixture.plans[1]!.id } })).toMatchObject({ status: "SCHEDULED" });
    expect(await prisma.scriptVersion.findUniqueOrThrow({ where: { id: fixture.scripts[1]!.id } })).toMatchObject({ qualitySnapshot: { reviewStatus: "APPROVED" } });
    expect(await prisma.policyCheck.count({ where: { contentItemId: fixture.content.id, platform: "INSTAGRAM", status: "UNKNOWN" } })).toBe(0);
    expect(await prisma.contentItem.findUniqueOrThrow({ where: { id: fixture.content.id } })).toMatchObject({ status: "SCHEDULED" });
  });
  it("does not resume until every current-scene asset is verified and rejects foreign workspace access", async () => {
    const fixture = await seed();
    const another = await fixture.assets.store({ channelId: fixture.channel.id, kind: "IMAGE", origin: "AI_GENERATED", key: `${fixture.key}:second`, body: new TextEncoder().encode(`${fixture.key}:second`), mimeType: "image/png", source: { provider: "mock-real" }, license: { status: "unknown", commercialUseAllowed: false, derivativeAllowed: false, attributionRequired: false, attributionText: null, proofUrl: null } });
    await fixture.assets.attachUsage({ assetId: another.assetId, contentItemId: fixture.content.id, sceneVersionId: fixture.scenes[0]!.id, purpose: "scene-image:YOUTUBE:second", snapshot: {} });
    const repository = new PrismaReviewRepository(prisma);
    const proof = { assetId: fixture.pending.assetId, status: "VERIFIED" as const, proofUrl: "https://example.com/license", licenseName: "Reviewed evidence", commercialUseAllowed: true, derivativeAllowed: true };
    expect(await repository.reviewAssetLicense("foreign-workspace", fixture.user.id, fixture.content.id, proof)).toBe(false);
    await repository.reviewAssetLicense(fixture.workspace.id, fixture.user.id, fixture.content.id, proof);
    expect(await prisma.automationStep.findFirstOrThrow({ where: { automationRunId: fixture.run.id } })).toMatchObject({ status: "HELD" });
    // The held result contains both images, as the real worker emits.
    await prisma.automationStep.updateMany({ where: { automationRunId: fixture.run.id }, data: { output: { assets: [{ assetId: fixture.pending.assetId }, { assetId: another.assetId }] } } });
    await repository.reviewAssetLicense(fixture.workspace.id, fixture.user.id, fixture.content.id, { ...proof, assetId: another.assetId });
    expect(await prisma.automationStep.findFirstOrThrow({ where: { automationRunId: fixture.run.id } })).toMatchObject({ status: "PENDING" });
  });
});
