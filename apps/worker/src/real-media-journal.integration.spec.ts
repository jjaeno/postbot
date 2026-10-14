import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AssetPreparationProcessor } from "./asset-preparation-processor.js";
import { DeterministicJobProcessor } from "./job-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" && new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");
const prisma = new PrismaClient();
describe.skipIf(!enabled).sequential("real media journal (mock HTTP, no paid calls)", () => {
  afterAll(async () => prisma.$disconnect());
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const fixture = async () => {
    vi.stubEnv("TTS_PROVIDER", "elevenlabs"); vi.stubEnv("ELEVENLABS_API_KEY", "contract-only"); vi.stubEnv("ELEVENLABS_VOICE_ID", "fixture-voice"); vi.stubEnv("TTS_USD_PER_THOUSAND_CHARACTERS", "1");
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@media-journal.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Journal", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Journal", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Media", topicKey: key } });
    const payload = { ttsPreparation: { channelId: channel.id, contentItemId: content.id, text: "Software verification.", voice: "fixture-voice", idempotencyKey: key } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "TTS", queueName: "tts", idempotencyKey: key, payload } });
    return { job, payload };
  };
  it("holds uncertain synthesis and prevents a second paid call on redelivery", async () => {
    const item = await fixture();
    const network = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", network);
    await new DeterministicJobProcessor(prisma).process({ id: item.job.id, type: "TTS", queueName: "tts", runAfter: null, payload: item.payload });
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED" });
    await expect(new AssetPreparationProcessor(prisma).processTts(item.payload, item.job.id)).rejects.toThrow("AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED");
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("holds an uncertain image call even when a licensed fallback exists", async () => {
    const item = await fixture();
    vi.stubEnv("IMAGE_PROVIDER", "google"); vi.stubEnv("GOOGLE_API_KEY", "contract-only"); vi.stubEnv("IMAGE_USD_PER_OUTPUT", "1");
    const version = await prisma.sceneVersion.create({ data: { contentItemId: item.job.contentItemId!, version: 1, schemaVersion: "1.0.0", sceneDocument: { schemaVersion: "1.0.0", title: "Image", width: 1080, height: 1920, fps: 30, durationInFrames: 450, scenes: [{ id: "only", startFrame: 0, durationInFrames: 450, visualPrompt: "Software", narration: { text: "Software", sourceUrl: "https://example.com/source" }, overlays: [{ kind: "title", text: "Software" }] }] } } });
    await prisma.asset.create({ data: { channelId: item.job.channelId!, dedupScope: item.job.channelId!, checksumSha256: randomUUID(), storageKey: "unused-fallback", kind: "IMAGE", origin: "INTERNAL", mimeType: "image/png", licenses: { create: { status: "VERIFIED", licenseName: "Fixture", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false } } } });
    const payload = { assetPreparation: { channelId: item.job.channelId!, contentItemId: item.job.contentItemId!, sceneVersionId: version.id, prompt: "Software", idempotencyKey: item.job.idempotencyKey } };
    const job = await prisma.productionJob.create({ data: { channelId: item.job.channelId, contentItemId: item.job.contentItemId, type: "ASSET", queueName: "asset", idempotencyKey: randomUUID(), payload } });
    const network = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Aborted", "AbortError")); vi.stubGlobal("fetch", network);
    await new DeterministicJobProcessor(prisma).process({ id: job.id, type: "ASSET", queueName: "asset", runAfter: null, payload });
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED" });
    await expect(new AssetPreparationProcessor(prisma).processAsset(payload, job.id)).rejects.toThrow("AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED");
    expect(network).toHaveBeenCalledTimes(1);
    expect(await prisma.assetUsage.count({ where: { contentItemId: item.job.contentItemId! } })).toBe(0);
  });
  it("rejects missing prices before recording a started call or sending HTTP", async () => {
    const item = await fixture(); vi.stubEnv("TTS_USD_PER_THOUSAND_CHARACTERS", "0");
    const network = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", network);
    await expect(new AssetPreparationProcessor(prisma).processTts(item.payload, item.job.id)).rejects.toThrow("TTS_PRICING_REQUIRED");
    expect(network).not.toHaveBeenCalled();
    const job = await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } });
    expect(job.payload).not.toHaveProperty("_mediaCalls");
  });
  it("does not repeat a completed call when its persisted media was removed", async () => {
    const item = await fixture();
    await prisma.productionJob.update({ where: { id: item.job.id }, data: { payload: { ...item.payload, _mediaCalls: { tts: "COMPLETED" } } } });
    const network = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", network);
    await expect(new AssetPreparationProcessor(prisma).processTts(item.payload, item.job.id)).rejects.toThrow("AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED");
    expect(network).not.toHaveBeenCalled();
  });
});
