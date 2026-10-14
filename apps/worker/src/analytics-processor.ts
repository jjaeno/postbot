import type { Prisma, PrismaClient } from "@postbot/database";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";
import { FakeAnalyticsProvider, InstagramAnalyticsProvider, TikTokAnalyticsProvider, YouTubeAnalyticsProvider, type AnalyticsProvider } from "@postbot/providers";
import { resolveOAuthAccessToken } from "./oauth-token.js";

const syncIdFromPayload = (payload: Record<string, unknown>): string | null => {
  const analytics = payload.analytics;
  return analytics && typeof analytics === "object" && !Array.isArray(analytics) && typeof (analytics as Record<string, unknown>).syncId === "string" ? (analytics as Record<string, unknown>).syncId as string : null;
};

export class AnalyticsProcessor {
  constructor(private readonly prisma: PrismaClient) {}
  async process(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const syncId = syncIdFromPayload(payload);
    if (!syncId) return { skipped: true };
    const sync = await this.prisma.analyticsSync.findUnique({ where: { id: syncId } });
    if (!sync) throw new Error("ANALYTICS_SYNC_NOT_FOUND");
    const provider = await this.provider(sync.channelId, sync.platform);
    const posts = await this.prisma.platformPost.findMany({ where: { platform: sync.platform, publishPlan: { contentItem: { channelId: sync.channelId } } }, select: { id: true, externalPostId: true } });
    let token: string | null = null;
    let count = 0;
    do {
      const page = await provider.fetchPage({ platform: sync.platform, postIds: posts.map((post) => post.externalPostId), periodStart: sync.periodStart.toISOString(), periodEnd: sync.periodEnd.toISOString(), pageToken: token });
      for (const post of page.posts) {
        const target = posts.find((item) => item.externalPostId === post.externalPostId);
        if (!target) continue;
        await this.prisma.analyticsMetricSnapshot.createMany({ data: post.metrics.map((metric) => ({ analyticsSyncId: sync.id, platformPostId: target.id, metric: metric.metric, mappingVersion: "v1", status: metric.value === null ? "UNAVAILABLE" : "AVAILABLE", value: metric.value, unit: metric.unit, aggregation: metric.aggregation, unavailableReason: metric.unavailableReason, rawSnapshot: post.raw as Prisma.InputJsonObject, observedAt: new Date(post.observedAt), revision: 1 })), skipDuplicates: true });
        count += 1;
      }
      token = page.nextPageToken;
      await this.prisma.analyticsSync.update({ where: { id: sync.id }, data: { dataDelayHours: page.dataDelayHours } });
    } while (token);
    await this.prisma.analyticsSync.update({ where: { id: sync.id }, data: { status: "SUCCEEDED", syncedAt: new Date() } });
    return { syncId, posts: count };
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
