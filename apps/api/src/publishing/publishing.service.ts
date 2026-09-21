import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CreatePublishPlanRequestSchema, type CreatePublishPlanRequest, type PublishPlanResponse } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { JobsService } from "../jobs/jobs.service.js";
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
    if (existing) return { id: existing.id, contentItemId: existing.contentItemId, platformAccountId: existing.platformAccountId, platform: existing.platform, status: existing.status, scheduledAt: existing.scheduledAt.toISOString(), idempotencyKey: existing.idempotencyKey, title: existing.title, duplicate: true };
    const content = await this.prisma.contentItem.findFirst({ where: { id: input.contentItemId, channel: { workspaceId }, status: "APPROVED" }, include: { sceneVersions: { orderBy: { version: "desc" }, take: 1 }, policyChecks: { orderBy: { checkedAt: "desc" }, take: 1 } } });
    if (!content) throw new NotFoundException({ code: "APPROVED_CONTENT_NOT_FOUND", message: "Approved content was not found." });
    if (content.policyChecks[0]?.status !== "PASS" || !content.sceneVersions[0]?.renderManifest) throw new ConflictException({ code: "PUBLISH_GATE", message: "A passing policy check and rendered file are required." });
    const account = await this.prisma.platformAccount.findFirst({ where: { id: input.platformAccountId, workspaceId, channelId: content.channelId, status: "CONNECTED" } });
    if (!account) throw new NotFoundException({ code: "PUBLISH_ACCOUNT_NOT_FOUND", message: "Connected publishing account was not found." });
    const plan = await this.prisma.publishPlan.create({ data: { contentItemId: content.id, platform: account.platform, platformAccountId: account.id, sceneVersionId: content.sceneVersions[0].id, status: "SCHEDULED", scheduledAt, idempotencyKey: input.idempotencyKey, title: content.title } });
    await this.jobs.create(workspaceId, { type: "PUBLISH", channelId: content.channelId, contentItemId: content.id, idempotencyKey: `publish:${plan.id}`, runAfter: scheduledAt.toISOString(), payload: { publish: { publishPlanId: plan.id } } });
    await this.prisma.contentItem.update({ where: { id: content.id }, data: { status: "SCHEDULED" } });
    return { id: plan.id, contentItemId: plan.contentItemId, platformAccountId: plan.platformAccountId, platform: plan.platform, status: plan.status, scheduledAt: plan.scheduledAt.toISOString(), idempotencyKey: plan.idempotencyKey, title: plan.title };
  }
  private parse(raw: unknown): CreatePublishPlanRequest { try { return CreatePublishPlanRequestSchema.parse(raw); } catch { throw new BadRequestException({ code: "INVALID_PUBLISH_PLAN", message: "Invalid publish plan." }); } }
}
