import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CreatePublishPlanRequestSchema, type CreatePublishPlanRequest, type PublishCalendarItem, type PublishPlanResponse } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { JobsService } from "../jobs/jobs.service.js";
import type { Prisma } from "@postbot/database";
import { createScheduledPlan } from "./publish-slots.js";
const jsonObject = (value: Prisma.JsonValue | null): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export const nextAvailableSlot = (slots: readonly Date[], occupied: readonly Date[], after: Date): Date | null => {
  const occupiedTimes = new Set(occupied.map((value) => value.getTime()));
  return slots.filter((slot) => slot > after).sort((left, right) => left.getTime() - right.getTime()).find((slot) => !occupiedTimes.has(slot.getTime())) ?? null;
};
@Injectable()
export class PublishingService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly jobs: JobsService) {}
  async schedule(workspaceId: string, raw: unknown): Promise<PublishPlanResponse> {
    const input = this.parse(raw); const scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt <= new Date()) throw new BadRequestException({ code: "SCHEDULE_IN_PAST", message: "Schedule time must be in the future." });
    const existing = await this.prisma.publishPlan.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const owned = await this.prisma.contentItem.findFirst({ where: { id: existing.contentItemId, channel: { workspaceId } }, select: { id: true } });
      if (!owned) throw new NotFoundException({ code: "PUBLISH_PLAN_NOT_FOUND", message: "Publishing plan was not found." });
      if (existing.contentItemId !== input.contentItemId || existing.platformAccountId !== input.platformAccountId) throw new ConflictException({ code: "PUBLISH_IDEMPOTENCY_CONFLICT", message: "This request key already belongs to a different publishing plan." });
      return { id: existing.id, contentItemId: existing.contentItemId, platformAccountId: existing.platformAccountId, platform: existing.platform, status: existing.status, scheduledAt: existing.scheduledAt.toISOString(), idempotencyKey: existing.idempotencyKey, title: existing.title, duplicate: true };
    }
    const account = await this.prisma.platformAccount.findFirst({ where: { id: input.platformAccountId, workspaceId, status: "CONNECTED" } });
    if (!account) throw new NotFoundException({ code: "PUBLISH_ACCOUNT_NOT_FOUND", message: "Connected publishing account was not found." });
    if (!account.channelId) throw new ConflictException({ code: "PUBLISH_ACCOUNT_NOT_ASSIGNED", message: "The publishing account is not assigned to a channel." });
    const occupied = await this.prisma.publishPlan.findFirst({ where: { platformAccountId: account.id, scheduledAt, status: { in: ["SCHEDULED", "PUBLISHING"] } }, select: { id: true } });
    if (occupied) throw new ConflictException({ code: "PUBLISH_SLOT_OCCUPIED", message: "The publishing account already has a post at this time." });
    const content = await this.prisma.contentItem.findFirst({ where: { id: input.contentItemId, channel: { workspaceId }, channelId: account.channelId }, include: {
      sceneVersions: { where: { platform: account.platform }, orderBy: { version: "desc" }, take: 1 },
      scriptVersions: { where: { platform: account.platform }, orderBy: { version: "desc" }, take: 1 },
      policyChecks: { where: { platform: account.platform }, orderBy: { checkedAt: "desc" }, take: 1, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } }
    } });
    if (!content) throw new NotFoundException({ code: "APPROVED_CONTENT_NOT_FOUND", message: "Approved content was not found." });
    const scene = content.sceneVersions[0]; const script = content.scriptVersions[0]; const check = content.policyChecks[0];
    if (check?.status !== "PASS" || !scene?.renderManifest || !script || check.checkedAt < script.createdAt || check.checkedAt < scene.createdAt) throw new ConflictException({ code: "PUBLISH_GATE", message: "A current passing policy check and platform-specific rendered file are required." });
    const snapshot = jsonObject(script.qualitySnapshot); const metadata = jsonObject(snapshot.metadata ?? null);
    if (snapshot.reviewStatus !== "APPROVED") throw new ConflictException({ code: "PLATFORM_APPROVAL_REQUIRED", message: "Approve the selected platform's current output before scheduling." });
    const title = typeof snapshot.reviewTitle === "string" ? snapshot.reviewTitle : content.title;
    const description = typeof metadata.description === "string" ? metadata.description : content.summary;
    const hashtags = Array.isArray(metadata.hashtags) ? metadata.hashtags.filter((tag): tag is string => typeof tag === "string") : [];
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: content.channelId }, include: { scheduleRules: { where: { isActive: true } } } });
    const timezone = channel.scheduleRules.find((rule) => rule.platform === account.platform)?.timezone ?? channel.scheduleRules[0]?.timezone ?? "Asia/Seoul";
    const plan = await createScheduledPlan(this.prisma, content.channelId, timezone, channel.dailyPublishLimit, { contentItemId: content.id, platform: account.platform, platformAccountId: account.id, sceneVersionId: scene.id, policySnapshotId: check.snapshots[0]?.id, status: "SCHEDULED", scheduledAt, idempotencyKey: input.idempotencyKey, title, description, hashtags });
    await this.jobs.create(workspaceId, { type: "PUBLISH", channelId: content.channelId, contentItemId: content.id, idempotencyKey: `publish:${plan.id}`, runAfter: scheduledAt.toISOString(), payload: { publish: { publishPlanId: plan.id } } });
    await this.prisma.contentItem.update({ where: { id: content.id }, data: { status: "SCHEDULED" } });
    return { id: plan.id, contentItemId: plan.contentItemId, platformAccountId: plan.platformAccountId, platform: plan.platform, status: plan.status, scheduledAt: plan.scheduledAt.toISOString(), idempotencyKey: plan.idempotencyKey, title: plan.title };
  }
  async list(workspaceId: string): Promise<PublishCalendarItem[]> {
    const plans = await this.prisma.publishPlan.findMany({ where: { contentItem: { channel: { workspaceId } } }, include: { contentItem: { select: { channelId: true } }, platformPost: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }, orderBy: { scheduledAt: "asc" }, take: 200 });
    return plans.map((plan) => ({ id: plan.id, contentItemId: plan.contentItemId, channelId: plan.contentItem.channelId, platform: plan.platform, status: plan.status, scheduledAt: plan.scheduledAt.toISOString(), title: plan.title, postUrl: plan.platformPost?.postUrl ?? null, publishedAt: plan.platformPost?.publishedAt.toISOString() ?? null, failureReason: plan.attempts[0]?.errorMessage ?? plan.attempts[0]?.errorCode ?? null }));
  }
  async cancel(workspaceId: string, planId: string): Promise<{ ok: true }> {
    const plan = await this.prisma.publishPlan.findFirst({ where: { id: planId, contentItem: { channel: { workspaceId } } } });
    if (!plan) throw new NotFoundException("PUBLISH_PLAN_NOT_FOUND");
    if (plan.status === "CANCELLED") return { ok: true };
    const updated = await this.prisma.publishPlan.updateMany({ where: { id: plan.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
    if (updated.count !== 1) throw new ConflictException({ code: "PUBLISH_ALREADY_STARTED", message: "게시가 이미 시작되었거나 종료되어 예약을 변경할 수 없습니다." });
    const jobs = await this.prisma.productionJob.findMany({ where: { contentItemId: plan.contentItemId, type: "PUBLISH", status: "QUEUED" }, select: { id: true, payload: true } });
    for (const job of jobs) if (jsonObject(jsonObject(job.payload).publish ?? null).publishPlanId === plan.id) await this.jobs.cancel(workspaceId, job.id);
    const remaining = await this.prisma.publishPlan.count({ where: { contentItemId: plan.contentItemId, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] } } });
    if (remaining === 0) await this.prisma.contentItem.update({ where: { id: plan.contentItemId }, data: { status: "APPROVED" } });
    return { ok: true };
  }
  private parse(raw: unknown): CreatePublishPlanRequest { try { return CreatePublishPlanRequestSchema.parse(raw); } catch { throw new BadRequestException({ code: "INVALID_PUBLISH_PLAN", message: "Invalid publish plan." }); } }
}
