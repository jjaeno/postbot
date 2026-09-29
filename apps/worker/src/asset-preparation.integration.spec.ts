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
  return { channel, contentItem, suffix };
};

enabled("asset and TTS worker integration", () => {
  afterAll(async () => prisma.$disconnect());
  it("stores fake image and TTS assets with timing and one cost entry", async () => {
    process.env.STORAGE_PROVIDER = "fake"; process.env.IMAGE_PROVIDER = "fake"; process.env.TTS_PROVIDER = "fake";
    const { channel, contentItem, suffix } = await seed();
    const imageJob = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: contentItem.id, type: "ASSET", queueName: "asset", idempotencyKey: `image-${suffix}`, payload: { assetPreparation: { channelId: channel.id, contentItemId: contentItem.id, prompt: `science image ${suffix}`, idempotencyKey: `image-${suffix}` } } } });
    const ttsJob = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: contentItem.id, type: "TTS", queueName: "tts", idempotencyKey: `tts-${suffix}`, payload: { ttsPreparation: { channelId: channel.id, contentItemId: contentItem.id, text: `one two ${suffix}`, voice: "fake", idempotencyKey: `tts-${suffix}` } } } });
    const processor = new DeterministicJobProcessor(prisma);
    await processor.process({ id: imageJob.id, type: "ASSET", queueName: "asset", runAfter: null, payload: imageJob.payload as Record<string, unknown> } satisfies EnqueueJobInput);
    const fallbackJob = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: contentItem.id, type: "ASSET", queueName: "asset", idempotencyKey: `fallback-${suffix}`, payload: { assetPreparation: { channelId: channel.id, contentItemId: contentItem.id, prompt: "provider-failure", idempotencyKey: `fallback-${suffix}` } } } });
    await processor.process({ id: fallbackJob.id, type: "ASSET", queueName: "asset", runAfter: null, payload: fallbackJob.payload as Record<string, unknown> } satisfies EnqueueJobInput);
    await processor.process({ id: ttsJob.id, type: "TTS", queueName: "tts", runAfter: null, payload: ttsJob.payload as Record<string, unknown> } satisfies EnqueueJobInput);
    await expect(prisma.productionJob.findUniqueOrThrow({ where: { id: imageJob.id } })).resolves.toMatchObject({ status: "SUCCEEDED", result: { fallback: false } });
    await expect(prisma.assetUsage.count({ where: { contentItemId: contentItem.id } })).resolves.toBe(3);
    await expect(prisma.productionJob.findUniqueOrThrow({ where: { id: fallbackJob.id } })).resolves.toMatchObject({ status: "SUCCEEDED", result: { fallback: true } });
    await expect(prisma.providerUsage.count({ where: { contentItemId: contentItem.id, operation: "speech-synthesis" } })).resolves.toBe(1);
    await expect(prisma.costLedger.count({ where: { contentItemId: contentItem.id, category: "tts" } })).resolves.toBe(1);
  });
});
