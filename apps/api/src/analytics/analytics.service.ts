import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AnalyticsReportResponseSchema, AnalyticsSyncRequestSchema, type AnalyticsReportResponse } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { JobsService } from "../jobs/jobs.service.js";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";

@Injectable()
export class AnalyticsService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly jobs: JobsService) {}

  async sync(workspaceId: string, raw: unknown) {
    const input = AnalyticsSyncRequestSchema.parse(raw);
    try { assertPlatformEnabled(loadConfig(), input.platform); } catch { throw new ConflictException("PLATFORM_DISABLED_OR_PUBLISHING_HELD"); }
    const channel = await this.prisma.channel.findFirst({ where: { id: input.channelId, workspaceId }, select: { id: true } });
    if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND");
    const existing = await this.prisma.analyticsSync.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing && (existing.channelId !== channel.id || existing.platform !== input.platform)) throw new ConflictException("ANALYTICS_IDEMPOTENCY_CONFLICT");
    const sync = existing ?? await this.prisma.analyticsSync.upsert({ where: { idempotencyKey: input.idempotencyKey }, update: {}, create: { channelId: channel.id, platform: input.platform, status: "RUNNING", idempotencyKey: input.idempotencyKey, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), timezone: input.timezone } });
    if (sync.channelId !== channel.id || sync.platform !== input.platform) throw new ConflictException("ANALYTICS_IDEMPOTENCY_CONFLICT");
    if (input.recheck) {
      const recheckKey = `analytics:${sync.id}:recheck`;
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM analytics_syncs WHERE id = ${sync.id} FOR UPDATE`;
        if (await tx.productionJob.findUnique({ where: { idempotencyKey: recheckKey } })) return;
        const current = await tx.analyticsSync.findUniqueOrThrow({ where: { id: sync.id } });
        if (current.status === "COLLECTING") throw new ConflictException("ANALYTICS_COLLECTION_IN_PROGRESS");
        await tx.analyticsSync.update({ where: { id: sync.id }, data: { status: "RUNNING", nextAttemptAt: null, collectionAttempts: 0 } });
        const priorMetrics = await tx.analyticsMetricSnapshot.findMany({ where: { analyticsSyncId: sync.id } });
        for (const metric of priorMetrics) {
          const rawSnapshot = metric.rawSnapshot && typeof metric.rawSnapshot === "object" && !Array.isArray(metric.rawSnapshot) ? metric.rawSnapshot : {};
          await tx.analyticsMetricSnapshot.update({ where: { id: metric.id }, data: { rawSnapshot: { ...rawSnapshot, collectionPending: true } } });
        }
        await tx.productionJob.create({ data: { type: "ANALYTICS", queueName: "analytics", channelId: channel.id, idempotencyKey: recheckKey, payload: { analytics: { syncId: sync.id } } } });
      });
      return this.jobs.create(workspaceId, { type: "ANALYTICS", channelId: channel.id, idempotencyKey: recheckKey, payload: { analytics: { syncId: sync.id } } });
    }
    if (sync.status !== "RUNNING") return { id: sync.id, status: sync.status };
    // Retry an interrupted sync-to-queue handoff with the same production job key.
    return this.jobs.create(workspaceId, { type: "ANALYTICS", channelId: channel.id, idempotencyKey: `analytics:${sync.id}`, payload: { analytics: { syncId: sync.id } } });
  }

  async report(workspaceId: string, channelId: string, periodStart: string, periodEnd: string, platform?: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"): Promise<AnalyticsReportResponse> {
    const snapshots = await this.prisma.analyticsMetricSnapshot.findMany({ where: { observedAt: { gte: new Date(periodStart), lte: new Date(periodEnd) }, platformPost: { publishPlan: { contentItem: { channelId, channel: { workspaceId } } }, ...(platform ? { platform } : {}) } }, include: { analyticsSync: true, platformPost: { include: { publishPlan: true } } }, orderBy: [{ observedAt: "desc" }, { revision: "desc" }] });
    const sync = await this.prisma.analyticsSync.findFirst({ where: { channelId, channel: { workspaceId }, ...(platform ? { platform } : {}) }, orderBy: { syncedAt: "desc" } });
    const lastSuccess = await this.prisma.analyticsSync.findFirst({ where: { channelId, channel: { workspaceId }, status: "SUCCEEDED", ...(platform ? { platform } : {}) }, orderBy: { syncedAt: "desc" } });
    const latest = new Set<string>();
    return AnalyticsReportResponseSchema.parse({ collectionStatus: sync?.status ?? null, nextCollectionAt: sync?.nextAttemptAt?.toISOString() ?? null, channelId, platform, periodStart, periodEnd, metrics: snapshots.map((snapshot) => { const key = `${snapshot.platformPostId}:${snapshot.metric}:${snapshot.observationKind}:${snapshot.periodStart?.toISOString()}:${snapshot.periodEnd?.toISOString()}`; const isLatest = !latest.has(key); latest.add(key); return { id: snapshot.id, contentItemId: snapshot.platformPost.publishPlan.contentItemId, platformPostId: snapshot.platformPostId, externalPostId: snapshot.platformPost.externalPostId, title: snapshot.platformPost.publishPlan.title, platform: snapshot.platformPost.platform, periodStart: snapshot.periodStart?.toISOString() ?? null, periodEnd: snapshot.periodEnd?.toISOString() ?? null, observationKind: snapshot.observationKind, collectedAt: snapshot.collectedAt.toISOString(), sceneVersionId: snapshot.sceneVersionId, scriptVersionId: snapshot.scriptVersionId, latest: isLatest, metric: snapshot.metric, status: snapshot.status, value: snapshot.value ? Number(snapshot.value) : null, unit: snapshot.unit, aggregation: snapshot.aggregation, unavailableReason: snapshot.unavailableReason, observedAt: snapshot.observedAt.toISOString(), revision: snapshot.revision, mappingVersion: snapshot.mappingVersion }; }), partial: snapshots.some((snapshot) => snapshot.status !== "AVAILABLE"), lastSyncedAt: lastSuccess?.syncedAt?.toISOString() ?? null, lastError: sync?.errorCode ?? null });
  }
}
