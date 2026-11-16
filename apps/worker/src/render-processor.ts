import { assertExecutionOwner } from "@postbot/database";
import { loadConfig } from "@postbot/config";
import { readAssetUsagePurpose, AssetRepository, assetNeedsReview } from "@postbot/asset-library";
import { RenderJobPayloadSchema } from "@postbot/contracts";
import type { Prisma, PrismaClient } from "@postbot/database";
import { FakeStorageProvider, S3StorageProvider, type StorageProvider } from "@postbot/providers";
import { FfmpegPostProcessor, RemotionVideoRenderer, type FfprobeResult, type VideoRenderer } from "@postbot/renderer";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptionTiming } from "@postbot/renderer";
import { retimeNarration, SceneDocumentSchema } from "@postbot/scene-schema";

export interface MediaPostProcessor {
  postprocess(input: { videoInput: string; output: string; narrationInput?: string; backgroundInput?: string; effectsInput?: string; backgroundVolume?: number; effectsVolume?: number }): Promise<void>;
  thumbnail(videoInput: string, output: string): Promise<void>;
  probe(videoInput: string): Promise<FfprobeResult>;
}

const readCaptions = (snapshot: Prisma.JsonValue | null): CaptionTiming[] => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const timings = (snapshot as Record<string, unknown>).timings;
  if (!Array.isArray(timings)) return [];
  return timings.flatMap((timing) => {
    if (!timing || typeof timing !== "object" || Array.isArray(timing)) return [];
    const value = timing as Record<string, unknown>;
    return typeof value.text === "string" && typeof value.startSeconds === "number" && typeof value.endSeconds === "number"
      ? [{ text: value.text, startSeconds: value.startSeconds, endSeconds: value.endSeconds }]
      : [];
  });
};

export const sceneIdFromImagePurpose = (purpose: string, platform: string): string | null => {
  const prefix = `scene-image:${platform}:`;
  return purpose.startsWith(prefix) && purpose.length > prefix.length ? purpose.slice(prefix.length) : null;
};

export class RenderProcessor {
  private readonly storage: StorageProvider;
  private readonly renderer: VideoRenderer;
  private readonly postProcessor: MediaPostProcessor;
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    options: { storage?: StorageProvider; renderer?: VideoRenderer; postProcessor?: MediaPostProcessor } = {}
  ) {
    const config = loadConfig();
    this.timeoutMs = config.RENDER_TIMEOUT_MS;
    this.storage = options.storage ?? (config.STORAGE_PROVIDER === "s3"
      ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY })
      : new FakeStorageProvider());
    this.renderer = options.renderer ?? new RemotionVideoRenderer();
    this.postProcessor = options.postProcessor ?? new FfmpegPostProcessor();
  }

  async process(payload: Record<string, unknown>, jobId: string): Promise<Record<string, unknown>> {
    const input = RenderJobPayloadSchema.parse(payload).render;
    const sceneVersion = await this.prisma.sceneVersion.findFirstOrThrow({ where: { id: input.sceneVersionId, contentItemId: input.contentItemId } });
    const previous = sceneVersion.renderManifest;
    if (previous && typeof previous === "object" && !Array.isArray(previous) && (previous as Record<string, unknown>).idempotencyKey === input.idempotencyKey) {
      return previous;
    }
    let sceneDocument = SceneDocumentSchema.parse(sceneVersion.sceneDocument);
    let brandLogo: string | undefined;
    if (sceneDocument.style?.logoAssetId) {
      const logo = await this.prisma.asset.findFirst({ where: { id: sceneDocument.style.logoAssetId, channelId: input.channelId, kind: "GRAPHIC" } });
      if (!logo || assetNeedsReview(await new AssetRepository(this.prisma, this.storage).getLicense(logo.id))) throw new Error("BRAND_LOGO_LICENSE_REQUIRED");
      brandLogo = `data:${logo.mimeType};base64,${Buffer.from(await this.storage.download(logo.storageKey)).toString("base64")}`;
      await new AssetRepository(this.prisma, this.storage).attachUsage({ assetId: logo.id, contentItemId: input.contentItemId, sceneVersionId: sceneVersion.id, purpose: "brand-logo", snapshot: { license: "verified" } });
    }
    const platformKey = sceneVersion.platform ?? "COMMON";
    const audioAssets = new AssetRepository(this.prisma, this.storage);
    for (const [purpose, assetId] of [["bgm", sceneDocument.audio?.bgmAssetId], ["sfx", sceneDocument.audio?.sfxAssetId]] as const) {
      if (!assetId) continue;
      const asset = await this.prisma.asset.findFirst({ where: { id: assetId, channelId: input.channelId, kind: "AUDIO", origin: "STOCK_FREE" } });
      if (!asset || assetNeedsReview(await audioAssets.getLicense(assetId))) throw new Error("AUDIO_ASSET_LICENSE_REQUIRED");
      await audioAssets.attachUsage({ assetId, contentItemId: input.contentItemId, sceneVersionId: sceneVersion.id, purpose, snapshot: { license: "verified" } });
    }
    const usages = await this.prisma.assetUsage.findMany({
      where: { contentItemId: input.contentItemId, sceneVersionId: sceneVersion.id },
      include: { asset: true },
      orderBy: { createdAt: "asc" }
    });
    const narration = usages.find((usage) => readAssetUsagePurpose(usage) === `tts-narration:${platformKey}`) ?? usages.find((usage) => readAssetUsagePurpose(usage) === "tts-narration");
    const background = usages.find((usage) => readAssetUsagePurpose(usage) === "bgm");
    const effects = usages.find((usage) => readAssetUsagePurpose(usage) === "sfx");
    const captions = narration ? readCaptions(narration.usageSnapshot) : [];
    let expectedDuration = sceneDocument.durationInFrames / sceneDocument.fps;
    const directory = await mkdtemp(join(tmpdir(), `postbot-render-${jobId}-`));
    try {
      const draftPath = join(directory, "draft.mp4");
      const outputPath = join(directory, "output.mp4");
      const thumbnailPath = join(directory, "thumbnail.jpg");
      const narrationPath = narration ? join(directory, "narration.audio") : undefined;
      const backgroundPath = background ? join(directory, "background.audio") : undefined;
      const effectsPath = effects ? join(directory, "effects.audio") : undefined;
      if (narration && narrationPath) await writeFile(narrationPath, await this.storage.download(narration.asset.storageKey));
      if (narration && narrationPath) {
        const audio = await this.postProcessor.probe(narrationPath);
        const profile = sceneVersion.platform ? await this.prisma.platformOutputProfile.findFirst({ where: { channelId: input.channelId, platform: sceneVersion.platform, isActive: true }, orderBy: { version: "desc" } }) : null;
        sceneDocument = retimeNarration(sceneDocument, captions, audio.durationSeconds, { min: profile?.minDurationSeconds ?? 0, max: profile?.maxDurationSeconds ?? 180 });
        expectedDuration = sceneDocument.durationInFrames / sceneDocument.fps;
      }
      if (captions.some((caption) => caption.text.length > 160)) throw new Error("SUBTITLE_SAFE_AREA_OR_TIMING_INVALID");
      if (background && backgroundPath) await writeFile(backgroundPath, await this.storage.download(background.asset.storageKey));
      if (effects && effectsPath) await writeFile(effectsPath, await this.storage.download(effects.asset.storageKey));
      const sceneAssets: Record<string, string> = {};
      for (const usage of usages) {
        const sceneId = sceneIdFromImagePurpose(readAssetUsagePurpose(usage), platformKey);
        if (!sceneId) continue;
        const bytes = await this.storage.download(usage.asset.storageKey);
        sceneAssets[sceneId] = `data:${usage.asset.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
      }
      await this.withTimeout(this.renderer.render({ sceneDocument, captions, sceneAssets, brandLogo, outputLocation: draftPath }));
      await this.withTimeout(this.postProcessor.postprocess({ videoInput: draftPath, output: outputPath, narrationInput: narrationPath, backgroundInput: backgroundPath, effectsInput: effectsPath, backgroundVolume: sceneDocument.audio?.bgmVolume ?? 0.2, effectsVolume: sceneDocument.audio?.sfxVolume ?? 0.2 }));
      await this.withTimeout(this.postProcessor.thumbnail(outputPath, thumbnailPath));
      const qa = await this.withTimeout(this.postProcessor.probe(outputPath));
      if (qa.width !== 1080 || qa.height !== 1920 || qa.durationSeconds <= 0 || Math.abs(qa.durationSeconds - expectedDuration) > 1 || (narration && qa.hasAudio === false) || (narration && qa.meanVolumeDb !== undefined && (qa.meanVolumeDb === null || qa.meanVolumeDb < -60)) || (qa.blackFrameRatio ?? 0) > 0.98) throw new Error("RENDER_QA_FAILED");
      const videoKey = `renders/${input.contentItemId}/${jobId}.mp4`;
      const thumbnailKey = `renders/${input.contentItemId}/${jobId}.jpg`;
      await this.storage.upload({ key: videoKey, body: await readFile(outputPath), mimeType: "video/mp4" });
      await this.storage.upload({ key: thumbnailKey, body: await readFile(thumbnailPath), mimeType: "image/jpeg" });
      const manifest = {
        idempotencyKey: input.idempotencyKey,
        rendererVersion: "1.1.0",
        schemaVersion: sceneDocument.schemaVersion,
        videoKey,
        thumbnailKey,
        captions: captions.length,
        sceneAssets: Object.keys(sceneAssets),
        style: sceneDocument.style ?? null,
        qa
      };
      const config = loadConfig();
      const rate = config.RENDER_COST_MODE === "free" ? 0 : config.APP_ENV === "local" || config.APP_ENV === "test" ? 0.01 : config.RENDER_USD_PER_MINUTE;
      await audioAssets.recordProviderCost({ contentItemId: input.contentItemId, productionJobId: jobId, provider: "renderer", model: "remotion-ffmpeg", operation: "video-render", quantity: qa.durationSeconds / 60, unit: "minute", category: "render", estimatedCostUsd: (qa.durationSeconds / 60 * rate).toFixed(6), idempotencyKey: `render:${input.idempotencyKey}` });
      await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.sceneVersion.update({ where: { id: sceneVersion.id }, data: { renderManifest: manifest, sceneDocument, durationSeconds: expectedDuration } });
      if (sceneVersion.scriptVersionId) await tx.scriptVersion.update({ where: { id: sceneVersion.scriptVersionId }, data: { durationSeconds: expectedDuration } });
      });
      return manifest;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async withTimeout<Result>(operation: Promise<Result>): Promise<Result> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("RENDER_TIMEOUT")), this.timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
