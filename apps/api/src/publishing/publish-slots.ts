import { ConflictException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";

export const localPublishDay = (at: Date, timezone: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

// A channel lock serializes manual and automatic reservations across processes.
export const createScheduledPlan = (prisma: PrismaClient, channelId: string, timezone: string, dailyLimit: number, data: Prisma.PublishPlanUncheckedCreateInput, persist?: (tx: Prisma.TransactionClient, plan: { id: string }) => Promise<void>) => prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
  const existing = await tx.publishPlan.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
  if (existing) {
    if (existing.contentItemId !== data.contentItemId || existing.platformAccountId !== data.platformAccountId) throw new ConflictException({ code: "PUBLISH_IDEMPOTENCY_CONFLICT", message: "This request key already belongs to a different publishing plan." });
    await persist?.(tx, existing);
    return existing;
  }
  const scheduledAt = new Date(data.scheduledAt);
  const active = await tx.publishPlan.findFirst({ where: { contentItemId: data.contentItemId, platform: data.platform, status: { not: "CANCELLED" } }, select: { id: true } });
  if (active) throw new ConflictException({ code: "PUBLISH_PLAN_EXISTS", message: "이 플랫폼에는 기존 게시 계획이 있습니다. 기존 예약을 취소한 뒤 새 예약을 만들어 주세요. 게시가 시작되었거나 보류된 계획은 먼저 복구해야 합니다." });
  const plans = await tx.publishPlan.findMany({ where: { platform: data.platform, contentItem: { channelId }, scheduledAt: { gte: new Date(scheduledAt.getTime() - 48 * 3_600_000), lte: new Date(scheduledAt.getTime() + 48 * 3_600_000) }, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] } }, select: { scheduledAt: true, platformAccountId: true } });
  if (plans.some((plan) => plan.platformAccountId === data.platformAccountId && plan.scheduledAt.getTime() === scheduledAt.getTime())) throw new ConflictException({ code: "PUBLISH_SLOT_OCCUPIED", message: "이미 예약된 시간입니다. 다른 게시 시간을 선택해 주세요." });
  if (plans.filter((plan) => localPublishDay(plan.scheduledAt, timezone) === localPublishDay(scheduledAt, timezone)).length >= dailyLimit) throw new ConflictException({ code: "PUBLISH_DAILY_LIMIT", message: "이 플랫폼의 채널 일일 게시 한도에 도달했습니다. 다른 날짜를 선택해 주세요." });
  const plan = await tx.publishPlan.create({ data });
  await persist?.(tx, plan);
  return plan;
}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
