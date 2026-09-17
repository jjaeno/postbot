import { AssetPreparationService, AssetRepository } from "@postbot/asset-library";
import { loadConfig } from "@postbot/config";
import { AssetPreparationJobPayloadSchema, TtsPreparationJobPayloadSchema } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { FakeImageProvider, FakeStorageProvider, FakeTtsProvider, GoogleImageProvider, ElevenLabsTtsProvider, S3StorageProvider } from "@postbot/providers";

export class AssetPreparationProcessor {
  private readonly preparation: AssetPreparationService;
  private readonly config = loadConfig();

  constructor(prisma: PrismaClient) {
    const storage = this.config.STORAGE_PROVIDER === "s3"
      ? new S3StorageProvider({ endpoint: this.config.S3_ENDPOINT, region: this.config.S3_REGION, bucket: this.config.S3_BUCKET, accessKeyId: this.config.S3_ACCESS_KEY_ID, secretAccessKey: this.config.S3_SECRET_ACCESS_KEY })
      : new FakeStorageProvider();
    const image = this.config.IMAGE_PROVIDER === "google"
      ? new GoogleImageProvider({ apiKey: this.config.GOOGLE_API_KEY, timeoutMs: this.config.IMAGE_TIMEOUT_MS })
      : new FakeImageProvider();
    const tts = this.config.TTS_PROVIDER === "elevenlabs"
      ? new ElevenLabsTtsProvider({ apiKey: this.config.ELEVENLABS_API_KEY, timeoutMs: this.config.TTS_TIMEOUT_MS })
      : new FakeTtsProvider();
    this.preparation = new AssetPreparationService(new AssetRepository(prisma, storage), image, tts);
  }

  async processAsset(payload: Record<string, unknown>, jobId: string): Promise<Record<string, unknown>> {
    const input = AssetPreparationJobPayloadSchema.parse(payload).assetPreparation;
    const result = await this.preparation.prepareImage({ channelId: input.channelId, contentItemId: input.contentItemId, key: `images/${jobId}`, prompt: input.prompt, model: this.config.IMAGE_MODEL, idempotencyKey: input.idempotencyKey });
    return { ...result, contentItemId: input.contentItemId };
  }

  async processTts(payload: Record<string, unknown>, jobId: string): Promise<Record<string, unknown>> {
    const input = TtsPreparationJobPayloadSchema.parse(payload).ttsPreparation;
    const result = await this.preparation.prepareTts({ channelId: input.channelId, contentItemId: input.contentItemId, key: `audio/${jobId}`, text: input.text, voice: input.voice, model: this.config.TTS_MODEL, idempotencyKey: input.idempotencyKey });
    return result;
  }
}
