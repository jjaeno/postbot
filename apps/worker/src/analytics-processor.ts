import { assertExecutionOwner, type Prisma, type PrismaClient } from "@postbot/database";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";
import { FakeAnalyticsProvider, InstagramAnalyticsProvider, TikTokAnalyticsProvider, YouTubeAnalyticsProvider, type AnalyticsProvider } from "@postbot/providers";
import { resolveOAuthAccessToken } from "./oauth-token.js";

const syncIdFromPayload = (payload: Record<string, unknown>): string | null => {
  const analytics = payload.analytics;
  return analytics && typeof analytics === "object" && !Array.isArray(analytics) && typeof (analytics as Record<string, unknown>).syncId === "string" ? (analytics as Record<string, unknown>).syncId as string : null;
};

export class AnalyticsProcessor {
  constructor(private readonly prisma: PrismaClient, private readonly providerOverride?: AnalyticsProvider) {}
  async process(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const syncId = syncIdFromPayload(payload);
    if (!syncId) return { skipped: true };
    const sync = await this.prisma.analyticsSync.findUnique({ where: { id: syncId } });
    if (!sync) throw new Error("ANALYTICS_SYNC_NOT_FOUND");
    if (["SUCCEEDED", "EXPIRED", "UNAVAILABLE"].includes(sync.status)) return { syncId, duplicate: true };
    if (sync.nextAttemptAt && sync.nextAttemptAt > new Date()) return { syncId, deferred: true };
    if (sync.collectionAttempts >= 6) {
      await this.prisma.analyticsSync.update({ where: { id: syncId }, data: { status: "EXPIRED", nextAttemptAt: null } });
      return { syncId, expired: true };
    }
    const claim = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      return tx.analyticsSync.updateMany({ where: { id: syncId, collectionAttempts: sync.collectionAttempts, status: { not: "COLLECTING" } }, data: { status: "COLLECTING", collectionAttempts: { increment: 1 } } });
    });
    if (claim.count !== 1) return { syncId, duplicate: true };
    const attempt = sync.collectionAttempts + 1;
    const retryAt = (delayHours = 1): Date => new Date(Date.now() + Math.max(delayHours, Math.min(24, 2 ** (attempt - 1))) * 3_600_000);
    try {
      const provider = this.providerOverride ?? await this.provider(sync.channelId, sync.platform);
      const domain = payload.analytics && typeof payload.analytics === "object" ? payload.analytics as Record<string, unknown> : {};
      const posts = await this.prisma.platformPost.findMany({ where: { publicationState: "PUBLISHED", publishedAt: { not: null }, ...(typeof domain.platformPostId === "string" ? { id: domain.platformPostId } : {}), platform: sync.platform, publishPlan: { contentItem: { channelId: sync.channelId } } }, include: { publishPlan: { include: { sceneVersion: true } }, analyticsSnapshots: { where: { analyticsSyncId: sync.id }, orderBy: { revision: "desc" } } } });
      const transient = (reason: string | null): boolean => reason !== null && /NOT_RETURNED|UNAVAILABLE|PENDING|DELAY/.test(reason) && !/NOT_PROVIDED|NOT_SUPPORTED|SEPARATE|NOT_EQUIVALENT|ZERO_DENOMINATOR/.test(reason);
      const currentMetrics = (post: typeof posts[number]) => [...new Map([...post.analyticsSnapshots].reverse().map((metric) => [metric.metric, metric])).values()];
      const pending = posts.filter((post) => !post.analyticsSnapshots.length || currentMetrics(post).some((metric) => transient(metric.unavailableReason) || (metric.rawSnapshot && typeof metric.rawSnapshot === "object" && !Array.isArray(metric.rawSnapshot) && metric.rawSnapshot.collectionPending === true)));
      let count = 0; let failures = 0; let waiting = false; let available = posts.some((post) => post.analyticsSnapshots.some((metric) => metric.status === "AVAILABLE"));
      let delayHours = 1;
      const batchSize = sync.platform === "YOUTUBE" ? 500 : sync.platform === "TIKTOK" ? 20 : 1;
      for (let offset = 0; offset < pending.length; offset += batchSize) {
        const batch = pending.slice(offset, offset + batchSize);
        let token: string | null = null;
        const received = new Set<string>(); const pages = new Set<string>();
        try {
          do {
            if (pages.has(token ?? "first")) throw new Error("ANALYTICS_PAGINATION_LOOP");
            pages.add(token ?? "first");
            const page = await provider.fetchPage({ platform: sync.platform, postIds: batch.map((post) => post.externalPostId), periodStart: sync.periodStart.toISOString(), periodEnd: sync.periodEnd.toISOString(), pageToken: token });
            delayHours = Math.max(delayHours, page.dataDelayHours ?? 0);
            await this.prisma.$transaction(async (tx) => {
              await assertExecutionOwner(tx);
              await tx.$queryRaw`SELECT id FROM analytics_syncs WHERE id = ${sync.id} FOR UPDATE`;
              const existing = await tx.analyticsMetricSnapshot.findMany({ where: { analyticsSyncId: sync.id, platformPostId: { in: batch.map((post) => post.id) } }, orderBy: { revision: "desc" } });
              const latest = new Map<string, number>();
              for (const metric of existing) if (!latest.has(`${metric.platformPostId}:${metric.metric}`)) latest.set(`${metric.platformPostId}:${metric.metric}`, metric.revision);
              const data: Prisma.AnalyticsMetricSnapshotCreateManyInput[] = [];
              for (const post of page.posts) {
                const target = batch.find((item) => item.externalPostId === post.externalPostId);
                if (!target?.publishedAt) continue;
                received.add(post.externalPostId);
                const collectedAt = new Date(); const observation = post.observation;
                const end = observation?.periodEnd ? new Date(observation.periodEnd) : null;
                const delayed = observation?.kind === "PERIOD_TOTAL" && end !== null && collectedAt.getTime() < end.getTime() + (page.dataDelayHours ?? 0) * 3_600_000;
                waiting ||= delayed || post.metrics.length === 0 || post.metrics.some((metric) => transient(metric.unavailableReason));
                available ||= post.metrics.some((metric) => metric.value !== null);
                for (const metric of post.metrics) {
                  const revisionKey = `${target.id}:${metric.metric}`;
                  const revision = (latest.get(revisionKey) ?? 0) + 1; latest.set(revisionKey, revision);
                  data.push({ analyticsSyncId: sync.id, platformPostId: target.id, metric: metric.metric, mappingVersion: "v3", status: metric.value === null ? "UNAVAILABLE" : "AVAILABLE", value: metric.value, unit: metric.unit, aggregation: metric.aggregation, unavailableReason: metric.unavailableReason, rawSnapshot: { ...post.raw, collectionPending: delayed, actualAgeSeconds: Math.max(0, (collectedAt.getTime() - target.publishedAt.getTime()) / 1000) }, observedAt: new Date(post.observedAt), collectedAt, observationKind: observation?.kind ?? "LEGACY_UNKNOWN", periodStart: observation?.periodStart ? new Date(observation.periodStart) : null, periodEnd: end, sceneVersionId: target.publishPlan.sceneVersionId, scriptVersionId: target.publishPlan.sceneVersion?.scriptVersionId, revision });
                }
                count++;
              }
              if (data.length) await tx.analyticsMetricSnapshot.createMany({ data });
            });
            token = page.nextPageToken;
          } while (token);
          waiting ||= received.size !== batch.length;
        } catch { failures++; }
      }
      const unresolved = failures > 0 || waiting;
      const status = unresolved ? attempt >= 6 ? "EXPIRED" : available ? "PARTIAL" : "WAITING" : available ? "SUCCEEDED" : "UNAVAILABLE";
      await this.prisma.$transaction(async (tx) => {
        await assertExecutionOwner(tx);
        await tx.analyticsSync.update({ where: { id: sync.id }, data: { status, dataDelayHours: delayHours, nextAttemptAt: unresolved && attempt < 6 ? retryAt(delayHours) : null, errorCode: failures ? "ANALYTICS_PARTIAL_RETRY_REQUIRED" : null, errorMessage: null, syncedAt: new Date() } });
      });
      if (failures) throw new Error(count ? "ANALYTICS_PARTIAL_RETRY_REQUIRED" : "ANALYTICS_FETCH_FAILED");
      return { syncId, posts: count, collectionStatus: status };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await assertExecutionOwner(tx);
        await tx.analyticsSync.update({ where: { id: syncId }, data: { status: attempt >= 6 ? "EXPIRED" : "PARTIAL", nextAttemptAt: attempt >= 6 ? null : retryAt(), errorCode: "ANALYTICS_SYNC_FAILED", errorMessage: "Retry analytics only; publication is unchanged.", syncedAt: new Date() } });
      });
      throw error;
    }
  }

  private async provider(channelId: string, platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"): Promise<AnalyticsProvider> {
    const config = loadConfig();
    assertPlatformEnabled(config, platform);
    const useFake = platform === "YOUTUBE" ? config.YOUTUBE_ANALYTICS_PROVIDER === "fake" : platform === "INSTAGRAM" ? config.INSTAGRAM_ANALYTICS_PROVIDER === "fake" : config.TIKTOK_ANALYTICS_PROVIDER === "fake";
    if (useFake) return new FakeAnalyticsProvider();
    const account = await this.prisma.platformAccount.findFirst({ where: { channelId, platform, status: "CONNECTED" }, include: { credential: true } });
    if (!account) throw new Error("ANALYTICS_PLATFORM_ACCOUNT_NOT_CONNECTED");
    const accessToken = await resolveOAuthAccessToken(this.prisma, account);
    const options = { accessToken, timeoutMs: config.PROVIDER_HTTP_TIMEOUT_MS };
    if (platform === "INSTAGRAM") return new InstagramAnalyticsProvider({ ...options, graphVersion: config.INSTAGRAM_GRAPH_VERSION });
    if (platform === "TIKTOK") return new TikTokAnalyticsProvider(options);
    return new YouTubeAnalyticsProvider(options);
  }
}
