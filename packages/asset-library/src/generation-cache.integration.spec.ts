import { PrismaClient } from "@postbot/database";
import { FakeImageProvider, FakeStorageProvider, FakeTtsProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AssetPreparationService, AssetRepository, generationInputKey } from "./index.js";
const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const fixture = async () => {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { email: `${key}@cache.test`, displayName: "Fixture", passwordHash: "fixture" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
  const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Cache", topicKey: key } });
  const scenes = await Promise.all((["YOUTUBE", "INSTAGRAM"] as const).map((platform) => prisma.sceneVersion.create({ data: { contentItemId: content.id, platform, version: 1, schemaVersion: "1.0.0", sceneDocument: {} } })));
  const storage = new FakeStorageProvider(); const assets = new AssetRepository(prisma, storage);
  return { key, channel, content, scenes, storage, assets };
};
const options = { imageProvider: "fake", ttsProvider: "fake", imageAccountRef: "account", ttsAccountRef: "account", imageContractVersion: "contract-v1", ttsContractVersion: "contract-v1" };
suite("pre-call shared generation cache", () => {
  afterAll(() => prisma.$disconnect());
  it("reuses synthesized voice across platform versions but calls again for a changed voice", async () => {
    const f = await fixture(); const tts = new FakeTtsProvider(); const call = vi.spyOn(tts, "synthesize");
    const service = new AssetPreparationService(f.assets, new FakeImageProvider(), tts, options);
    const base = { channelId: f.channel.id, contentItemId: f.content.id, text: "NASA 2026년 탐사", voice: "one", model: "tts-v1", inputVersions: { normalizationVersion: "v1" } };
    const first = await service.prepareTts({ ...base, sceneVersionId: f.scenes[0]!.id, purpose: "tts-narration:YOUTUBE", key: `${f.key}/voice`, idempotencyKey: `${f.key}:voice` });
    const second = await service.prepareTts({ ...base, sceneVersionId: f.scenes[1]!.id, purpose: "tts-narration:INSTAGRAM", key: `${f.key}/voice-two`, idempotencyKey: `${f.key}:voice-two` });
    expect(second).toEqual(first); expect(call).toHaveBeenCalledTimes(1);
    const next = await prisma.sceneVersion.create({ data: { contentItemId: f.content.id, platform: "YOUTUBE", version: 2, schemaVersion: "1.0.0", sceneDocument: {} } });
    await service.prepareTts({ ...base, voice: "two", sceneVersionId: next.id, purpose: "tts-narration:YOUTUBE", key: `${f.key}/changed`, idempotencyKey: `${f.key}:changed` });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("reserves one call under concurrent platform production and reuses the receipt before provider invocation", async () => {
    const f = await fixture();
    let release = () => {}; let started = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const image = { generate: vi.fn(async (input: Parameters<FakeImageProvider["generate"]>[0]) => { started(); await barrier; return new FakeImageProvider().generate(input); }) };
    const first = new AssetPreparationService(f.assets, image, new FakeTtsProvider(), options);
    const second = new AssetPreparationService(f.assets, image, new FakeTtsProvider(), options);
    const base = { channelId: f.channel.id, contentItemId: f.content.id, prompt: "Roman aqueduct", model: "image-v1", holdOnFailure: true, inputVersions: { guideVersion: "v1" } };
    const a = { ...base, sceneVersionId: f.scenes[0]!.id, purpose: "scene-image:YOUTUBE:one", key: `${f.key}/one`, idempotencyKey: `${f.key}:one` };
    const b = { ...base, sceneVersionId: f.scenes[1]!.id, purpose: "scene-image:INSTAGRAM:one", key: `${f.key}/two`, idempotencyKey: `${f.key}:two` };
    const running = first.prepareImage(a); await entered;
    try { await expect(second.prepareImage(b)).rejects.toThrow("ASSET_CACHE_IN_PROGRESS"); } finally { release(); }
    const original = await running; const reused = await second.prepareImage(b);
    expect(reused.assetId).toBe(original.assetId); expect(image.generate).toHaveBeenCalledTimes(1);
    expect(await prisma.providerUsage.count({ where: { contentItemId: f.content.id } })).toBe(1);
    expect(await prisma.assetUsage.count({ where: { assetId: original.assetId } })).toBe(2);
    expect(await prisma.assetGenerationCache.count({ where: { channelId: f.channel.id, state: "READY" } })).toBe(1);
  });
  it("keys model, voice, guide, normalization, account and contract settings and refuses missing cached objects", async () => {
    const original = { text: "2026년 NASA", model: "v1", voice: "one", guide: { era: "Rome", version: "v1" }, account: "a", contract: "paid", normalization: "v1" };
    for (const change of [{ model: "v2" }, { voice: "two" }, { guide: { era: "Egypt", version: "v2" } }, { account: "b" }, { contract: "free" }, { normalization: "v2" }]) expect(generationInputKey({ ...original, ...change })).not.toBe(generationInputKey(original));
    expect(generationInputKey({ b: 2, a: 1 })).toBe(generationInputKey({ a: 1, b: 2 }));
    const f = await fixture(); const image = new FakeImageProvider(); const call = vi.spyOn(image, "generate");
    const service = new AssetPreparationService(f.assets, image, new FakeTtsProvider(), options);
    const input = { channelId: f.channel.id, contentItemId: f.content.id, sceneVersionId: f.scenes[0]!.id, prompt: "cache missing", model: "v1", idempotencyKey: f.key, key: `${f.key}/image`, holdOnFailure: true };
    await service.prepareImage(input); await f.storage.delete(input.key);
    await expect(service.prepareImage({ ...input, sceneVersionId: f.scenes[1]!.id, idempotencyKey: `${f.key}:other` })).rejects.toThrow("ASSET_CACHE_OBJECT_MISSING");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
