import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AnalyticsReportResponseSchema, AnalyticsSyncRequestSchema, type AnalyticsReportResponse } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { JobsService } from "../jobs/jobs.service.js";

@Injectable()
export class AnalyticsService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly jobs: JobsService) {}

  async sync(workspaceId: string, raw: unknown) {
    const input = AnalyticsSyncRequestSchema.parse(raw);
    const channel = await this.prisma.channel.findFirst({ where: { id: input.channelId, workspaceId }, select: { id: true } });
    if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND");
    const existing = await this.prisma.analyticsSync.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing && (existing.channelId !== channel.id || existing.platform !== input.platform)) throw new ConflictException("ANALYTICS_IDEMPOTENCY_CONFLICT");
    const sync = existing ?? await this.prisma.analyticsSync.upsert({ where: { idempotencyKey: input.idempotencyKey }, update: {}, create: { channelId: channel.id, platform: input.platform, status: "RUNNING", idempotencyKey: input.idempotencyKey, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), timezone: input.timezone } });
    if (sync.channelId !== channel.id || sync.platform !== input.platform) throw new ConflictException("ANALYTICS_IDEMPOTENCY_CONFLICT");
    if (sync.status !== "RUNNING") return { id: sync.id, status: sync.status };
    // Retry an interrupted sync-to-queue handoff with the same production job key.
    return this.jobs.create(workspaceId, { type: "ANALYTICS", channelId: channel.id, idempotencyKey: `analytics:${sync.id}`, payload: { analytics: { syncId: sync.id } } });
  }

  async report(workspaceId: string, channelId: string, periodStart: string, periodEnd: string, platform?: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"): Promise<AnalyticsReportResponse> {
    const snapshots = await this.prisma.analyticsMetricSnapshot.findMany({ where: { observedAt: { gte: new Date(periodStart), lte: new Date(periodEnd) }, platformPost: { publishPlan: { contentItem: { channelId, channel: { workspaceId } } }, ...(platform ? { platform } : {}) } }, orderBy: { observedAt: "desc" } });
    const sync = await this.prisma.analyticsSync.findFirst({ where: { channelId, channel: { workspaceId }, status: "SUCCEEDED", ...(platform ? { platform } : {}) }, orderBy: { syncedAt: "desc" } });
    return AnalyticsReportResponseSchema.parse({ channelId, platform, periodStart, periodEnd, metrics: snapshots.map((snapshot) => ({ metric: snapshot.metric, status: snapshot.status, value: snapshot.value ? Number(snapshot.value) : null, unit: snapshot.unit, aggregation: snapshot.aggregation, unavailableReason: snapshot.unavailableReason, observedAt: snapshot.observedAt.toISOString(), revision: snapshot.revision, mappingVersion: snapshot.mappingVersion })), partial: snapshots.some((snapshot) => snapshot.status !== "AVAILABLE"), lastSyncedAt: sync?.syncedAt?.toISOString() ?? null });
  }
}
