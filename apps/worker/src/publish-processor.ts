import { OAuthReauthenticationRequired, assertExecutionOwner, jobExecution, type Prisma, type PrismaClient } from "@postbot/database";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";
import { FakeStorageProvider, S3StorageProvider, type StorageProvider } from "@postbot/providers";
import { AmbiguousPublishError, FakeInstagramPublisherProvider, FakeTikTokPublisherProvider, FakeYouTubePublisherProvider, GoogleYouTubePublisherProvider, MetaInstagramPublisherProvider, TikTokPublisherProvider, OAuthRefreshError, encryptOAuthToken, type PublishedVideo, type VideoPublisher } from "@postbot/publishers";
import { resolveOAuthAccessToken } from "./oauth-token.js";
import { publishPrivacy } from "./publish-privacy.js";
import { publicationState } from "./publication-state.js";
import { ChannelCollectionProfileSchema, localPublishDay, nextZonedSchedule } from "@postbot/contracts";
export class PublishProcessor {
  private readonly storage: StorageProvider;
  constructor(private readonly prisma: PrismaClient, storage?: StorageProvider, private readonly publisherOverride?: VideoPublisher) {
    const config = loadConfig();
    this.storage = storage ?? (config.STORAGE_PROVIDER === "s3" ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }) : new FakeStorageProvider());
  }
  async process(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const publish = payload.publish;
    if (!publish || typeof publish !== "object" || Array.isArray(publish) || typeof (publish as Record<string, unknown>).publishPlanId !== "string") throw new Error("INVALID_PUBLISH_PAYLOAD");
    const plan = await this.prisma.publishPlan.findUniqueOrThrow({ where: { id: (publish as Record<string, string>).publishPlanId }, include: { sceneVersion: true, platformAccount: { include: { credential: true } }, platformPost: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 }, contentItem: { include: { scriptVersions: { orderBy: { version: "desc" } }, sceneVersions: { orderBy: { version: "desc" } }, policyChecks: { orderBy: { checkedAt: "desc" } }, sourceReferences: true, assetUsages: { include: { asset: { include: { sources: true, licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } } } } } } });
    const recoveredId = typeof (publish as Record<string, unknown>).externalVideoId === "string" ? String((publish as Record<string, unknown>).externalVideoId) : undefined;
    if (plan.platformPost || recoveredId) return this.reconcileExisting(plan.id, recoveredId);
    if (plan.status === "CANCELLED") return { cancelled: true };
    assertPlatformEnabled(loadConfig(), plan.platform);
    if (plan.scheduledAt > new Date()) return { pending: true, rescheduled: true, nextCheckAt: plan.scheduledAt.toISOString() };
    const branchUsages = plan.contentItem.assetUsages.filter((usage) => usage.sceneVersionId === plan.sceneVersionId || usage.sceneVersionId === null);
    const rightsVerified = branchUsages.length > 0 && branchUsages.every((usage) => (usage.asset.channelId === null || usage.asset.channelId === plan.contentItem.channelId) && usage.asset.licenses[0]?.status === "VERIFIED" && usage.asset.licenses[0]?.commercialUseAllowed === true && usage.asset.licenses[0]?.derivativeAllowed === true && (!usage.asset.licenses[0]?.validFrom || usage.asset.licenses[0].validFrom <= new Date()) && (!usage.asset.licenses[0]?.validUntil || usage.asset.licenses[0].validUntil > new Date()));
    const policyCheck = plan.contentItem.policyChecks.find((check) => check.platform === plan.platform);
    if (policyCheck) {
      const checkedRule = await this.prisma.policyRule.findUniqueOrThrow({ where: { id: policyCheck.policyRuleId } });
      const currentRule = await this.prisma.policyRule.findFirst({ where: { platform: plan.platform, region: checkedRule.region, effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }] });
      if (currentRule?.id !== checkedRule.id) throw new Error("PUBLISH_POLICY_VERSION_CHANGED_RECHECK_REQUIRED");
    }
    const script = plan.contentItem.scriptVersions.find((version) => version.platform === plan.platform);
    const latestScene = plan.contentItem.sceneVersions.find((version) => version.platform === plan.platform);
    const quality = script?.qualitySnapshot && typeof script.qualitySnapshot === "object" && !Array.isArray(script.qualitySnapshot) ? script.qualitySnapshot : {};
    const environment = loadConfig();
    if ((environment.APP_ENV === "production" || environment.APP_ENV === "staging") && !environment.STAGING_FAKE_CANARY && (quality.provider !== "openai" || branchUsages.some((usage) => usage.asset.sources.some((source) => source.provider.startsWith("fake") || source.provider === "fixture")))) throw new Error("NON_PRODUCTION_ARTIFACT_PUBLISH_BLOCKED");
    const metadata = quality.metadata && typeof quality.metadata === "object" && !Array.isArray(quality.metadata) ? quality.metadata : {};
    const currentTitle = typeof quality.reviewTitle === "string" ? quality.reviewTitle : plan.contentItem.title;
    const currentDescription = typeof metadata.description === "string" ? metadata.description : plan.contentItem.summary;
    if (plan.title !== currentTitle || plan.description !== currentDescription || JSON.stringify(plan.hashtags ?? []) !== JSON.stringify(metadata.hashtags ?? [])) throw new Error("PUBLISH_METADATA_GATE_FAILED");
    if (!script || quality.reviewStatus !== "APPROVED" || latestScene?.id !== plan.sceneVersionId || !policyCheck || policyCheck.checkedAt < script.createdAt || policyCheck.checkedAt < latestScene.createdAt) throw new Error("PUBLISH_VERSION_GATE_FAILED");
    if (plan.status !== "SCHEDULED" || !plan.sceneVersion?.renderManifest || plan.platformAccount.status !== "CONNECTED" || plan.platformAccount.channelId !== plan.contentItem.channelId || policyCheck?.status !== "PASS" || plan.contentItem.sourceReferences.length === 0 || !rightsVerified) throw new Error("PUBLISH_GATE_FAILED");
    const publishedScene = plan.sceneVersion;
    const missed = await this.missedSlot(plan.id, plan.contentItem.channelId);
    if (missed) return missed;
    const attemptNumber = (plan.attempts[0]?.attemptNumber ?? 0) + 1;
    const claimed = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${plan.contentItem.channelId} FOR UPDATE`;
      const currentScript = await tx.scriptVersion.findFirst({ where: { contentItemId: plan.contentItemId, platform: plan.platform }, orderBy: { version: "desc" } });
      const currentScene = await tx.sceneVersion.findFirst({ where: { contentItemId: plan.contentItemId, platform: plan.platform }, orderBy: { version: "desc" } });
      const currentCheck = await tx.policyCheck.findFirst({ where: { contentItemId: plan.contentItemId, platform: plan.platform }, orderBy: { checkedAt: "desc" } });
      if (currentScript?.id !== script.id || currentScene?.id !== latestScene.id || currentCheck?.id !== policyCheck.id || JSON.stringify(currentScript.qualitySnapshot) !== JSON.stringify(script.qualitySnapshot)) throw new Error("PUBLISH_VERSION_GATE_FAILED");
      const claimed = await tx.publishPlan.updateMany({ where: { id: plan.id, status: "SCHEDULED", updatedAt: plan.updatedAt }, data: { status: "PUBLISHING" } });
      if (claimed.count !== 1) throw new Error("PUBLISH_PLAN_ALREADY_CLAIMED_OR_CANCELLED");
      return tx.publishAttempt.create({ data: { publishPlanId: plan.id, attemptNumber, status: "RUNNING", idempotencyKey: `${plan.idempotencyKey}:attempt:${attemptNumber}`, startedAt: new Date() } });
    });
    const attempt = claimed;
    let confirmedExternalId: string | null = null;
    try {
      const config = loadConfig();
      const publisher = this.publisher(plan.platform, attempt.id);
      const accessToken = await resolveOAuthAccessToken(this.prisma, plan.platformAccount);
      const manifest = publishedScene.renderManifest as { videoKey?: unknown }; if (typeof manifest.videoKey !== "string") throw new Error("RENDER_FILE_NOT_FOUND");
      const tags = Array.isArray(plan.hashtags) ? plan.hashtags.filter((tag): tag is string => typeof tag === "string").map((tag) => `#${tag.replace(/^#+/, "").trim().replace(/\s+/g, "")}`).filter((tag) => tag.length > 1) : [];
      const description = [plan.description ?? "", ...tags.filter((tag) => !(plan.description ?? "").includes(tag))].filter(Boolean).join("\n");
      const planMetadata = plan.metadata && typeof plan.metadata === "object" && !Array.isArray(plan.metadata) ? plan.metadata : {};
      const video = await this.storage.download(manifest.videoKey); const upload = { title: plan.title, description, privacyStatus: publishPrivacy(planMetadata.publicSetting, plan.platform === "YOUTUBE" ? config.YOUTUBE_UPLOAD_PRIVACY : "public"), publishAt: null, video, idempotencyKey: plan.idempotencyKey, externalAccountId: plan.platformAccount.externalAccountId, aiGenerated: true };
      const uploaded = await publisher.upload(upload, accessToken);
      confirmedExternalId = uploaded.externalVideoId;
      const snapshot: Prisma.InputJsonObject = { ...(publishedScene.renderManifest && typeof publishedScene.renderManifest === "object" && !Array.isArray(publishedScene.renderManifest) && publishedScene.renderManifest.productionFeatures && typeof publishedScene.renderManifest.productionFeatures === "object" && !Array.isArray(publishedScene.renderManifest.productionFeatures) ? publishedScene.renderManifest.productionFeatures : { version: "legacy-publication-unknown", sceneVersionId: plan.sceneVersionId, scriptVersionId: publishedScene.scriptVersionId }), platform: plan.platform };
      return await this.recordPublication(plan.id, uploaded, snapshot, attempt.id);
    } catch (error) {
      if (error instanceof OAuthRefreshError && error.reauthenticationRequired) {
        await this.prisma.platformAccount.updateMany({ where: { id: plan.platformAccountId, status: "CONNECTED" }, data: { status: "EXPIRED" } });
      }
      const publicationError = confirmedExternalId !== null ? new AmbiguousPublishError("PUBLISH_PERSISTENCE_RECONCILIATION_REQUIRED", confirmedExternalId) : error;
      const message = publicationError instanceof Error ? publicationError.message : "PUBLISH_FAILED";
      const ambiguous = publicationError instanceof AmbiguousPublishError;
      await this.prisma.$transaction(async (tx) => {
        const owner = jobExecution.getStore();
        if (owner) await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${owner.jobId} FOR UPDATE`;
        const current = owner ? await tx.productionJob.findUnique({ where: { id: owner.jobId } }) : null;
        const ownsExecution = !owner || (current?.executionToken === owner.token && ["RUNNING", "CANCEL_REQUESTED"].includes(current.status));
        // Receipts belong to this attempt even if ownership was lost. Never
        // overwrite a later execution's plan/content state with a late result.
        await tx.publishAttempt.update({ where: { id: attempt.id }, data: { status: ambiguous ? "RETRY_WAIT" : "FAILED", finishedAt: new Date(), errorCode: ambiguous ? "AMBIGUOUS_PUBLISH" : "PUBLISH_FAILED", errorMessage: message, responseSnapshot: ambiguous ? { externalOperationId: publicationError.externalOperationId } : undefined } });
        if (ownsExecution) await tx.publishPlan.updateMany({ where: { id: plan.id, status: "PUBLISHING", platformPost: null }, data: { status: ambiguous ? "HELD" : "FAILED" } });
      });
      if (error instanceof OAuthRefreshError && error.reauthenticationRequired) throw new OAuthReauthenticationRequired();
      throw publicationError;
    }
  }

  private async missedSlot(planId: string, channelId: string): Promise<Record<string, unknown> | null> {
    return this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const plan = await tx.publishPlan.findUniqueOrThrow({ where: { id: planId } });
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: channelId }, include: { scheduleRules: { where: { isActive: true } }, collectionRules: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 } } });
      const rule = channel.collectionRules[0]; const profile = rule?.profile ? ChannelCollectionProfileSchema.parse(rule.profile) : null;
      if (Date.now() <= plan.scheduledAt.getTime() + (profile?.production.missedPublishGraceMinutes ?? 15) * 60000 || profile?.production.missedPublishPolicy === "IMMEDIATE") return null;
      if (profile?.production.missedPublishPolicy === "NEXT_SLOT") {
        const rules = channel.scheduleRules.filter((rule) => rule.platform === null || rule.platform === plan.platform); let after = new Date();
        for (let count = 0; count < 100; count++) {
          const previousAfter = after; const next = nextZonedSchedule(rules, after); if (!next) break; after = next;
          const timezone = rules.find((rule) => nextZonedSchedule([rule], previousAfter)?.getTime() === next.getTime())?.timezone ?? "UTC";
          const occupied = await tx.publishPlan.findMany({ where: { id: { not: plan.id }, platform: plan.platform, contentItem: { channelId }, status: { in: ["SCHEDULED", "PUBLISHING", "UPLOADED", "PROCESSING", "PUBLISHED"] }, scheduledAt: { gte: new Date(next.getTime() - 48 * 3600000), lte: new Date(next.getTime() + 48 * 3600000) } }, select: { platformAccountId: true, scheduledAt: true } });
          if (occupied.some((item) => item.platformAccountId === plan.platformAccountId && item.scheduledAt.getTime() === next.getTime()) || occupied.filter((item) => localPublishDay(item.scheduledAt, timezone) === localPublishDay(next, timezone)).length >= channel.dailyPublishLimit) continue;
          const changed = await tx.publishPlan.updateMany({ where: { id: plan.id, status: "SCHEDULED", platformPost: null }, data: { scheduledAt: next } });
          if (!changed.count) throw new Error("PUBLISH_PLAN_ALREADY_CLAIMED_OR_CANCELLED");
          await tx.auditLog.create({ data: { workspaceId: channel.workspaceId, action: "publication.rescheduled", targetType: "publishPlan", targetId: plan.id, metadata: { previous: plan.scheduledAt.toISOString(), next: next.toISOString(), reason: "MISSED_SLOT_NEXT_SLOT" } } });
          return { pending: true, rescheduled: true, nextCheckAt: next.toISOString() };
        }
      }
      await tx.publishPlan.updateMany({ where: { id: plan.id, status: "SCHEDULED", platformPost: null }, data: { status: "HELD" } });
      return { reviewRequired: true, reason: profile?.production.missedPublishPolicy === "NEXT_SLOT" ? "PUBLISH_NO_AVAILABLE_NEXT_SLOT" : "MISSED_PUBLISH_SLOT_REVIEW_REQUIRED" };
    });
  }

  private publisher(platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK", attemptId?: string): VideoPublisher {
    if (this.publisherOverride) return this.publisherOverride;
    const config = loadConfig();
    if (platform === "INSTAGRAM") return config.INSTAGRAM_OAUTH_PROVIDER === "meta" ? new MetaInstagramPublisherProvider({ clientId: config.INSTAGRAM_CLIENT_ID, clientSecret: config.INSTAGRAM_CLIENT_SECRET, graphVersion: config.INSTAGRAM_GRAPH_VERSION, timeoutMs: config.SOCIAL_PUBLISH_TIMEOUT_MS, pollIntervalMs: config.SOCIAL_PUBLISH_POLL_INTERVAL_MS }) : new FakeInstagramPublisherProvider();
    if (platform === "TIKTOK") return config.TIKTOK_OAUTH_PROVIDER === "tiktok" ? new TikTokPublisherProvider({ clientId: config.TIKTOK_CLIENT_KEY, clientSecret: config.TIKTOK_CLIENT_SECRET, timeoutMs: config.SOCIAL_PUBLISH_TIMEOUT_MS, pollIntervalMs: config.SOCIAL_PUBLISH_POLL_INTERVAL_MS }) : new FakeTikTokPublisherProvider();
    return config.YOUTUBE_OAUTH_PROVIDER === "google" ? new GoogleYouTubePublisherProvider(config.YOUTUBE_CLIENT_ID, config.YOUTUBE_CLIENT_SECRET, { timeoutMs: config.SOCIAL_PUBLISH_TIMEOUT_MS, ...(attemptId ? { onUploadSession: async (url: string) => {
      if (!config.OAUTH_ENCRYPTION_KEY) throw new Error("OAUTH_ENCRYPTION_KEY_REQUIRED");
      await this.prisma.publishAttempt.update({ where: { id: attemptId }, data: { protectedProviderEvidence: { version: "youtube-resumable-v1", encryptedSession: encryptOAuthToken(url, config.OAUTH_ENCRYPTION_KEY), keyVersion: config.OAUTH_ENCRYPTION_KEY_VERSION, recordedAt: new Date().toISOString() } } });
    } } : {}) }) : new FakeYouTubePublisherProvider();
  }

  private async reconcileExisting(planId: string, recoveredId?: string): Promise<Record<string, unknown>> {
    const plan = await this.prisma.publishPlan.findUniqueOrThrow({ where: { id: planId }, include: { platformPost: true, platformAccount: { include: { credential: true } }, sceneVersion: true } });
    const post = plan.platformPost;
    if (post && recoveredId && recoveredId !== post.externalPostId) throw new Error("PUBLICATION_EXTERNAL_ID_CONFLICT");
    const externalId = post?.externalPostId ?? recoveredId;
    if (!externalId) throw new Error("PUBLICATION_EXTERNAL_ID_REQUIRED");
    if (post?.publicationState === "PUBLISHED" && !recoveredId) return { externalVideoId: externalId, url: post.postUrl, duplicate: true, published: true };
    assertPlatformEnabled(loadConfig(), plan.platform);
    const publisher = this.publisher(plan.platform);
    if (!publisher.getPublicationStatus) return this.reviewConfirmation(planId, "PUBLICATION_STATUS_UNSUPPORTED");
    let accessToken: string;
    try { accessToken = await resolveOAuthAccessToken(this.prisma, plan.platformAccount); }
    catch (error) { if (error instanceof OAuthReauthenticationRequired) return this.reviewConfirmation(planId, "ACCOUNT_REAUTH_REQUIRED"); throw error; }
    const startedAt = new Date();
    let observed: PublishedVideo;
    try { observed = await publisher.getPublicationStatus(externalId, accessToken, plan.platformAccount.externalAccountId); }
    catch (error) {
      if (error instanceof OAuthRefreshError && error.reauthenticationRequired) {
        await this.prisma.platformAccount.updateMany({ where: { id: plan.platformAccountId, status: "CONNECTED" }, data: { status: "EXPIRED" } });
        return this.reviewConfirmation(planId, "ACCOUNT_REAUTH_REQUIRED");
      }
      if (error instanceof Error && error.message === "PUBLICATION_ACCOUNT_OR_ID_MISMATCH") return this.reviewConfirmation(planId, error.message);
      if (Date.now() > Math.max(post?.createdAt.getTime() ?? startedAt.getTime(), plan.scheduledAt.getTime()) + 86400000) return this.reviewConfirmation(planId, "PUBLICATION_STATUS_LOOKUP_STALLED");
      return { pending: true, externalVideoId: externalId, nextCheckAt: new Date(Date.now() + 300000).toISOString(), reason: "PUBLICATION_STATUS_LOOKUP_RETRY" };
    }
    if (observed.externalVideoId !== externalId) throw new Error("PUBLICATION_EXTERNAL_ID_CONFLICT");
    return this.recordPublication(planId, observed, { version: "reconciled-publication-unknown", sceneVersionId: plan.sceneVersionId, scriptVersionId: plan.sceneVersion?.scriptVersionId ?? null }, undefined, startedAt);
  }

  private async reviewConfirmation(planId: string, reason: string): Promise<Record<string, unknown>> {
    await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.publishPlan.update({ where: { id: planId }, data: { status: "HELD" } });
      await tx.platformPost.updateMany({ where: { publishPlanId: planId }, data: { publicationFailureCode: reason, nextPublicationCheckAt: null } });
    });
    return { reviewRequired: true, reason };
  }

  private async recordPublication(planId: string, result: PublishedVideo, snapshot: Prisma.InputJsonObject, attemptId?: string, startedAt = new Date()): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM publish_plans WHERE id = ${planId} FOR UPDATE`;
      const plan = await tx.publishPlan.findUniqueOrThrow({ where: { id: planId }, include: { platformPost: true, platformAccount: { select: { workspaceId: true } } } });
      const old = plan.platformPost;
      if (old && old.externalPostId !== result.externalVideoId) throw new Error("PUBLICATION_EXTERNAL_ID_CONFLICT");
      if (old?.publicationCheckedAt && old.publicationCheckedAt > startedAt) return { pending: old.publicationState !== "PUBLISHED", published: old.publicationState === "PUBLISHED", externalVideoId: old.externalPostId, url: old.postUrl, nextCheckAt: old.nextPublicationCheckAt?.toISOString() ?? null };
      const metadata = plan.metadata && typeof plan.metadata === "object" && !Array.isArray(plan.metadata) ? plan.metadata : {};
      const privateRequested = plan.platform === "YOUTUBE" && publishPrivacy(metadata.publicSetting, loadConfig().YOUTUBE_UPLOAD_PRIVACY) === "private";
      const state = publicationState(result, old?.createdAt ?? new Date(), old?.publicationCheckCount ?? 0, { privateRequested });
      const data = { publishedAt: state.publishedAt, publicationState: state.state, publicationCheckedAt: startedAt, nextPublicationCheckAt: state.nextCheck, publicationFailureCode: state.failureCode, visibility: result.visibility ?? null, postUrl: result.url };
      const post = old ? await tx.platformPost.update({ where: { id: old.id }, data: { ...data, publicationCheckCount: { increment: 1 } } })
        : await tx.platformPost.create({ data: { ...data, publishPlanId: plan.id, platformAccountId: plan.platformAccountId, platform: plan.platform, externalPostId: result.externalVideoId, policyVersion: 1, productionSnapshot: snapshot } });
      if (attemptId) await tx.publishAttempt.update({ where: { id: attemptId }, data: { status: "SUCCEEDED", finishedAt: new Date(), responseSnapshot: result } });
      await tx.publishPlan.update({ where: { id: planId }, data: { status: state.planStatus } });
      const anyPublished = await tx.platformPost.count({ where: { publicationState: "PUBLISHED", publishPlan: { contentItemId: plan.contentItemId } } });
      await tx.contentItem.update({ where: { id: plan.contentItemId }, data: { status: anyPublished > 0 ? "PUBLISHED" : state.contentStatus } });
      if (old?.publicationState !== state.state) await tx.auditLog.create({ data: { workspaceId: plan.platformAccount.workspaceId, action: "publication.status_confirmed", targetType: "platformPost", targetId: post.id,
        metadata: { previousState: old?.publicationState ?? null, state: state.state, publishedAt: state.publishedAt?.toISOString() ?? null, checkedAt: startedAt.toISOString(), ...(old?.publicationState === "LEGACY_UNCONFIRMED" ? { legacyRecordedPublishedAt: old.publishedAt?.toISOString() ?? null } : {}) } } });
      if (state.state === "PUBLISHED") {
        const jobs = await tx.productionJob.findMany({ where: { type: "PUBLISH", status: "NEEDS_REVIEW", errorCode: { in: ["AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED", "RECONCILIATION_REQUIRED"] }, payload: { path: "$.publish.publishPlanId", equals: planId } }, select: { id: true } });
        await tx.productionJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) } }, data: { status: "SUCCEEDED", errorCode: null, errorMessage: null, result: { externalVideoId: result.externalVideoId, reconciled: true }, finishedAt: new Date() } });
        const steps = await tx.automationStep.findMany({ where: { productionJobId: { in: jobs.map((job) => job.id) }, status: "HELD" }, select: { id: true, automationRunId: true } });
        await tx.automationStep.updateMany({ where: { id: { in: steps.map((step) => step.id) } }, data: { status: "SUCCEEDED", errorCode: null, errorMessage: null, finishedAt: new Date() } });
        await tx.automationRun.updateMany({ where: { id: { in: steps.map((step) => step.automationRunId) }, status: "PAUSED", pausedReason: "AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED" }, data: { status: "RUNNING", pausedReason: null, nextRunAt: new Date() } });
      }
      return { externalVideoId: result.externalVideoId, url: result.url, published: state.state === "PUBLISHED", pending: state.nextCheck !== null, reviewRequired: state.reviewRequired, reason: state.failureCode, nextCheckAt: state.nextCheck?.toISOString() ?? null, platformPostId: post.id };
    });
  }
}
