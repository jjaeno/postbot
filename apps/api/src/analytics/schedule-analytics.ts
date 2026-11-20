import { completePostPublicationDay } from "@postbot/providers";
import type { PrismaClient } from "@postbot/database";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";
import type { JobsService } from "../jobs/jobs.service.js";

// Rebuilt from durable published posts on every scheduler pass, including manual
// publications. An analytics failure never changes a publish plan or uploads again.
export async function scheduleAnalytics(prisma: PrismaClient, jobs: JobsService, now = new Date()): Promise<void> {
  const config = loadConfig();
  const hours = [...new Set(config.ANALYTICS_COLLECTION_HOURS.split(",").map(Number))];
  const due = await prisma.analyticsSync.findMany({ where: { status: { in: ["WAITING", "PARTIAL"] }, collectionAttempts: { lt: 6 }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, include: { channel: true } });
  for (const sync of due) {
    try {
      assertPlatformEnabled(config, sync.platform);
      const original = await prisma.productionJob.findFirst({ where: { type: "ANALYTICS", payload: { path: "$.analytics.syncId", equals: sync.id } }, orderBy: { createdAt: "asc" }, select: { payload: true, contentItemId: true } });
      const payload = original?.payload && typeof original.payload === "object" && !Array.isArray(original.payload) ? original.payload : {};
      const analytics = payload.analytics && typeof payload.analytics === "object" && !Array.isArray(payload.analytics) ? payload.analytics : {};
      await jobs.create(sync.channel.workspaceId, { type: "ANALYTICS", channelId: sync.channelId, contentItemId: original?.contentItemId ?? undefined, idempotencyKey: `analytics:${sync.id}:collection:${sync.collectionAttempts}`, payload: { analytics: { syncId: sync.id, ...(typeof analytics.platformPostId === "string" ? { platformPostId: analytics.platformPostId } : {}) } } });
    } catch { /* Durable sync remains due; publishing is never retried here. */ }
  }
  const posts = await prisma.platformPost.findMany({ where: { publicationState: "PUBLISHED", publishedAt: { lte: now } }, include: { publishPlan: { include: { contentItem: { include: { channel: true } } } } } });
  for (const post of posts) {
    if (!post.publishedAt) continue;
    try {
      assertPlatformEnabled(config, post.platform);
      const content = post.publishPlan.contentItem;
      for (const hour of hours) {
        const wholeDay = post.platform === "YOUTUBE" ? completePostPublicationDay(post.publishedAt, Math.max(1, Math.ceil(hour / 24))) : null;
        const start = wholeDay?.start ?? post.publishedAt;
        const end = wholeDay?.end ?? new Date(post.publishedAt.getTime() + hour * 3_600_000);
        if (end > now) continue;
        const sync = await prisma.analyticsSync.upsert({ where: { idempotencyKey: `post:${post.id}:${wholeDay ? "full-calendar-day-" + Math.max(1, Math.ceil(hour / 24)) : hour + "h"}` }, update: {}, create: { channelId: content.channelId, platform: post.platform, status: "RUNNING", idempotencyKey: `post:${post.id}:${wholeDay ? "full-calendar-day-" + Math.max(1, Math.ceil(hour / 24)) : hour + "h"}`, periodStart: start, periodEnd: end, timezone: wholeDay ? "America/Los_Angeles" : "UTC" } });
        if (["SUCCEEDED", "UNAVAILABLE", "EXPIRED", "COLLECTING"].includes(sync.status) || sync.collectionAttempts >= 6 || (sync.nextAttemptAt && sync.nextAttemptAt > now)) continue;
        const job = await jobs.create(content.channel.workspaceId, { type: "ANALYTICS", channelId: content.channelId, contentItemId: content.id, idempotencyKey: `analytics:${sync.id}:collection:${sync.collectionAttempts}`, payload: { analytics: { syncId: sync.id, platformPostId: post.id } } });
        if (job.status === "FAILED" && job.attempts.length < 3) await jobs.recover(content.channel.workspaceId, job.id, {});
      }
    } catch {
      // Keep later posts/channels independent; next pass retries a failed handoff.
    }
  }
}
