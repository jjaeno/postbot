import type { PrismaClient } from "@postbot/database";
import { loadConfig } from "@postbot/config";
import { FakeStorageProvider, S3StorageProvider, type StorageProvider } from "@postbot/providers";
import { AmbiguousPublishError, FakeInstagramPublisherProvider, FakeTikTokPublisherProvider, FakeYouTubePublisherProvider, GoogleYouTubePublisherProvider, MetaInstagramPublisherProvider, TikTokPublisherProvider, type VideoPublisher } from "@postbot/publishers";
import { resolveOAuthAccessToken } from "./oauth-token.js";
export class PublishProcessor {
  private readonly storage: StorageProvider;
  constructor(private readonly prisma: PrismaClient, storage?: StorageProvider) {
    const config = loadConfig();
    this.storage = storage ?? (config.STORAGE_PROVIDER === "s3" ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }) : new FakeStorageProvider());
  }
  async process(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const publish = payload.publish;
    if (!publish || typeof publish !== "object" || Array.isArray(publish) || typeof (publish as Record<string, unknown>).publishPlanId !== "string") throw new Error("INVALID_PUBLISH_PAYLOAD");
    const plan = await this.prisma.publishPlan.findUniqueOrThrow({ where: { id: (publish as Record<string, string>).publishPlanId }, include: { sceneVersion: true, platformAccount: { include: { credential: true } }, platformPost: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 }, contentItem: { include: { policyChecks: { orderBy: { checkedAt: "desc" }, take: 1 }, sourceReferences: true, assetUsages: { include: { asset: { include: { licenses: { orderBy: { checkedAt: "desc" }, take: 1 } } } } } } } } });
    if (plan.platformPost) return { externalVideoId: plan.platformPost.externalPostId, url: plan.platformPost.postUrl, duplicate: true };
    const rightsVerified = plan.contentItem.assetUsages.length > 0 && plan.contentItem.assetUsages.every((usage) => usage.asset.licenses[0]?.status === "VERIFIED" && usage.asset.licenses[0]?.commercialUseAllowed === true);
    if (plan.status !== "SCHEDULED" || !plan.sceneVersion?.renderManifest || plan.platformAccount.status !== "CONNECTED" || plan.contentItem.policyChecks[0]?.status !== "PASS" || plan.contentItem.sourceReferences.length === 0 || !rightsVerified) throw new Error("PUBLISH_GATE_FAILED");
    const attemptNumber = (plan.attempts[0]?.attemptNumber ?? 0) + 1;
    const attempt = await this.prisma.publishAttempt.create({ data: { publishPlanId: plan.id, attemptNumber, status: "RUNNING", idempotencyKey: `${plan.idempotencyKey}:attempt:${attemptNumber}`, startedAt: new Date() } });
    await this.prisma.publishPlan.update({ where: { id: plan.id }, data: { status: "PUBLISHING" } });
    try {
      const config = loadConfig();
      const publisher: VideoPublisher = plan.platform === "INSTAGRAM"
        ? config.INSTAGRAM_OAUTH_PROVIDER === "meta"
          ? new MetaInstagramPublisherProvider({ clientId: config.INSTAGRAM_CLIENT_ID, clientSecret: config.INSTAGRAM_CLIENT_SECRET, graphVersion: config.INSTAGRAM_GRAPH_VERSION, timeoutMs: config.SOCIAL_PUBLISH_TIMEOUT_MS, pollIntervalMs: config.SOCIAL_PUBLISH_POLL_INTERVAL_MS })
          : new FakeInstagramPublisherProvider()
        : plan.platform === "TIKTOK"
          ? config.TIKTOK_OAUTH_PROVIDER === "tiktok"
            ? new TikTokPublisherProvider({ clientId: config.TIKTOK_CLIENT_KEY, clientSecret: config.TIKTOK_CLIENT_SECRET, timeoutMs: config.SOCIAL_PUBLISH_TIMEOUT_MS, pollIntervalMs: config.SOCIAL_PUBLISH_POLL_INTERVAL_MS })
            : new FakeTikTokPublisherProvider()
          : config.YOUTUBE_OAUTH_PROVIDER === "google" ? new GoogleYouTubePublisherProvider(config.YOUTUBE_CLIENT_ID, config.YOUTUBE_CLIENT_SECRET) : new FakeYouTubePublisherProvider();
      const accessToken = await resolveOAuthAccessToken(this.prisma, plan.platformAccount);
      const manifest = plan.sceneVersion.renderManifest as { videoKey?: unknown }; if (typeof manifest.videoKey !== "string") throw new Error("RENDER_FILE_NOT_FOUND");
      const video = await this.storage.download(manifest.videoKey); const upload = { title: plan.title, description: plan.description ?? "", privacyStatus: config.YOUTUBE_UPLOAD_PRIVACY, publishAt: plan.scheduledAt.toISOString(), video, idempotencyKey: plan.idempotencyKey, externalAccountId: plan.platformAccount.externalAccountId, aiGenerated: true };
      const uploaded = await publisher.upload(upload, accessToken);
      await this.prisma.$transaction([this.prisma.platformPost.create({ data: { publishPlanId: plan.id, platformAccountId: plan.platformAccountId, platform: plan.platform, externalPostId: uploaded.externalVideoId, postUrl: uploaded.url, publishedAt: new Date(), policyVersion: 1 } }), this.prisma.publishAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), responseSnapshot: uploaded } }), this.prisma.publishPlan.update({ where: { id: plan.id }, data: { status: "PUBLISHED" } }), this.prisma.contentItem.update({ where: { id: plan.contentItemId }, data: { status: "PUBLISHED" } })]);
      return { externalVideoId: uploaded.externalVideoId, url: uploaded.url };
    } catch (error) {
      const message = error instanceof Error ? error.message : "PUBLISH_FAILED";
      const ambiguous = error instanceof AmbiguousPublishError;
      await this.prisma.$transaction([this.prisma.publishAttempt.update({ where: { id: attempt.id }, data: { status: ambiguous ? "RETRY_WAIT" : "FAILED", finishedAt: new Date(), errorCode: ambiguous ? "AMBIGUOUS_PUBLISH" : "PUBLISH_FAILED", errorMessage: message, responseSnapshot: ambiguous ? { externalOperationId: error.externalOperationId } : undefined } }), this.prisma.publishPlan.update({ where: { id: plan.id }, data: { status: ambiguous ? "HELD" : "FAILED" } })]);
      throw error;
    }
  }
}
