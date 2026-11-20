import { PrismaClient } from "@postbot/database";
import type { EnqueueJobInput } from "@postbot/jobs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DeterministicJobProcessor } from "./job-processor.js";
import { AssetPreparationProcessor } from "./asset-preparation-processor.js";
import { AssetRepository } from "@postbot/asset-library";
import { FakeStorageProvider } from "@postbot/providers";

const enabled = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();

const seed = async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `${suffix}@asset.test`, displayName: "Asset", passwordHash: "test" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Asset", slug: suffix, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Asset", slug: suffix } });
  const contentItem = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Asset", topicKey: suffix } });
  const makeScene = (visualPrompt: string) => ({ schemaVersion: "1.0.0", title: "Asset fixture", width: 1080, height: 1920, fps: 30, durationInFrames: 90, scenes: [{ id: "only", startFrame: 0, durationInFrames: 90, visualPrompt, narration: { text: "fixture", sourceUrl: "https://example.com/asset" }, overlays: [{ kind: "title", text: "fixture" }] }] });
  const sceneVersion = await prisma.sceneVersion.create({ data: { contentItemId: contentItem.id, platform: "YOUTUBE", version: 1, schemaVersion: "1.0.0", sceneDocument: makeScene(`science image ${suffix}`) } });
  const fallbackSceneVersion = await prisma.sceneVersion.create({ data: { contentItemId: contentItem.id, platform: "YOUTUBE", version: 2, schemaVersion: "1.0.0", sceneDocument: makeScene("provider-failure") } });
  return { channel, contentItem, fallbackSceneVersion, sceneVersion, suffix };
};

enabled("asset and TTS worker integration", () => {
  afterAll(async () => prisma.$disconnect());
  it("stores fake image and TTS assets with timing and one cost entry", async () => {
    process.env.STORAGE_PROVIDER = "fake"; process.env.IMAGE_PROVIDER = "fake"; process.env.TTS_PROVIDER = "fake";
    const { channel, contentItem, fallbackSceneVersion, sceneVersion, suffix } = await seed();
    const imageJob = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: contentItem.id, type: "ASSET", queueName: "asset", idempotencyKey: `image-${suffix}`, payload: { assetPreparation: { channelId: channel.id, contentItemId: contentItem.id, sceneVersionId: sceneVersion.id, platform: "YOUTUBE", prompt: `science image ${suffix}`, idempotencyKey: `image-${suffix}` } } } });
    const ttsJob = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: contentItem.id, type: "TTS", queueName: "tts", idempotencyKey: `tts-${suffix}`, payload: { ttsPreparation: { channelId: channel.id, contentItemId: contentItem.id, sceneVersionId: sceneVersion.id, platform: "YOUTUBE", text: `one two ${suffix}`, voice: "fake", idempotencyKey: `tts-${suffix}` } } } });
    const processor = new DeterministicJobProcessor(prisma);
    await processor.process({ id: imageJob.id, type: "ASSET", queueName: "asset", runAfter: null, payload: imageJob.payload as Record<string, unknown> } satisfies EnqueueJobInput);
    const fallbackJob = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: contentItem.id, type: "ASSET", queueName: "asset", idempotencyKey: `fallback-${suffix}`, payload: { assetPreparation: { channelId: channel.id, contentItemId: contentItem.id, sceneVersionId: fallbackSceneVersion.id, platform: "YOUTUBE", prompt: "provider-failure", idempotencyKey: `fallback-${suffix}` } } } });
    await processor.process({ id: fallbackJob.id, type: "ASSET", queueName: "asset", runAfter: null, payload: fallbackJob.payload as Record<string, unknown> } satisfies EnqueueJobInput);
    await processor.process({ id: ttsJob.id, type: "TTS", queueName: "tts", runAfter: null, payload: ttsJob.payload as Record<string, unknown> } satisfies EnqueueJobInput);
    await expect(prisma.productionJob.findUniqueOrThrow({ where: { id: imageJob.id } })).resolves.toMatchObject({ status: "SUCCEEDED", result: { assets: [{ fallback: false }] } });
    await expect(prisma.assetUsage.count({ where: { contentItemId: contentItem.id } })).resolves.toBe(3);
    await expect(prisma.productionJob.findUniqueOrThrow({ where: { id: fallbackJob.id } })).resolves.toMatchObject({ status: "SUCCEEDED", result: { assets: [{ fallback: true }] } });
    await expect(prisma.providerUsage.count({ where: { contentItemId: contentItem.id, operation: "speech-synthesis" } })).resolves.toBe(1);
    await expect(prisma.costLedger.count({ where: { contentItemId: contentItem.id, category: "tts" } })).resolves.toBe(1);
  });
  it("honors a mixed snapshot, holds before paid work without stock and preserves assignments on retry", async () => {
    process.env.STORAGE_PROVIDER = "fake"; process.env.IMAGE_PROVIDER = "fake";
    const fixture = await seed();
    const sceneDocument = { schemaVersion: "1.0.0", title: "Mixed", width: 1080, height: 1920, fps: 30, durationInFrames: 120, aiStockRatio: 0.5, scenes: Array.from({ length: 4 }, (_, index) => ({ id: `scene-${index}`, startFrame: index * 30, durationInFrames: 30, visualPrompt: `${fixture.suffix}:${index}`, narration: { text: "Fixture", sourceUrl: "https://example.com/fixture" }, overlays: [{ kind: "fact", text: "Fixture" }] })) };
    await prisma.sceneVersion.update({ where: { id: fixture.sceneVersion.id }, data: { sceneDocument } });
    const payload = { assetPreparation: { channelId: fixture.channel.id, contentItemId: fixture.contentItem.id, sceneVersionId: fixture.sceneVersion.id, platform: "YOUTUBE", prompt: fixture.suffix, idempotencyKey: `mix-${fixture.suffix}` } };
    const job = await prisma.productionJob.create({ data: { channelId: fixture.channel.id, contentItemId: fixture.contentItem.id, type: "ASSET", queueName: "asset", idempotencyKey: `mix-${fixture.suffix}`, payload } });
    const storage = new FakeStorageProvider();
    const processor = new AssetPreparationProcessor(prisma, { storage });
    expect(await processor.processAsset(payload, job.id)).toMatchObject({ assets: [], needsReview: true, reviewCode: "STOCK_ASSET_REQUIRED" });
    expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
    const assets = new AssetRepository(prisma, storage);
    const stock = await assets.store({ channelId: fixture.channel.id, kind: "IMAGE", origin: "STOCK_FREE", key: `stock-${fixture.suffix}`, body: new TextEncoder().encode(`stock-${fixture.suffix}`), mimeType: "image/png", source: { provider: "fixture" }, license: { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: "https://example.com/license" } });
    expect(await processor.processAsset(payload, job.id)).toMatchObject({ needsReview: true, reviewCode: "STOCK_MATCH_REQUIRED", metadataMissing: true });
    await prisma.assetSource.create({ data: { assetId: stock.assetId, provider: "owner-metadata", providerResponse: { description: "Unrelated ocean wildlife", tags: ["ocean"] } } });
    expect(await processor.processAsset(payload, job.id)).toMatchObject({ needsReview: true, reviewCode: "STOCK_MATCH_REQUIRED" });
    expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
    await prisma.assetSource.create({ data: { assetId: stock.assetId, provider: "owner-metadata", providerResponse: { description: fixture.suffix, tags: [] } } });
    const result = await processor.processAsset(payload, job.id);
    expect(result.needsReview).toBe(false);
    const usages = await prisma.assetUsage.findMany({ where: { sceneVersionId: fixture.sceneVersion.id }, include: { asset: true } });
    expect(usages.filter((usage) => usage.asset.origin === "AI_GENERATED")).toHaveLength(2);
    expect(usages.filter((usage) => usage.assetId === stock.assetId)).toHaveLength(2);
    expect(await processor.processAsset(payload, job.id)).toEqual(result);
    expect(await prisma.providerUsage.count({ where: { productionJobId: job.id, operation: "image-generation" } })).toBe(2);
    expect(await prisma.assetUsage.count({ where: { sceneVersionId: fixture.sceneVersion.id } })).toBe(4);
  });
});
