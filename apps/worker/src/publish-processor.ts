import type { PrismaClient } from "@postbot/database";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";
import { FakeStorageProvider, S3StorageProvider, type StorageProvider } from "@postbot/providers";
import { AmbiguousPublishError, FakeInstagramPublisherProvider, FakeTikTokPublisherProvider, FakeYouTubePublisherProvider, GoogleYouTubePublisherProvider, MetaInstagramPublisherProvider, TikTokPublisherProvider, type VideoPublisher } from "@postbot/publishers";
import { resolveOAuthAccessToken } from "./oauth-token.js";
import { publishPrivacy } from "./publish-privacy.js";
export class PublishProcessor {
  private readonly storage: StorageProvider;
  constructor(private readonly prisma: PrismaClient, storage?: StorageProvider) {
    const config = loadConfig();
    this.storage = storage ?? (config.STORAGE_PROVIDER === "s3" ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }) : new FakeStorageProvider());
  }
  async process(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const publish = payload.publish;
    if (!publish || typeof publish !== "object" || Array.isArray(publish) || typeof (publish as Record<string, unknown>).publishPlanId !== "string") throw new Error("INVALID_PUBLISH_PAYLOAD");
    const plan = await this.prisma.publishPlan.findUniqueOrThrow({ where: { id: (publish as Record<string, string>).publishPlanId }, include: { sceneVersion: true, platformAccount: { include: { credential: true } }, platformPost: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 }, contentItem: { include: { scriptVersions: { orderBy: { version: "desc" } }, sceneVersions: { orderBy: { version: "desc" } }, policyChecks: { orderBy: { checkedAt: "desc" } }, sourceReferences: true, assetUsages: { include: { asset: { include: { sources: true, licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } } } } } } });
    if (plan.platformPost) return { externalVideoId: plan.platformPost.externalPostId, url: plan.platformPost.postUrl, duplicate: true };
    assertPlatformEnabled(loadConfig(), plan.platform);
    const branchUsages = plan.contentItem.assetUsages.filter((usage) => usage.sceneVersionId === plan.sceneVersionId || usage.sceneVersionId === null);
    const rightsVerified = branchUsages.length > 0 && branchUsages.every((usage) => (usage.asset.channelId === null || usage.asset.channelId === plan.contentItem.channelId) && usage.asset.licenses[0]?.status === "VERIFIED" && usage.asset.licenses[0]?.commercialUseAllowed === true && usage.asset.licenses[0]?.derivativeAllowed === true && (!usage.asset.licenses[0]?.validFrom || usage.asset.licenses[0].validFrom <= new Date()) && (!usage.asset.licenses[0]?.validUntil || usage.asset.licenses[0].validUntil > new Date()));
    const policyCheck = plan.contentItem.policyChecks.find((check) => check.platform === plan.platform);
    const script = plan.contentItem.scriptVersions.find((version) => version.platform === plan.platform);
    const latestScene = plan.contentItem.sceneVersions.find((version) => version.platform === plan.platform);
    const quality = script?.qualitySnapshot && typeof script.qualitySnapshot === "object" && !Array.isArray(script.qualitySnapshot) ? script.qualitySnapshot : {};
    const environment = loadConfig();
    if ((environment.APP_ENV === "production" || environment.APP_ENV === "staging") && !environment.STAGING_FAKE_CANARY && (quality.provider !== "openai" || branchUsages.some((usage) => usage.asset.sources.some((source) => source.provider.startsWith("fake") || source.provider === "fixture")))) throw new Error("NON_PRODUCTION_ARTIFACT_PUBLISH_BLOCKED");
    if (!script || quality.reviewStatus !== "APPROVED" || latestScene?.id !== plan.sceneVersionId || !policyCheck || policyCheck.checkedAt < script.createdAt || policyCheck.checkedAt < latestScene.createdAt) throw new Error("PUBLISH_VERSION_GATE_FAILED");
    if (plan.status !== "SCHEDULED" || !plan.sceneVersion?.renderManifest || plan.platformAccount.status !== "CONNECTED" || policyCheck?.status !== "PASS" || plan.contentItem.sourceReferences.length === 0 || !rightsVerified) throw new Error("PUBLISH_GATE_FAILED");
    const attemptNumber = (plan.attempts[0]?.attemptNumber ?? 0) + 1;
    const claimed = await this.prisma.publishPlan.updateMany({ where: { id: plan.id, status: "SCHEDULED" }, data: { status: "PUBLISHING" } });
    if (claimed.count !== 1) throw new Error("PUBLISH_PLAN_ALREADY_CLAIMED_OR_CANCELLED");
    const attempt = await this.prisma.publishAttempt.create({ data: { publishPlanId: plan.id, attemptNumber, status: "RUNNING", idempotencyKey: `${plan.idempotencyKey}:attempt:${attemptNumber}`, startedAt: new Date() } });
    let confirmedExternalId: string | null = null;
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
          : config.YOUTUBE_OAUTH_PROVIDER === "google" ? new GoogleYouTubePublisherProvider(config.YOUTUBE_CLIENT_ID, config.YOUTUBE_CLIENT_SECRET, { timeoutMs: config.SOCIAL_PUBLISH_TIMEOUT_MS }) : new FakeYouTubePublisherProvider();
      const accessToken = await resolveOAuthAccessToken(this.prisma, plan.platformAccount);
      const manifest = plan.sceneVersion.renderManifest as { videoKey?: unknown }; if (typeof manifest.videoKey !== "string") throw new Error("RENDER_FILE_NOT_FOUND");
      const tags = Array.isArray(plan.hashtags) ? plan.hashtags.filter((tag): tag is string => typeof tag === "string").map((tag) => `#${tag.replace(/^#+/, "").trim().replace(/\s+/g, "")}`).filter((tag) => tag.length > 1) : [];
      const description = [plan.description ?? "", ...tags.filter((tag) => !(plan.description ?? "").includes(tag))].filter(Boolean).join("\n");
      const planMetadata = plan.metadata && typeof plan.metadata === "object" && !Array.isArray(plan.metadata) ? plan.metadata : {};
      const video = await this.storage.download(manifest.videoKey); const upload = { title: plan.title, description, privacyStatus: publishPrivacy(planMetadata.publicSetting, config.YOUTUBE_UPLOAD_PRIVACY), publishAt: null, video, idempotencyKey: plan.idempotencyKey, externalAccountId: plan.platformAccount.externalAccountId, aiGenerated: true };
      const uploaded = await publisher.upload(upload, accessToken);
      confirmedExternalId = uploaded.externalVideoId;
      await this.prisma.$transaction([this.prisma.platformPost.create({ data: { publishPlanId: plan.id, platformAccountId: plan.platformAccountId, platform: plan.platform, externalPostId: uploaded.externalVideoId, postUrl: uploaded.url, publishedAt: new Date(), policyVersion: 1 } }), this.prisma.publishAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), responseSnapshot: uploaded } }), this.prisma.publishPlan.update({ where: { id: plan.id }, data: { status: "PUBLISHED" } }), this.prisma.contentItem.update({ where: { id: plan.contentItemId }, data: { status: "PUBLISHED" } })]);
      return { externalVideoId: uploaded.externalVideoId, url: uploaded.url };
    } catch (error) {
      const publicationError = confirmedExternalId !== null ? new AmbiguousPublishError("PUBLISH_PERSISTENCE_RECONCILIATION_REQUIRED", confirmedExternalId) : error;
      const message = publicationError instanceof Error ? publicationError.message : "PUBLISH_FAILED";
      const ambiguous = publicationError instanceof AmbiguousPublishError;
      await this.prisma.$transaction([this.prisma.publishAttempt.update({ where: { id: attempt.id }, data: { status: ambiguous ? "RETRY_WAIT" : "FAILED", finishedAt: new Date(), errorCode: ambiguous ? "AMBIGUOUS_PUBLISH" : "PUBLISH_FAILED", errorMessage: message, responseSnapshot: ambiguous ? { externalOperationId: publicationError.externalOperationId } : undefined } }), this.prisma.publishPlan.update({ where: { id: plan.id }, data: { status: ambiguous ? "HELD" : "FAILED" } })]);
      throw publicationError;
    }
  }
}
