import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AssetPreparationProcessor } from "./asset-preparation-processor.js";
import { DeterministicJobProcessor } from "./job-processor.js";
import { encryptOAuthToken, youtubeAnalyticsScope, youtubeReadonlyScope, youtubeUploadScope } from "@postbot/publishers";

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
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key, status: "RUNNING", budgetReserved: 1 } });
    await prisma.automationCostReservation.create({ data: { automationRunId: run.id, stage: "TTS", amount: 1, idempotencyKey: `automation:${run.id}:tts:youtube:cost` } });
    const payload = { automation: { runId: run.id, stage: "TTS", platform: "YOUTUBE" }, ttsPreparation: { channelId: channel.id, contentItemId: content.id, text: "Software verification.", voice: "fixture-voice", idempotencyKey: key } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "TTS", queueName: "tts", idempotencyKey: key, payload } });
    return { job, payload, run };
  };
  it("detects a revoked selected account before calling paid synthesis", async () => {
    const item = await fixture(); const channel = await prisma.channel.findUniqueOrThrow({ where: { id: item.run.channelId } });
    const key = "fixture-oauth-key"; vi.stubEnv("YOUTUBE_OAUTH_PROVIDER", "google"); vi.stubEnv("OAUTH_ENCRYPTION_KEY", key);
    const account = await prisma.platformAccount.create({ data: { workspaceId: channel.workspaceId, channelId: channel.id, platform: "YOUTUBE", externalAccountId: randomUUID(), credential: { create: { encryptedAccessToken: encryptOAuthToken("fixture-access", key), encryptedRefreshToken: encryptOAuthToken("fixture-refresh", key), tokenCipher: "aes-256-gcm", tokenKeyVersion: 1, scopeHash: "fixture", scopes: [youtubeAnalyticsScope, youtubeReadonlyScope, youtubeUploadScope], expiresAt: new Date(0) } } } });
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 })); vi.stubGlobal("fetch", network);
    await new DeterministicJobProcessor(prisma).process({ id: item.job.id, type: "TTS", queueName: "tts", runAfter: null, payload: item.payload });
    expect((await prisma.platformAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("EXPIRED");
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "ACCOUNT_REAUTH_REQUIRED" });
    expect(await prisma.providerUsage.count({ where: { productionJobId: item.job.id } })).toBe(0);
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } })).payload).not.toHaveProperty("_mediaCalls");
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([400, 429, 503])("keeps confirmed HTTP %s rejection separate from uncertain billing", async (status) => {
    const item = await fixture();
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status, headers: { "retry-after": "120" } })); vi.stubGlobal("fetch", network);
    const started = Date.now(); const processor = new DeterministicJobProcessor(prisma);
    const operation = processor.process({ id: item.job.id, type: "TTS", queueName: "tts", runAfter: null, payload: item.payload });
    if (status === 400) await operation; else await expect(operation).rejects.toThrow(status === 429 ? "PROVIDER_RATE_LIMIT_HTTP_429" : "PROVIDER_TRANSIENT_HTTP_503");
    const job = await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } });
    expect(job).toMatchObject({ status: status === 400 ? "NEEDS_REVIEW" : "RETRY_WAIT", payload: { _mediaCalls: { tts: "REJECTED" } } });
    const cache = await prisma.assetGenerationCache.findFirstOrThrow({ where: { ownerKey: item.job.id } });
    expect(cache.state).toBe("REJECTED");
    expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
    if (status !== 400) {
      expect(job.runAfter!.getTime()).toBeGreaterThanOrEqual(started + 120000);
      await expect(new AssetPreparationProcessor(prisma).processTts(item.payload, job.id)).rejects.toThrow("PROVIDER_RATE_LIMIT");
      expect(network).toHaveBeenCalledTimes(1);
    } else {
      expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: item.run.id } })).budgetReserved.toNumber()).toBe(0);
    }
  });
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
    const version = await prisma.sceneVersion.create({ data: { contentItemId: item.job.contentItemId!, platform: "YOUTUBE", version: 1, schemaVersion: "1.0.0", sceneDocument: { schemaVersion: "1.0.0", title: "Image", width: 1080, height: 1920, fps: 30, durationInFrames: 450, scenes: [{ id: "only", startFrame: 0, durationInFrames: 450, visualPrompt: "Software", narration: { text: "Software", sourceUrl: "https://example.com/source" }, overlays: [{ kind: "title", text: "Software" }] }] } } });
    await prisma.asset.create({ data: { channelId: item.job.channelId!, dedupScope: item.job.channelId!, checksumSha256: randomUUID(), storageKey: "unused-fallback", kind: "IMAGE", origin: "INTERNAL", mimeType: "image/png", licenses: { create: { status: "VERIFIED", licenseName: "Fixture", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false } } } });
    await prisma.automationCostReservation.create({ data: { automationRunId: item.run.id, stage: "ASSET", amount: 1, idempotencyKey: `automation:${item.run.id}:asset:youtube:cost` } });
    const payload = { automation: { runId: item.run.id, stage: "ASSET", platform: "YOUTUBE" }, assetPreparation: { platform: "YOUTUBE", channelId: item.job.channelId!, contentItemId: item.job.contentItemId!, sceneVersionId: version.id, prompt: "Software", idempotencyKey: item.job.idempotencyKey } };
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
