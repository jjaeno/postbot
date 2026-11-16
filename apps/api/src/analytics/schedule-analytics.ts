import type { PrismaClient } from "@postbot/database";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";
import type { JobsService } from "../jobs/jobs.service.js";

// Rebuilt from durable published posts on every scheduler pass, including manual
// publications. An analytics failure never changes a publish plan or uploads again.
export async function scheduleAnalytics(prisma: PrismaClient, jobs: JobsService, now = new Date()): Promise<void> {
  const config = loadConfig();
  const hours = [...new Set(config.ANALYTICS_COLLECTION_HOURS.split(",").map(Number))];
  const posts = await prisma.platformPost.findMany({ where: { publishedAt: { lte: now } }, include: { publishPlan: { include: { contentItem: { include: { channel: true } } } } } });
  for (const post of posts) {
    try {
      assertPlatformEnabled(config, post.platform);
      const content = post.publishPlan.contentItem;
      for (const hour of hours) {
        const end = new Date(post.publishedAt.getTime() + hour * 3_600_000);
        if (end > now) continue;
        const sync = await prisma.analyticsSync.upsert({ where: { idempotencyKey: `post:${post.id}:${hour}h` }, update: {}, create: { channelId: content.channelId, platform: post.platform, status: "RUNNING", idempotencyKey: `post:${post.id}:${hour}h`, periodStart: post.publishedAt, periodEnd: end, timezone: "UTC" } });
        if (sync.status === "SUCCEEDED") continue;
        const job = await jobs.create(content.channel.workspaceId, { type: "ANALYTICS", channelId: content.channelId, contentItemId: content.id, idempotencyKey: `analytics:${sync.id}`, payload: { analytics: { syncId: sync.id, platformPostId: post.id } } });
        if (job.status === "FAILED" && job.attempts.length < 3) await jobs.recover(content.channel.workspaceId, job.id, {});
      }
    } catch {
      // Keep later posts/channels independent; next pass retries a failed handoff.
    }
  }
}
