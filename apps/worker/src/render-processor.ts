import { loadConfig } from "@postbot/config";
import { readAssetUsagePurpose } from "@postbot/asset-library";
import { RenderJobPayloadSchema } from "@postbot/contracts";
import type { Prisma, PrismaClient } from "@postbot/database";
import { FakeStorageProvider, S3StorageProvider, type StorageProvider } from "@postbot/providers";
import { FfmpegPostProcessor, RemotionVideoRenderer, type FfprobeResult, type VideoRenderer } from "@postbot/renderer";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptionTiming } from "@postbot/renderer";
import { SceneDocumentSchema } from "@postbot/scene-schema";

export interface MediaPostProcessor {
  postprocess(input: { videoInput: string; output: string; narrationInput?: string; backgroundInput?: string }): Promise<void>;
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
    const sceneDocument = SceneDocumentSchema.parse(sceneVersion.sceneDocument);
    const platformKey = sceneVersion.platform ?? "COMMON";
    const usages = await this.prisma.assetUsage.findMany({
      where: { contentItemId: input.contentItemId, sceneVersionId: sceneVersion.id },
      include: { asset: true },
      orderBy: { createdAt: "asc" }
    });
    const narration = usages.find((usage) => readAssetUsagePurpose(usage) === `tts-narration:${platformKey}`) ?? usages.find((usage) => readAssetUsagePurpose(usage) === "tts-narration");
    const background = usages.find((usage) => ["bgm", "sfx"].includes(readAssetUsagePurpose(usage)));
    const captions = narration ? readCaptions(narration.usageSnapshot) : [];
    const expectedDuration = sceneDocument.durationInFrames / sceneDocument.fps;
    if (captions.some((caption) => caption.startSeconds < 0 || caption.endSeconds <= caption.startSeconds || caption.endSeconds > expectedDuration + 0.25 || caption.text.length > 160)) throw new Error("SUBTITLE_SAFE_AREA_OR_TIMING_INVALID");
    const directory = await mkdtemp(join(tmpdir(), `postbot-render-${jobId}-`));
    try {
      const draftPath = join(directory, "draft.mp4");
      const outputPath = join(directory, "output.mp4");
      const thumbnailPath = join(directory, "thumbnail.jpg");
      const narrationPath = narration ? join(directory, "narration.audio") : undefined;
      const backgroundPath = background ? join(directory, "background.audio") : undefined;
      if (narration && narrationPath) await writeFile(narrationPath, await this.storage.download(narration.asset.storageKey));
      if (background && backgroundPath) await writeFile(backgroundPath, await this.storage.download(background.asset.storageKey));
      const sceneAssets: Record<string, string> = {};
      for (const usage of usages) {
        const sceneId = sceneIdFromImagePurpose(readAssetUsagePurpose(usage), platformKey);
        if (!sceneId) continue;
        const bytes = await this.storage.download(usage.asset.storageKey);
        sceneAssets[sceneId] = `data:${usage.asset.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
      }
      await this.withTimeout(this.renderer.render({ sceneDocument, captions, sceneAssets, outputLocation: draftPath }));
      await this.withTimeout(this.postProcessor.postprocess({ videoInput: draftPath, output: outputPath, narrationInput: narrationPath, backgroundInput: backgroundPath }));
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
        qa
      };
      await this.prisma.sceneVersion.update({ where: { id: sceneVersion.id }, data: { renderManifest: manifest } });
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
