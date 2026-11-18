import { createHash } from "node:crypto";
import type { PrismaClient } from "@postbot/database";
import { observationCohortKey, publishedFeatures } from "@postbot/optimization";
import type { JobsService } from "../jobs/jobs.service.js";

export async function analysisReadiness(prisma: PrismaClient, channelId: string, now = new Date()) {
  const snapshots = await prisma.analyticsMetricSnapshot.findMany({ where: { status: "AVAILABLE", value: { not: null }, collectedAt: { gte: new Date(now.getTime() - 90 * 86400000) }, platformPost: { publicationState: "PUBLISHED", publishPlan: { contentItem: { channelId } } } }, include: { platformPost: true }, orderBy: [{ collectedAt: "desc" }, { id: "desc" }], take: 1000 });
  const groups = new Map<string, typeof snapshots>();
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const post = snapshot.platformPost; const features = publishedFeatures(post.productionSnapshot);
    if (!post.publishedAt || !features || features.sceneVersionId !== snapshot.sceneVersionId || features.scriptVersionId !== snapshot.scriptVersionId) continue;
    const cohort = observationCohortKey({ ...snapshot, platform: post.platform, publishedAt: post.publishedAt });
    if (!cohort || seen.has(`${post.id}:${cohort}`)) continue;
    seen.add(`${post.id}:${cohort}`); groups.set(cohort, [...(groups.get(cohort) ?? []), snapshot]);
  }
  const previous = await prisma.optimizationSuggestion.findMany({ where: { channelId }, orderBy: { createdAt: "desc" }, take: 100 });
  const consumed = new Set(previous.filter((item) => item.sampleSize >= 4).flatMap((item) => {
    const value = item.inputSnapshot;
    return value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.snapshotIds) ? value.snapshotIds.filter((id): id is string => typeof id === "string") : [];
  }));
  const eligible = [...groups.entries()].filter(([, items]) => items.length >= 4 && items.filter((item) => !consumed.has(item.id)).length >= 4).sort(([a], [b]) => a.localeCompare(b));
  return { eligible, status: eligible.length ? "READY" : "WAITING_FOR_FRESH_COMPARABLE_DATA", requiredDistinctPosts: 4, maximumComparablePosts: Math.max(0, ...[...groups.values()].map((items) => items.length)), nextCheckAt: new Date(now.getTime() + 3600000).toISOString(), sampleLimit: 1000, policy: "YOUTUBE_NATIVE_OBSERVATIONS_ONLY_NO_DERIVED_METRICS" };
}
export async function scheduleAnalysis(prisma: PrismaClient, jobs: JobsService, now: Date, cursor: string | null): Promise<string | null> {
  const channels = await prisma.channel.findMany({ where: { status: "ACTIVE", ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 50 });
  for (const channel of channels) {
    const readiness = await analysisReadiness(prisma, channel.id, now);
    for (const [cohort, items] of readiness.eligible) {
      const first = items[0]; if (!first) continue;
      const digest = createHash("sha256").update(`${cohort}:${items.map((item) => item.id).sort().join(":")}`).digest("hex");
      const periodStart = new Date(Math.min(...items.map((item) => item.collectedAt.getTime()))).toISOString();
      const periodEnd = new Date(Math.max(...items.map((item) => item.collectedAt.getTime())) + 1).toISOString();
      await jobs.create(channel.workspaceId, { type: "ANALYTICS", channelId: channel.id, idempotencyKey: `analysis:${channel.id}:${digest}`, payload: { analysis: { channelId: channel.id, platform: first.platformPost.platform, metric: first.metric, periodStart, periodEnd, comparisonPurpose: "RELATIVE_AGE", idempotencyKey: `analysis:${digest}` } } });
    }
  }
  return channels.length === 50 ? channels.at(-1)?.id ?? null : null;
}
