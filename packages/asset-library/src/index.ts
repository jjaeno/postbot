import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@postbot/database";
import type { ImageProvider, StorageProvider, TtsProvider } from "@postbot/providers";

export type AssetLicenseStatus = "verified" | "unknown" | "rejected" | "expired";

export type AssetLicenseSnapshot = {
  status: AssetLicenseStatus;
  commercialUseAllowed: boolean;
  derivativeAllowed: boolean;
  attributionRequired: boolean;
  attributionText: string | null;
  proofUrl: string | null;
};

export const checksumSha256 = (body: Uint8Array): string => createHash("sha256").update(body).digest("hex");

export const isLicenseAllowedForGeneration = (license: AssetLicenseSnapshot): boolean =>
  license.status === "verified" && license.commercialUseAllowed && license.derivativeAllowed;

export const assetNeedsReview = (license: AssetLicenseSnapshot | null): boolean =>
  !license || !isLicenseAllowedForGeneration(license);

export type StoreAssetInput = { channelId: string | null; kind: "IMAGE" | "VIDEO" | "AUDIO" | "FONT" | "GRAPHIC"; origin: "INTERNAL" | "STOCK_FREE" | "STOCK_PAID" | "PUBLIC_DOMAIN" | "AI_GENERATED"; key: string; body: Uint8Array; mimeType: string; source: { provider: string; model?: string; prompt?: string; sourceUrl?: string }; license: AssetLicenseSnapshot };

export class AssetRepository {
  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageProvider) {}
  async store(input: StoreAssetInput): Promise<{ assetId: string; duplicate: boolean }> {
    const checksum = checksumSha256(input.body);
    const existing = await this.prisma.asset.findUnique({ where: { checksumSha256: checksum } });
    if (existing) return { assetId: existing.id, duplicate: true };
    await this.storage.upload({ key: input.key, body: input.body, mimeType: input.mimeType });
    try {
      const asset = await this.prisma.asset.create({ data: { channelId: input.channelId, kind: input.kind, origin: input.origin, storageKey: input.key, checksumSha256: checksum, mimeType: input.mimeType, sources: { create: { provider: input.source.provider, model: input.source.model, prompt: input.source.prompt, sourceUrl: input.source.sourceUrl } }, licenses: { create: { status: input.license.status === "verified" ? "VERIFIED" : input.license.status === "rejected" ? "REJECTED" : input.license.status === "expired" ? "EXPIRED" : "PENDING", licenseName: "snapshot", commercialUseAllowed: input.license.commercialUseAllowed, derivativeAllowed: input.license.derivativeAllowed, attributionRequired: input.license.attributionRequired, attributionText: input.license.attributionText, proofUrl: input.license.proofUrl } } } });
      return { assetId: asset.id, duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const duplicate = await this.prisma.asset.findUniqueOrThrow({ where: { checksumSha256: checksum } }); return { assetId: duplicate.id, duplicate: true }; }
      await this.storage.delete(input.key);
      throw error;
    }
  }

  async findAllowedFallback(kind: StoreAssetInput["kind"]): Promise<{ assetId: string; storageKey: string } | null> {
    const asset = await this.prisma.asset.findFirst({ where: { kind, licenses: { some: { status: "VERIFIED", commercialUseAllowed: true, derivativeAllowed: true } } }, orderBy: { createdAt: "asc" } });
    return asset ? { assetId: asset.id, storageKey: asset.storageKey } : null;
  }

  selectLicensedAudio(): Promise<{ assetId: string; storageKey: string } | null> {
    return this.findAllowedFallback("AUDIO");
  }

  async recordTtsCost(input: { contentItemId: string; model: string; totalCharacters: number; estimatedCostUsd: string; idempotencyKey: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.providerUsage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return;
      const usage = await tx.providerUsage.create({ data: { contentItemId: input.contentItemId, provider: "tts", model: input.model, operation: "speech-synthesis", quantity: new Prisma.Decimal(input.totalCharacters), unit: "character", estimatedCost: new Prisma.Decimal(input.estimatedCostUsd), idempotencyKey: input.idempotencyKey } });
      await tx.costLedger.create({ data: { contentItemId: input.contentItemId, providerUsageId: usage.id, direction: "ESTIMATED", category: "tts", amount: new Prisma.Decimal(input.estimatedCostUsd), note: `model:${input.model}` } });
    });
  }

  async attachUsage(input: { assetId: string; contentItemId: string; purpose: string; snapshot: Record<string, unknown> }): Promise<void> {
    const snapshot = input.snapshot as Prisma.InputJsonObject;
    await this.prisma.assetUsage.upsert({ where: { assetId_contentItemId_purpose: { assetId: input.assetId, contentItemId: input.contentItemId, purpose: input.purpose } }, update: { usageSnapshot: snapshot }, create: { assetId: input.assetId, contentItemId: input.contentItemId, purpose: input.purpose, usageSnapshot: snapshot } });
  }

  markContentNeedsReview(contentItemId: string): Promise<void> {
    return this.prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "REVIEW_REQUIRED" } }).then(() => undefined);
  }
}

export class AssetPreparationService {
  constructor(private readonly assets: AssetRepository, private readonly image: ImageProvider, private readonly tts: TtsProvider) {}
  async prepareImage(input: { channelId: string; contentItemId: string | null; key: string; prompt: string; model: string; idempotencyKey: string }): Promise<{ assetId: string; fallback: boolean; needsReview: boolean }> {
    try {
      const result = await this.image.generate({ ...input, width: 1080, height: 1920 });
      const license = result.provider === "fake-image" ? { status: "verified" as const, commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null } : { status: "unknown" as const, commercialUseAllowed: false, derivativeAllowed: false, attributionRequired: false, attributionText: null, proofUrl: null };
      const stored = await this.assets.store({ channelId: input.channelId, kind: "IMAGE", origin: "AI_GENERATED", key: input.key, body: result.bytes, mimeType: result.mimeType, source: { provider: result.provider, model: result.model, prompt: input.prompt }, license });
      if (input.contentItemId) await this.assets.attachUsage({ assetId: stored.assetId, contentItemId: input.contentItemId, purpose: "scene-image", snapshot: { prompt: input.prompt, provider: result.provider, model: result.model, license: "provider-generated" } });
      const needsReview = assetNeedsReview(license);
      if (needsReview && input.contentItemId) await this.assets.markContentNeedsReview(input.contentItemId);
      return { assetId: stored.assetId, fallback: false, needsReview };
    } catch {
      const fallback = await this.assets.findAllowedFallback("IMAGE");
      if (!fallback) throw new Error("IMAGE_GENERATION_FAILED_NO_FALLBACK");
      if (input.contentItemId) await this.assets.attachUsage({ assetId: fallback.assetId, contentItemId: input.contentItemId, purpose: "scene-image", snapshot: { fallback: true, license: "verified" } });
      return { assetId: fallback.assetId, fallback: true, needsReview: false };
    }
  }
  async prepareTts(input: { channelId: string; contentItemId: string; key: string; text: string; voice: string; model: string; idempotencyKey: string }): Promise<{ assetId: string; timings: { text: string; startSeconds: number; endSeconds: number }[] }> {
    const result = await this.tts.synthesize({ model: input.model, voice: input.voice, text: input.text, idempotencyKey: input.idempotencyKey });
    const stored = await this.assets.store({ channelId: input.channelId, kind: "AUDIO", origin: "AI_GENERATED", key: input.key, body: result.bytes, mimeType: result.mimeType, source: { provider: result.provider, model: result.model, prompt: input.text }, license: { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null } });
    await this.assets.attachUsage({ assetId: stored.assetId, contentItemId: input.contentItemId, purpose: "tts-narration", snapshot: { timings: result.timings, provider: result.provider, model: result.model, license: "provider-generated" } });
    await this.assets.recordTtsCost({ contentItemId: input.contentItemId, model: result.model, totalCharacters: input.text.length, estimatedCostUsd: result.estimatedCostUsd, idempotencyKey: `tts:${input.idempotencyKey}` });
    return { assetId: stored.assetId, timings: result.timings };
  }
}
