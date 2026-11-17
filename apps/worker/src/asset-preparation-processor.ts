import { scoreStockMatch, AssetPreparationService, AssetRepository, sceneAssetUsageKey } from "@postbot/asset-library";
import { loadConfig } from "@postbot/config";
import { AssetPreparationJobPayloadSchema, TtsPreparationJobPayloadSchema } from "@postbot/contracts";
import { assertExecutionOwner, type Prisma, type PrismaClient } from "@postbot/database";
import { FakeImageProvider, FakeStorageProvider, FakeTtsProvider, GoogleImageProvider, ElevenLabsTtsProvider, S3StorageProvider, resolveTtsVoice } from "@postbot/providers";
import type { StorageProvider } from "@postbot/providers";
import { SceneDocumentSchema, aiSceneCount, normalizeNarration } from "@postbot/scene-schema";
import { createHash } from "node:crypto";

export class AssetPreparationProcessor {
  private readonly preparation: AssetPreparationService;
  private readonly assets: AssetRepository;
  private readonly config = loadConfig();

  constructor(private readonly prisma: PrismaClient, options: { storage?: StorageProvider } = {}) {
    const storage = options.storage ?? (this.config.STORAGE_PROVIDER === "s3"
      ? new S3StorageProvider({ endpoint: this.config.S3_ENDPOINT, region: this.config.S3_REGION, bucket: this.config.S3_BUCKET, accessKeyId: this.config.S3_ACCESS_KEY_ID, secretAccessKey: this.config.S3_SECRET_ACCESS_KEY })
      : new FakeStorageProvider());
    const image = this.config.IMAGE_PROVIDER === "google"
      ? new GoogleImageProvider({ apiKey: this.config.GOOGLE_API_KEY, timeoutMs: this.config.IMAGE_TIMEOUT_MS, usdPerOutput: this.config.IMAGE_USD_PER_OUTPUT })
      : new FakeImageProvider();
    const tts = this.config.TTS_PROVIDER === "elevenlabs"
      ? new ElevenLabsTtsProvider({ apiKey: this.config.ELEVENLABS_API_KEY, timeoutMs: this.config.TTS_TIMEOUT_MS, usdPerThousandCharacters: this.config.TTS_USD_PER_THOUSAND_CHARACTERS })
      : new FakeTtsProvider();
    this.assets = new AssetRepository(prisma, storage);
    this.preparation = new AssetPreparationService(this.assets, image, tts, { imageProvider: this.config.IMAGE_PROVIDER, ttsProvider: this.config.TTS_PROVIDER,
      imageAccountRef: this.config.IMAGE_PROVIDER_ACCOUNT_REF || `unconfirmed:${createHash("sha256").update(this.config.GOOGLE_API_KEY).digest("hex")}`,
      ttsAccountRef: this.config.TTS_PROVIDER_ACCOUNT_REF || `unconfirmed:${createHash("sha256").update(this.config.ELEVENLABS_API_KEY).digest("hex")}`,
      imageContractVersion: this.config.IMAGE_PROVIDER_CONTRACT_VERSION, ttsContractVersion: this.config.TTS_PROVIDER_CONTRACT_VERSION });
  }

  private async realMediaCall<Result>(jobId: string, key: string, operation: () => Promise<Result>, canReuse: () => Promise<boolean>): Promise<Result> {
    await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
      const payload: Prisma.JsonObject = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
      const journal: Prisma.JsonObject = payload._mediaCalls && typeof payload._mediaCalls === "object" && !Array.isArray(payload._mediaCalls) ? payload._mediaCalls : {};
      if (journal[key] === "COMPLETED" && !(await canReuse())) throw new Error("AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED");
      if (journal[key] === "STARTED") throw new Error("AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED");
      if (journal[key] !== "COMPLETED") await tx.productionJob.update({ where: { id: jobId }, data: { payload: { ...payload, _mediaCalls: { ...journal, [key]: "STARTED" } } } });
    });
    try {
      const result = await operation();
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
        const job = await tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
        const payload: Prisma.JsonObject = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
        const journal = payload._mediaCalls && typeof payload._mediaCalls === "object" && !Array.isArray(payload._mediaCalls) ? payload._mediaCalls : {};
        await tx.productionJob.update({ where: { id: jobId }, data: { payload: { ...payload, _mediaCalls: { ...journal, [key]: "COMPLETED" } } } });
      });
      return result;
    } catch { throw new Error("AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED"); }
  }

  async processAsset(payload: Record<string, unknown>, jobId: string): Promise<Record<string, unknown>> {
    const input = AssetPreparationJobPayloadSchema.parse(payload).assetPreparation;
    if (!input.contentItemId || !input.sceneVersionId) throw new Error("ASSET_CONTENT_AND_SCENE_REQUIRED");
    const version = await this.prisma.sceneVersion.findFirstOrThrow({ where: { id: input.sceneVersionId, contentItemId: input.contentItemId } });
    const document = SceneDocumentSchema.parse(version.sceneDocument);
    const platformKey = input.platform ?? "COMMON";
    const assets = [];
    const imageScenes = document.scenes.filter((scene) => scene.visualMode !== "GRAPHIC");
    if (document.visualGuide?.referenceAssetIds.length) {
      const references = await this.prisma.asset.findMany({ where: { id: { in: document.visualGuide.referenceAssetIds }, channelId: input.channelId } });
      if (references.length !== document.visualGuide.referenceAssetIds.length) throw new Error("VISUAL_REFERENCE_SCOPE_INVALID");
      for (const reference of references) { const license = await this.assets.getLicense(reference.id); if (!license || license.status !== "verified" || !license.derivativeAllowed || !license.commercialUseAllowed) throw new Error("VISUAL_REFERENCE_RIGHTS_REVIEW_REQUIRED"); }
    }
    const aiCount = aiSceneCount(imageScenes.length, document.aiStockRatio ?? 1);
    const stock = aiCount < imageScenes.length ? await this.assets.selectLicensedStock(input.channelId) : [];
    // Validate stock availability before making any paid AI requests.
    if (aiCount < imageScenes.length && stock.length === 0) return { assets: [], needsReview: true, reviewCode: "STOCK_ASSET_REQUIRED", contentItemId: input.contentItemId };
    const selections = new Map<string, typeof stock[number]>();
    const uses = new Map<string, number>();
    for (const scene of imageScenes.slice(aiCount)) {
      const prepared = await this.assets.findPreparedImage({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose: `scene-image:${platformKey}:${scene.id}` });
      const ranked = stock.map((asset) => ({ asset, score: scoreStockMatch(scene.visualPrompt, asset, uses.get(asset.assetId) ?? 0) }))
        .filter((entry) => entry.score >= 0.25 && (!prepared || prepared.assetId === entry.asset.assetId))
        .sort((left, right) => right.score - left.score || left.asset.assetId.localeCompare(right.asset.assetId));
      const selected = ranked[0]?.asset;
      if (!selected) return { assets: [], needsReview: true, reviewCode: "STOCK_MATCH_REQUIRED", sceneId: scene.id, metadataMissing: stock.every((asset) => !asset.description && !asset.tags.length), contentItemId: input.contentItemId };
      selections.set(scene.id, selected); uses.set(selected.assetId, (uses.get(selected.assetId) ?? 0) + 1);
    }
    for (const [index, scene] of imageScenes.entries()) {
      if (index >= aiCount) {
        const purpose = `scene-image:${platformKey}:${scene.id}`;
        const existing = await this.assets.findPreparedImage({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose });
        if (existing) { assets.push({ sceneId: scene.id, ...existing }); continue; }
        const selected = selections.get(scene.id)!;
        await this.assets.attachUsage({ assetId: selected.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose, snapshot: { stock: true, license: "verified", matchScore: scoreStockMatch(scene.visualPrompt, selected), method: "LEXICAL_METADATA_V1" } });
        assets.push({ sceneId: scene.id, assetId: selected.assetId, fallback: false, needsReview: false });
        continue;
      }
      if (this.config.IMAGE_PROVIDER === "google" && !(this.config.IMAGE_USD_PER_OUTPUT > 0)) throw new Error("IMAGE_PRICING_REQUIRED");
      const prompt = JSON.stringify({ guide: document.visualGuide ?? null, requirements: scene.visualRequirements ?? null, scene: scene.visualPrompt || input.prompt, narration: scene.narration.text,
        note: "Reference identifiers are internal continuity records. No image-reference conditioning is supported by this adapter." });
      const result = await this.preparation.prepareImage({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, productionJobId: jobId, purpose: `scene-image:${platformKey}:${scene.id}`, key: `images/${jobId}/${scene.id}`, prompt, model: this.config.IMAGE_MODEL, idempotencyKey: `${input.idempotencyKey}:${scene.id}`, holdOnFailure: this.config.IMAGE_PROVIDER === "google",
        inputVersions: { promptVersion: "scene-image-v2", settingsVersion: "image-settings-v1", guideVersion: document.visualGuide?.version ?? "legacy", sourceUrl: scene.narration.sourceUrl },
        ...(this.config.IMAGE_PROVIDER === "google" ? { invoke: (operation) => this.realMediaCall(jobId, `image:${scene.id}`, operation, () => Promise.resolve(false)) } : {}) });
      assets.push({ sceneId: scene.id, ...result });
    }
    return { assets, needsReview: assets.some((asset) => asset.needsReview), contentItemId: input.contentItemId };
  }

  async processTts(payload: Record<string, unknown>, jobId: string): Promise<Record<string, unknown>> {
    const input = TtsPreparationJobPayloadSchema.parse(payload).ttsPreparation;
    const automation = payload.automation;
    const runId = automation && typeof automation === "object" && !Array.isArray(automation) && "runId" in automation ? automation.runId : null;
    if (typeof runId === "string") {
      const run = await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { checkpoint: true } });
      const checkpoint = run?.checkpoint;
      if (checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) && checkpoint.partial === "subtitle") {
        const usage = await this.prisma.assetUsage.findFirst({ where: { sceneVersionId: input.sceneVersionId, contentItemId: input.contentItemId, purpose: sceneAssetUsageKey(input.platform ? `tts-narration:${input.platform}` : "tts-narration", input.sceneVersionId) } });
        if (!usage) throw new Error("SUBTITLE_NARRATION_REQUIRED");
        return { assetId: usage.assetId, reused: true };
      }
    }
    if (this.config.TTS_PROVIDER === "elevenlabs" && !(this.config.TTS_USD_PER_THOUSAND_CHARACTERS > 0)) throw new Error("TTS_PRICING_REQUIRED");
    const voice = resolveTtsVoice(this.config.TTS_PROVIDER, input.voice, this.config.ELEVENLABS_VOICE_ID);
    const linked = input.sceneVersionId ? await this.prisma.sceneVersion.findUnique({ where: { id: input.sceneVersionId }, include: { scriptVersion: true } }) : null;
    const normalization = normalizeNarration(input.text, input.language ?? linked?.scriptVersion?.language ?? "en", input.pronunciations);
    if (this.config.TTS_PROVIDER === "elevenlabs" && !jobId) throw new Error("REAL_PROVIDER_JOB_REQUIRED");
    const result = await this.preparation.prepareTts({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, productionJobId: jobId, purpose: input.platform ? `tts-narration:${input.platform}` : undefined, key: `audio/${jobId}`, text: normalization.speech, normalization, voice, model: this.config.TTS_MODEL, idempotencyKey: input.idempotencyKey,
      inputVersions: { normalizationVersion: normalization.version, settingsVersion: "tts-settings-v1" },
      ...(this.config.TTS_PROVIDER === "elevenlabs" ? { invoke: (operation) => this.realMediaCall(jobId, "tts", operation, () => Promise.resolve(false)) } : {}) });
    return result;
  }
}
