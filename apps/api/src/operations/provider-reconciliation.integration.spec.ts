import { PrismaClient } from "@postbot/database";
import { AssetRepository } from "@postbot/asset-library";
import { FakeStorageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { reconcileProviderOutcome } from "./provider-reconciliation.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("evidence fenced provider outcomes", () => {
  const prisma = new PrismaClient(); afterAll(() => prisma.$disconnect());
  async function fixture(type: "TTS" | "SCRIPT") {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@outcome.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key } });
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type, queueName: type.toLowerCase(), idempotencyKey: key, status: "NEEDS_REVIEW", errorCode: "AMBIGUOUS_PROVIDER_CALL_RECONCILIATION_REQUIRED", payload: type === "TTS" ? { _mediaCalls: { tts: "STARTED" } } : { _llmAttempts: { [`${key}:attempt:1`]: { state: "STARTED" } } }, result: { reconciliationRequired: true } } });
    return { key, user, workspace, channel, content, job };
  }
  it("preserves the original journal evidence when an owner confirms a rejected request", async () => {
    const f = await fixture("SCRIPT");
    const input = { idempotencyKey: f.key, journal: "LLM", callKey: `${f.key}:attempt:1`, outcome: "NOT_ACCEPTED", evidenceHash: "a".repeat(64), externalReference: "support-case-fixture" };
    const results = await Promise.all([reconcileProviderOutcome(prisma, f.workspace.id, f.user.id, "OWNER", f.job.id, input), reconcileProviderOutcome(prisma, f.workspace.id, f.user.id, "OWNER", f.job.id, input)]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    const job = await prisma.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(job).toMatchObject({ errorCode: "PROVIDER_OUTCOME_RECONCILED", result: { reconciliationRequired: false }, payload: { _llmAttempts: { [input.callKey]: { state: "REJECTED" } }, _providerReconciliations: { [f.key]: { original: { state: "STARTED" }, evidenceHash: input.evidenceHash } } } });
    expect(await prisma.auditLog.count({ where: { targetId: job.id, action: "provider.outcome_reconciled" } })).toBe(1);
    await expect(reconcileProviderOutcome(prisma, f.workspace.id, f.user.id, "EDITOR", job.id, input)).rejects.toThrow("OWNER_ROLE_REQUIRED");
    await expect(reconcileProviderOutcome(prisma, "foreign", f.user.id, "OWNER", job.id, input)).rejects.toThrow("JOB_NOT_FOUND");
    await expect(reconcileProviderOutcome(prisma, f.workspace.id, f.user.id, "OWNER", job.id, { ...input, evidenceHash: "b".repeat(64) })).rejects.toThrow("PROVIDER_RECONCILIATION_IDEMPOTENCY_CONFLICT");
  });
  it("links a recovered media result to the exact cache key and verifies reuse without another provider call", async () => {
    const f = await fixture("TTS"); const storage = new FakeStorageProvider(); const assets = new AssetRepository(prisma, storage);
    const asset = await prisma.asset.create({ data: { channelId: f.channel.id, kind: "AUDIO", origin: "AI_GENERATED", storageKey: f.key, checksumSha256: f.key, mimeType: "audio/wav" } });
    await storage.upload({ key: f.key, body: new Uint8Array([1, 2]), mimeType: "audio/wav" });
    const snapshot = { originalPurpose: "tts-narration", voice: "fixture", text: "hello", durationSeconds: 1, timings: [{ text: "hello", startSeconds: 0, endSeconds: 1 }] };
    const usage = await prisma.assetUsage.create({ data: { assetId: asset.id, contentItemId: f.content.id, purpose: "tts-narration", usageSnapshot: snapshot } });
    const cache = await prisma.assetGenerationCache.create({ data: { channelId: f.channel.id, inputKey: "c".repeat(64), ownerKey: f.job.id, state: "AMBIGUOUS" } });
    const billing = await prisma.providerUsage.create({ data: { contentItemId: f.content.id, productionJobId: f.job.id, provider: "fixture", operation: "tts", quantity: 5, unit: "character", estimatedCost: 1, idempotencyKey: `tts:asset-cache:${cache.id}` } });
    const input = { idempotencyKey: f.key, journal: "MEDIA", callKey: "tts", outcome: "RESULT_AVAILABLE", evidenceHash: "b".repeat(64), externalReference: "generation-fixture", cacheId: cache.id, assetUsageId: usage.id, providerUsageId: billing.id };
    await expect(reconcileProviderOutcome(prisma, f.workspace.id, f.user.id, "OWNER", f.job.id, { ...input, assetUsageId: "foreign" })).rejects.toThrow("RECOVERED_MEDIA_RECEIPT_SCOPE_MISMATCH");
    await reconcileProviderOutcome(prisma, f.workspace.id, f.user.id, "OWNER", f.job.id, input);
    expect((await prisma.assetGenerationCache.findUniqueOrThrow({ where: { id: cache.id } })).callKey).toBe("tts");
    expect(await assets.cachedGeneration({ channelId: f.channel.id, inputKey: cache.inputKey, ownerKey: f.job.id }, () => { throw new Error("MUST_NOT_REGENERATE"); })).toMatchObject({ assetId: asset.id, snapshot });
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: f.job.id } })).payload).toMatchObject({ _mediaCalls: { tts: "COMPLETED" } });
  });
});
