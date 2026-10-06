import { AssetPreparationService, AssetRepository, sceneAssetUsageKey } from "@postbot/asset-library";
import { loadConfig } from "@postbot/config";
import { AssetPreparationJobPayloadSchema, TtsPreparationJobPayloadSchema } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { FakeImageProvider, FakeStorageProvider, FakeTtsProvider, GoogleImageProvider, ElevenLabsTtsProvider, S3StorageProvider, resolveTtsVoice } from "@postbot/providers";
import { SceneDocumentSchema, aiSceneCount } from "@postbot/scene-schema";

export class AssetPreparationProcessor {
  private readonly preparation: AssetPreparationService;
  private readonly assets: AssetRepository;
  private readonly config = loadConfig();

  constructor(private readonly prisma: PrismaClient) {
    const storage = this.config.STORAGE_PROVIDER === "s3"
      ? new S3StorageProvider({ endpoint: this.config.S3_ENDPOINT, region: this.config.S3_REGION, bucket: this.config.S3_BUCKET, accessKeyId: this.config.S3_ACCESS_KEY_ID, secretAccessKey: this.config.S3_SECRET_ACCESS_KEY })
      : new FakeStorageProvider();
    const image = this.config.IMAGE_PROVIDER === "google"
      ? new GoogleImageProvider({ apiKey: this.config.GOOGLE_API_KEY, timeoutMs: this.config.IMAGE_TIMEOUT_MS, usdPerOutput: this.config.IMAGE_USD_PER_OUTPUT })
      : new FakeImageProvider();
    const tts = this.config.TTS_PROVIDER === "elevenlabs"
      ? new ElevenLabsTtsProvider({ apiKey: this.config.ELEVENLABS_API_KEY, timeoutMs: this.config.TTS_TIMEOUT_MS, usdPerThousandCharacters: this.config.TTS_USD_PER_THOUSAND_CHARACTERS })
      : new FakeTtsProvider();
    this.assets = new AssetRepository(prisma, storage);
    this.preparation = new AssetPreparationService(this.assets, image, tts);
  }

  async processAsset(payload: Record<string, unknown>, jobId: string): Promise<Record<string, unknown>> {
    const input = AssetPreparationJobPayloadSchema.parse(payload).assetPreparation;
    if (!input.contentItemId || !input.sceneVersionId) throw new Error("ASSET_CONTENT_AND_SCENE_REQUIRED");
    const version = await this.prisma.sceneVersion.findFirstOrThrow({ where: { id: input.sceneVersionId, contentItemId: input.contentItemId } });
    const document = SceneDocumentSchema.parse(version.sceneDocument);
    const platformKey = input.platform ?? "COMMON";
    const assets = [];
    const aiCount = aiSceneCount(document.scenes.length, document.aiStockRatio ?? 1);
    const stock = aiCount < document.scenes.length ? await this.assets.selectLicensedStock(input.channelId) : [];
    // Validate stock availability before making any paid AI requests.
    if (aiCount < document.scenes.length && stock.length === 0) return { assets: [], needsReview: true, reviewCode: "STOCK_ASSET_REQUIRED", contentItemId: input.contentItemId };
    for (const [index, scene] of document.scenes.entries()) {
      if (index >= aiCount) {
        const purpose = `scene-image:${platformKey}:${scene.id}`;
        const existing = await this.assets.findPreparedImage({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose });
        if (existing) { assets.push({ sceneId: scene.id, ...existing }); continue; }
        const selected = stock[(index - aiCount) % stock.length]!;
        await this.assets.attachUsage({ assetId: selected.assetId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, purpose, snapshot: { stock: true, license: "verified" } });
        assets.push({ sceneId: scene.id, assetId: selected.assetId, fallback: false, needsReview: false });
        continue;
      }
      const result = await this.preparation.prepareImage({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, productionJobId: jobId, purpose: `scene-image:${platformKey}:${scene.id}`, key: `images/${jobId}/${scene.id}`, prompt: scene.visualPrompt || input.prompt, model: this.config.IMAGE_MODEL, idempotencyKey: `${input.idempotencyKey}:${scene.id}` });
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
    const voice = resolveTtsVoice(this.config.TTS_PROVIDER, input.voice, this.config.ELEVENLABS_VOICE_ID);
    const result = await this.preparation.prepareTts({ channelId: input.channelId, contentItemId: input.contentItemId, sceneVersionId: input.sceneVersionId, productionJobId: jobId, purpose: input.platform ? `tts-narration:${input.platform}` : undefined, key: `audio/${jobId}`, text: input.text, voice, model: this.config.TTS_MODEL, idempotencyKey: input.idempotencyKey });
    return result;
  }
}
