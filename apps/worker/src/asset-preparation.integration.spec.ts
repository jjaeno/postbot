import { PrismaClient } from "@postbot/database";
import type { EnqueueJobInput } from "@postbot/jobs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DeterministicJobProcessor } from "./job-processor.js";

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
});
