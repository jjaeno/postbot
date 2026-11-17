import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ReconcileProviderOutcomeSchema } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { loadConfig } from "@postbot/config";
import { createHash } from "node:crypto";

const object = (value: Prisma.JsonValue | undefined): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export async function reconcileProviderOutcome(prisma: PrismaClient, workspaceId: string, userId: string, role: string, jobId: string, raw: unknown) {
  if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
  const input = ReconcileProviderOutcomeSchema.parse(raw);
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.productionJob.findFirst({ where: { id: jobId, channel: { workspaceId } } });
    if (!job) throw new NotFoundException("JOB_NOT_FOUND");
    const payload = object(job.payload); const proofs = object(payload._providerReconciliations);
    const prior = object(proofs[input.idempotencyKey]);
    if (prior.digest) {
      if (prior.digest !== digest) throw new ConflictException("PROVIDER_RECONCILIATION_IDEMPOTENCY_CONFLICT");
      return { ok: true as const, duplicate: true };
    }
    if (!["NEEDS_REVIEW", "FAILED"].includes(job.status)) throw new ConflictException("PROVIDER_RECONCILIATION_REQUIRES_HELD_JOB");
    const field = input.journal === "MEDIA" ? "_mediaCalls" : "_llmAttempts";
    if (input.journal === "LLM" && job.type !== "SCRIPT" || input.journal === "MEDIA" && !["ASSET", "TTS"].includes(job.type)) throw new ConflictException("CALL_TYPE_MISMATCH");
    if (job.type === "TTS" && input.callKey !== "tts" || job.type === "ASSET" && !input.callKey.startsWith("image:")) throw new ConflictException("CALL_KEY_MISMATCH");
    const journal = object(payload[field]); const original = journal[input.callKey];
    if (!(input.journal === "MEDIA" ? original === "STARTED" : object(original).state === "STARTED")) throw new ConflictException("CALL_IS_NOT_AMBIGUOUS");
    let resolved: Prisma.InputJsonValue = "REJECTED";
    if (input.journal === "LLM") {
      if (input.outcome === "RESULT_AVAILABLE") {
        const response = input.llmResponse; const config = loadConfig();
        if (!response || response.idempotencyKey !== input.callKey || response.usage.totalTokens !== response.usage.promptTokens + response.usage.completionTokens) throw new ConflictException("LLM_RECEIPT_SCOPE_MISMATCH");
        if (!(config.LLM_INPUT_USD_PER_MILLION_TOKENS > 0 && config.LLM_OUTPUT_USD_PER_MILLION_TOKENS > 0)) throw new ConflictException("LLM_PRICING_REQUIRED");
        const estimatedCostUsd = new Prisma.Decimal(response.usage.promptTokens).mul(config.LLM_INPUT_USD_PER_MILLION_TOKENS).plus(new Prisma.Decimal(response.usage.completionTokens).mul(config.LLM_OUTPUT_USD_PER_MILLION_TOKENS)).div(1000000).toFixed(6);
        resolved = { state: "COMPLETED", response: { ...response, estimatedCostUsd } };
      } else {
        const known = await tx.providerUsage.findUnique({ where: { idempotencyKey: `script-attempt-cost:${jobId}:${input.callKey.split(":").at(-1)}` } });
        if (known && (known.actualCost ?? known.estimatedCost)?.gt(0)) throw new ConflictException("NOT_ACCEPTED_CONFLICTS_WITH_KNOWN_USAGE");
        resolved = { state: "REJECTED" };
      }
    } else {
      const cache = input.cacheId ? await tx.assetGenerationCache.findFirst({ where: { id: input.cacheId, ownerKey: jobId, OR: [{ callKey: input.callKey }, { callKey: null }], channelId: job.channelId ?? "", state: "AMBIGUOUS" } }) : null;
      if (!cache) throw new ConflictException("ORIGINAL_GENERATION_CACHE_REQUIRED");
      if (cache.callKey === null) {
        const pending = Object.entries(journal).filter(([, value]) => value === "STARTED").map(([key]) => key);
        const count = await tx.assetGenerationCache.count({ where: { ownerKey: jobId, state: "AMBIGUOUS", callKey: null } });
        if (count !== 1 || pending.length !== 1 || pending[0] !== input.callKey) throw new ConflictException("LEGACY_CALL_SCOPE_REVIEW_REQUIRED");
        await tx.assetGenerationCache.update({ where: { id: cache.id }, data: { callKey: input.callKey } });
      }
      if (input.outcome === "RESULT_AVAILABLE") {
        const usage = input.assetUsageId ? await tx.assetUsage.findFirst({ where: { id: input.assetUsageId, contentItemId: job.contentItemId ?? "", asset: { channelId: job.channelId } }, include: { asset: true } }) : null;
        const billing = input.providerUsageId ? await tx.providerUsage.findFirst({ where: { id: input.providerUsageId, productionJobId: jobId, idempotencyKey: `${job.type === "TTS" ? "tts" : "image"}:asset-cache:${cache.id}` } }) : null;
        const sceneId = object(payload[job.type === "TTS" ? "ttsPreparation" : "assetPreparation"]).sceneVersionId;
        const snapshot = object(usage?.usageSnapshot);
        const purpose = snapshot.originalPurpose ?? usage?.purpose;
        const expectedPurpose = job.type === "TTS" ? /^tts-narration(?::(?:YOUTUBE|INSTAGRAM|TIKTOK))?$/ : new RegExp(`^scene-image:(?:YOUTUBE|INSTAGRAM|TIKTOK|COMMON):${input.callKey.replace(/^image:/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
        if (!usage || !billing || usage.asset.kind !== (job.type === "TTS" ? "AUDIO" : "IMAGE") || (typeof sceneId === "string" && usage.sceneVersionId !== sceneId) || typeof purpose !== "string" || !expectedPurpose.test(purpose) || (job.type === "TTS" && !Array.isArray(snapshot.timings))) throw new ConflictException("RECOVERED_MEDIA_RECEIPT_SCOPE_MISMATCH");
        await tx.assetGenerationCache.update({ where: { id: cache.id }, data: { state: "READY", assetId: usage.assetId, snapshot } });
        resolved = "COMPLETED";
      } else {
        const known = await tx.providerUsage.findUnique({ where: { idempotencyKey: `${job.type === "TTS" ? "tts" : "image"}:asset-cache:${cache.id}` } });
        if (known && (known.actualCost ?? known.estimatedCost)?.gt(0)) throw new ConflictException("NOT_ACCEPTED_CONFLICTS_WITH_KNOWN_USAGE");
        await tx.assetGenerationCache.update({ where: { id: cache.id }, data: { state: "REJECTED", snapshot: { reconciled: true, evidenceHash: input.evidenceHash } } });
      }
    }
    const updatedJournal = { ...journal, [input.callKey]: resolved };
    const updatedPayload = { ...payload, [field]: updatedJournal, _providerReconciliations: { ...proofs, [input.idempotencyKey]: { digest, original: original ?? null, outcome: input.outcome, evidenceHash: input.evidenceHash, externalReference: input.externalReference, userId, resolvedAt: new Date().toISOString() } } };
    const uncertain = JSON.stringify([updatedPayload._mediaCalls, updatedPayload._llmAttempts]).includes('"STARTED"');
    await tx.productionJob.update({ where: { id: jobId }, data: { payload: updatedPayload, errorCode: uncertain ? job.errorCode : "PROVIDER_OUTCOME_RECONCILED", result: { ...object(job.result), reconciliationRequired: uncertain } } });
    await tx.auditLog.create({ data: { workspaceId, userId, action: "provider.outcome_reconciled", targetType: "productionJob", targetId: jobId, metadata: { callKey: input.callKey, outcome: input.outcome, evidenceHash: input.evidenceHash, externalReference: input.externalReference } } });
    return { ok: true as const, duplicate: false };
  });
}
