import { createHash } from "node:crypto";
import { assertExecutionOwner, Prisma, type PrismaClient } from "@postbot/database";
import type { ImageProvider, ImageGenerationResult, StorageProvider, TtsProvider, TtsResult } from "@postbot/providers";
export { scoreStockMatch, type StockCandidate } from "./stock-matching.js";
import type { StockCandidate } from "./stock-matching.js";
import { cachedGeneration, generationInputKey, type GenerationReceipt } from "./generation-cache.js";
export { generationInputKey } from "./generation-cache.js";

export type AssetLicenseStatus = "verified" | "unknown" | "rejected" | "expired";

export type AssetLicenseSnapshot = {
  rightsPolicyId?: string;
  validFrom?: Date;
  validUntil?: Date;
  status: AssetLicenseStatus;
  commercialUseAllowed: boolean;
  derivativeAllowed: boolean;
  attributionRequired: boolean;
  attributionText: string | null;
  proofUrl: string | null;
};

export const checksumSha256 = (body: Uint8Array): string => createHash("sha256").update(body).digest("hex");

// The existing unique key includes purpose, not SceneVersion. Keep retries idempotent
// without moving an older scene's usage to a newly generated scene.
export const sceneAssetUsageKey = (purpose: string, sceneVersionId?: string | null): string =>
  sceneVersionId ? `${purpose.slice(0, 80)}:v:${createHash("sha256").update(JSON.stringify([purpose, sceneVersionId])).digest("hex").slice(0, 32)}` : purpose;

export const readAssetUsagePurpose = (usage: { purpose: string; usageSnapshot: Prisma.JsonValue | null }): string => {
  const snapshot = usage.usageSnapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot.originalPurpose === "string"
    ? snapshot.originalPurpose : usage.purpose;
};

export const isLicenseAllowedForGeneration = (license: AssetLicenseSnapshot): boolean =>
  license.status === "verified" && license.commercialUseAllowed && license.derivativeAllowed;

export const assetNeedsReview = (license: AssetLicenseSnapshot | null): boolean =>
  !license || !isLicenseAllowedForGeneration(license);

export type StoreAssetInput = { channelId: string | null; kind: "IMAGE" | "VIDEO" | "AUDIO" | "FONT" | "GRAPHIC"; origin: "INTERNAL" | "STOCK_FREE" | "STOCK_PAID" | "PUBLIC_DOMAIN" | "AI_GENERATED"; key: string; body: Uint8Array; mimeType: string; width?: number; height?: number; source: { provider: string; model?: string; prompt?: string; sourceUrl?: string }; license: AssetLicenseSnapshot };

export class AssetRepository {
  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageProvider) {}
  cachedGeneration(input: { channelId: string; inputKey: string; ownerKey: string; callKey?: string }, create: (providerKey: string) => Promise<GenerationReceipt>) { return cachedGeneration(this.prisma, this.storage, input, create); }
  async generationLicense(input: { channelId: string; provider: string; model: string; accountRef: string; contractVersion: string }): Promise<AssetLicenseSnapshot> {
    const now = new Date();
    const policy = input.accountRef && input.contractVersion ? await this.prisma.providerRightsPolicy.findFirst({ where: { ...input, validFrom: { lte: now } }, orderBy: { version: "desc" } }) : null;
    return policy && !policy.revokedAt && policy.validUntil > now && policy.commercialUseAllowed && policy.derivativeAllowed
      ? { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: policy.attributionRequired, attributionText: policy.attributionText, proofUrl: policy.proofUrl, rightsPolicyId: policy.id, validFrom: policy.validFrom, validUntil: policy.validUntil }
      : { status: "unknown", commercialUseAllowed: false, derivativeAllowed: false, attributionRequired: false, attributionText: null, proofUrl: null };
  }
  async getLicense(assetId: string): Promise<AssetLicenseSnapshot | null> {
    const license = await this.prisma.assetLicense.findFirst({ where: { assetId }, include: { rightsPolicy: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (!license) return null;
    const now = new Date();
    const expired = (license.validUntil && license.validUntil <= now) || (license.validFrom && license.validFrom > now) || Boolean(license.rightsPolicy?.revokedAt);
    return { status: expired ? "expired" : license.status === "VERIFIED" ? "verified" : license.status === "REJECTED" ? "rejected" : license.status === "EXPIRED" ? "expired" : "unknown", commercialUseAllowed: license.commercialUseAllowed, derivativeAllowed: license.derivativeAllowed, attributionRequired: license.attributionRequired, attributionText: license.attributionText, proofUrl: license.proofUrl };
  }

  async findPreparedImage(input: { channelId: string; contentItemId: string; sceneVersionId: string; purpose: string }): Promise<{ assetId: string; fallback: boolean; needsReview: boolean } | null> {
    const usage = await this.prisma.assetUsage.findFirst({ where: { contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, contentItem: { channelId: input.channelId }, purpose: sceneAssetUsageKey(input.purpose, input.sceneVersionId), asset: { kind: "IMAGE" } }, include: { asset: true } });
    if (!usage) return null;
    try { await this.storage.download(usage.asset.storageKey); } catch { throw new Error("PREPARED_IMAGE_OBJECT_MISSING_RESTORE_REQUIRED"); }
    const snapshot = usage.usageSnapshot;
    const fallback = Boolean(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && snapshot.fallback === true);
    return { assetId: usage.assetId, fallback, needsReview: assetNeedsReview(await this.getLicense(usage.assetId)) };
  }
  async findPreparedTts(input: { contentItemId: string; sceneVersionId?: string | null; purpose: string }): Promise<{ assetId: string; timings: { text: string; startSeconds: number; endSeconds: number }[] } | null> {
    const usage = await this.prisma.assetUsage.findFirst({ where: { contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId ?? null, purpose: sceneAssetUsageKey(input.purpose, input.sceneVersionId), asset: { kind: "AUDIO" } }, include: { asset: true } });
    const snapshot = usage?.usageSnapshot;
    if (!usage || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.timings)) return null;
    try { await this.storage.download(usage.asset.storageKey); } catch { throw new Error("PREPARED_TTS_OBJECT_MISSING_RESTORE_REQUIRED"); }
    const timings = snapshot.timings.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.text === "string" && typeof item.startSeconds === "number" && typeof item.endSeconds === "number" ? [{ text: item.text, startSeconds: item.startSeconds, endSeconds: item.endSeconds }] : []);
    return timings.length ? { assetId: usage.assetId, timings } : null;
  }
  async store(input: StoreAssetInput): Promise<{ assetId: string; duplicate: boolean }> {
    const checksum = checksumSha256(input.body);
    const existing = await this.prisma.asset.findUnique({ where: { dedupScope_checksumSha256: { dedupScope: input.channelId ?? "global", checksumSha256: checksum } } });
    if (existing) return { assetId: existing.id, duplicate: true };
    await this.storage.upload({ key: input.key, body: input.body, mimeType: input.mimeType });
    try {
      const asset = await this.prisma.asset.create({ data: { channelId: input.channelId, dedupScope: input.channelId ?? "global", kind: input.kind, origin: input.origin, storageKey: input.key, checksumSha256: checksum, mimeType: input.mimeType, width: input.width, height: input.height, sources: { create: { provider: input.source.provider, model: input.source.model, prompt: input.source.prompt, sourceUrl: input.source.sourceUrl } }, licenses: { create: { status: input.license.status === "verified" ? "VERIFIED" : input.license.status === "rejected" ? "REJECTED" : input.license.status === "expired" ? "EXPIRED" : "PENDING", licenseName: "snapshot", commercialUseAllowed: input.license.commercialUseAllowed, derivativeAllowed: input.license.derivativeAllowed, attributionRequired: input.license.attributionRequired, attributionText: input.license.attributionText, proofUrl: input.license.proofUrl, rightsPolicyId: input.license.rightsPolicyId, validFrom: input.license.validFrom, validUntil: input.license.validUntil, checkedAt: new Date() } } } });
      return { assetId: asset.id, duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const duplicate = await this.prisma.asset.findUniqueOrThrow({ where: { dedupScope_checksumSha256: { dedupScope: input.channelId ?? "global", checksumSha256: checksum } } }); return { assetId: duplicate.id, duplicate: true }; }
      await this.storage.delete(input.key);
      throw error;
    }
  }

  async findAllowedFallback(kind: StoreAssetInput["kind"], channelId: string | null = null): Promise<{ assetId: string; storageKey: string } | null> {
    const candidates = await this.prisma.asset.findMany({ where: { kind, channelId, licenses: { some: { status: "VERIFIED", commercialUseAllowed: true, derivativeAllowed: true } } }, include: { licenses: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } });
    const asset = candidates.find((candidate) => {
      const license = candidate.licenses[0];
      const now = new Date();
      return license?.status === "VERIFIED" && license.commercialUseAllowed && license.derivativeAllowed && (!license.validFrom || license.validFrom <= now) && (!license.validUntil || license.validUntil > now);
    });
    return asset ? { assetId: asset.id, storageKey: asset.storageKey } : null;
  }

  selectLicensedAudio(): Promise<{ assetId: string; storageKey: string } | null> {
    return this.findAllowedFallback("AUDIO");
  }

  async selectLicensedStock(channelId: string): Promise<StockCandidate[]> {
    const candidates = await this.prisma.asset.findMany({ where: { channelId, kind: "IMAGE", origin: { in: ["STOCK_FREE", "STOCK_PAID", "PUBLIC_DOMAIN", "INTERNAL"] } }, include: { sources: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] }, _count: { select: { usages: { where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } } } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const allowed: StockCandidate[] = [];
    for (const candidate of candidates) if (!assetNeedsReview(await this.getLicense(candidate.id))) {
      const source = candidate.sources.find((source) => source.providerResponse && typeof source.providerResponse === "object" && !Array.isArray(source.providerResponse) && ("description" in source.providerResponse || "tags" in source.providerResponse));
      const metadata = source?.providerResponse && typeof source.providerResponse === "object" && !Array.isArray(source.providerResponse) ? source.providerResponse : {};
      allowed.push({ assetId: candidate.id, storageKey: candidate.storageKey, description: typeof metadata.description === "string" ? metadata.description : "", tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === "string") : [], recentUseCount: candidate._count.usages });
    }
    return allowed;
  }

  async recordProviderCost(input: { contentItemId: string; productionJobId?: string; provider: string; model: string; operation: string; quantity: number; unit: string; category: string; estimatedCostUsd: string; idempotencyKey: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.providerUsage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return;
      const usage = await tx.providerUsage.create({ data: { contentItemId: input.contentItemId, productionJobId: input.productionJobId, provider: input.provider, model: input.model, operation: input.operation, quantity: new Prisma.Decimal(input.quantity), unit: input.unit, estimatedCost: new Prisma.Decimal(input.estimatedCostUsd), idempotencyKey: input.idempotencyKey } });
      await tx.costLedger.create({ data: { contentItemId: input.contentItemId, providerUsageId: usage.id, direction: "ESTIMATED", category: input.category, amount: new Prisma.Decimal(input.estimatedCostUsd), note: `model:${input.model}` } });
    });
  }

  async attachUsage(input: { assetId: string; contentItemId: string; sceneVersionId?: string | null; purpose: string; snapshot: Record<string, unknown> }): Promise<void> {
    const snapshot = { ...input.snapshot, originalPurpose: input.purpose } as Prisma.InputJsonObject;
    const purpose = sceneAssetUsageKey(input.purpose, input.sceneVersionId);
    await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.assetUsage.upsert({ where: { assetId_contentItemId_purpose: { assetId: input.assetId, contentItemId: input.contentItemId, purpose } }, update: { sceneVersionId: input.sceneVersionId, usageSnapshot: snapshot }, create: { assetId: input.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose, usageSnapshot: snapshot } });
    });
  }

  markContentNeedsReview(contentItemId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.contentItem.update({ where: { id: contentItemId }, data: { status: "REVIEW_REQUIRED" } });
    });
  }
}

export class AssetPreparationService {
  constructor(private readonly assets: AssetRepository, private readonly image: ImageProvider, private readonly tts: TtsProvider,
    private readonly options?: { imageProvider: string; ttsProvider: string; imageAccountRef: string; ttsAccountRef: string; imageContractVersion: string; ttsContractVersion: string }) {}
  async prepareImage(input: { channelId: string; contentItemId: string | null; sceneVersionId?: string | null; productionJobId?: string; purpose?: string; key: string; prompt: string; model: string; idempotencyKey: string; holdOnFailure?: boolean;
    inputVersions?: Prisma.InputJsonObject; skipSharedCache?: boolean; invoke?: (operation: () => Promise<ImageGenerationResult>) => Promise<ImageGenerationResult> }): Promise<{ assetId: string; fallback: boolean; needsReview: boolean }> {
    if (input.contentItemId && input.sceneVersionId) {
      const prepared = await this.assets.findPreparedImage({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "scene-image" });
      if (prepared) return prepared;
    }
    if (this.options && !input.skipSharedCache) {
      const inputKey = generationInputKey({ kind: "IMAGE", provider: this.options.imageProvider, model: input.model, accountRef: this.options.imageAccountRef, contractVersion: this.options.imageContractVersion,
        prompt: input.prompt, width: 1080, height: 1920, inputVersions: input.inputVersions ?? {} });
      const receipt = await this.assets.cachedGeneration({ channelId: input.channelId, inputKey, ownerKey: input.productionJobId ?? input.idempotencyKey, callKey: input.purpose?.startsWith("scene-image:") ? `image:${input.purpose.split(":").slice(2).join(":")}` : "image" }, async (providerKey) => {
        const result = await this.prepareImage({ ...input, idempotencyKey: providerKey, skipSharedCache: true });
        return { assetId: result.assetId, snapshot: { inputKey, prompt: input.prompt, model: input.model, provider: this.options!.imageProvider, fallback: result.fallback, inputVersions: input.inputVersions ?? {} } };
      });
      if (input.contentItemId) await this.assets.attachUsage({ assetId: receipt.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "scene-image", snapshot: receipt.snapshot });
      return { assetId: receipt.assetId, fallback: receipt.snapshot.fallback === true, needsReview: assetNeedsReview(await this.assets.getLicense(receipt.assetId)) };
    }
    try {
      const generate = () => this.image.generate({ ...input, width: 1080, height: 1920 });
      const result = await (input.invoke ? input.invoke(generate) : generate());
      if (input.contentItemId) await this.assets.recordProviderCost({ contentItemId: input.contentItemId, productionJobId: input.productionJobId, provider: result.provider, model: result.model, operation: "image-generation", quantity: 1, unit: "image", category: "image", estimatedCostUsd: result.estimatedCostUsd, idempotencyKey: `image:${input.idempotencyKey}` });
      const license = result.provider === "fake-image" ? { status: "verified" as const, commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null }
        : await this.assets.generationLicense({ channelId: input.channelId, provider: this.options?.imageProvider ?? result.provider, model: result.model, accountRef: this.options?.imageAccountRef ?? "", contractVersion: this.options?.imageContractVersion ?? "" });
      const stored = await this.assets.store({ channelId: input.channelId, kind: "IMAGE", origin: "AI_GENERATED", key: input.key, body: result.bytes, mimeType: result.mimeType, width: result.width, height: result.height, source: { provider: result.provider, model: result.model, prompt: input.prompt }, license });
      if (input.contentItemId) await this.assets.attachUsage({ assetId: stored.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "scene-image", snapshot: { prompt: input.prompt, provider: result.provider, model: result.model, license: "provider-generated" } });
      const needsReview = assetNeedsReview(await this.assets.getLicense(stored.assetId));
      if (needsReview && input.contentItemId) await this.assets.markContentNeedsReview(input.contentItemId);
      return { assetId: stored.assetId, fallback: false, needsReview };
    } catch (error) {
      if (input.holdOnFailure) throw error;
      const fallback = await this.assets.findAllowedFallback("IMAGE", input.channelId);
      if (!fallback) throw new Error("IMAGE_GENERATION_FAILED_NO_FALLBACK");
      if (input.contentItemId) await this.assets.attachUsage({ assetId: fallback.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "scene-image", snapshot: { fallback: true, license: "verified" } });
      return { assetId: fallback.assetId, fallback: true, needsReview: false };
    }
  }
  async prepareTts(input: { channelId: string; contentItemId: string; sceneVersionId?: string | null; productionJobId?: string; purpose?: string; key: string; text: string; voice: string; model: string; idempotencyKey: string;
    normalization?: Prisma.InputJsonObject; inputVersions?: Prisma.InputJsonObject; skipSharedCache?: boolean; invoke?: (operation: () => Promise<TtsResult>) => Promise<TtsResult> }): Promise<{ assetId: string; timings: { text: string; startSeconds: number; endSeconds: number }[]; needsReview: boolean }> {
    const existing = await this.assets.findPreparedTts({ contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "tts-narration" });
    if (existing) return { ...existing, needsReview: assetNeedsReview(await this.assets.getLicense(existing.assetId)) };
    if (this.options && !input.skipSharedCache) {
      const inputKey = generationInputKey({ kind: "TTS", provider: this.options.ttsProvider, model: input.model, voice: input.voice, text: input.text,
        accountRef: this.options.ttsAccountRef, contractVersion: this.options.ttsContractVersion, normalization: input.normalization ?? null, inputVersions: input.inputVersions ?? {} });
      const receipt = await this.assets.cachedGeneration({ channelId: input.channelId, inputKey, ownerKey: input.productionJobId ?? input.idempotencyKey, callKey: "tts" }, async (providerKey) => {
        const result = await this.prepareTts({ ...input, idempotencyKey: providerKey, skipSharedCache: true });
        return { assetId: result.assetId, snapshot: { inputKey, voice: input.voice, text: input.text, normalization: input.normalization ?? null, model: input.model, provider: this.options!.ttsProvider, timings: result.timings, durationSeconds: result.timings.at(-1)?.endSeconds ?? 0 } };
      });
      await this.assets.attachUsage({ assetId: receipt.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "tts-narration", snapshot: receipt.snapshot });
      const prepared = await this.assets.findPreparedTts({ contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "tts-narration" });
      if (!prepared) throw new Error("ASSET_CACHE_TTS_TIMINGS_INVALID");
      return { ...prepared, needsReview: assetNeedsReview(await this.assets.getLicense(prepared.assetId)) };
    }
    const synthesize = () => this.tts.synthesize({ model: input.model, voice: input.voice, text: input.text, idempotencyKey: input.idempotencyKey });
    const result = await (input.invoke ? input.invoke(synthesize) : synthesize());
    await this.assets.recordProviderCost({ contentItemId: input.contentItemId, productionJobId: input.productionJobId, provider: result.provider, model: result.model, operation: "speech-synthesis", quantity: input.text.length, unit: "character", category: "tts", estimatedCostUsd: result.estimatedCostUsd, idempotencyKey: `tts:${input.idempotencyKey}` });
    const fake = result.provider === "fake-tts";
    const license = fake ? { status: "verified" as const, commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null }
      : await this.assets.generationLicense({ channelId: input.channelId, provider: this.options?.ttsProvider ?? result.provider, model: result.model, accountRef: this.options?.ttsAccountRef ?? "", contractVersion: this.options?.ttsContractVersion ?? "" });
    const stored = await this.assets.store({ channelId: input.channelId, kind: "AUDIO", origin: "AI_GENERATED", key: input.key, body: result.bytes, mimeType: result.mimeType, source: { provider: result.provider, model: result.model, prompt: input.text }, license });
    await this.assets.attachUsage({ assetId: stored.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: input.purpose ?? "tts-narration", snapshot: { voice: input.voice, text: input.text, normalization: input.normalization ?? null, durationSeconds: result.durationSeconds, timings: result.timings, provider: result.provider, model: result.model, license: "provider-generated" } });
    return { assetId: stored.assetId, timings: result.timings, needsReview: assetNeedsReview(await this.assets.getLicense(stored.assetId)) };
  }
}
