import { Prisma, type PrismaClient } from "@postbot/database";
import { evaluateBudget, type BudgetDecision } from "./automation-safety.js";

type Budget = {
  id: string;
  workspaceId: string;
  channelId: string | null;
  currency: string;
  dailySoftLimit: Prisma.Decimal | null;
  dailyHardLimit: Prisma.Decimal | null;
  monthlySoftLimit: Prisma.Decimal | null;
  monthlyHardLimit: Prisma.Decimal | null;
};

export type CostReservationResult = "RESERVED" | "EXISTING" | "HARD_LIMIT" | "UNATTRIBUTED_COST";

const scopeWhere = (budget: Pick<Budget, "workspaceId" | "channelId">): Prisma.CostLedgerWhereInput => {
  const contentScope: Prisma.ContentItemWhereInput = budget.channelId
    ? { channelId: budget.channelId }
    : { channel: { workspaceId: budget.workspaceId } };
  const jobScope: Prisma.ProductionJobWhereInput = budget.channelId
    ? { channelId: budget.channelId }
    : { channel: { workspaceId: budget.workspaceId } };
  return {
    OR: [
      { contentItem: contentScope },
      { contentItemId: null, providerUsage: { contentItem: contentScope } },
      { contentItemId: null, providerUsage: { contentItemId: null, productionJob: jobScope } }
    ]
  };
};

const unattributedWhere: Prisma.CostLedgerWhereInput = {
  contentItemId: null,
  OR: [
    { providerUsageId: null },
    { providerUsage: { contentItemId: null, OR: [{ productionJobId: null }, { productionJob: { channelId: null } }] } }
  ]
};

const sumLedger = (entries: Array<{ direction: "ESTIMATED" | "ACTUAL" | "CREDIT"; amount: Prisma.Decimal; providerUsageId: string | null; providerUsage: { actualCost: Prisma.Decimal | null } | null }>): number => {
  const seen = new Set<string>(); let total = new Prisma.Decimal(0);
  for (const entry of entries) {
    if (entry.direction === "CREDIT") { total = total.minus(entry.amount); continue; }
    if (entry.providerUsageId && entry.providerUsage?.actualCost !== null && entry.providerUsage?.actualCost !== undefined) {
      if (!seen.has(entry.providerUsageId)) total = total.plus(entry.providerUsage.actualCost);
      seen.add(entry.providerUsageId); continue;
    }
    total = total.plus(entry.amount);
  }
  return total.toNumber();
};

async function remainingReservationRisk(tx: Prisma.TransactionClient, where: Prisma.AutomationCostReservationWhereInput): Promise<number> {
  const reservations = await tx.automationCostReservation.findMany({ where });
  let risk = new Prisma.Decimal(0);
  for (const reservation of reservations) {
    const platform = reservation.idempotencyKey.split(":").at(-2)?.toUpperCase();
    if (!["YOUTUBE", "INSTAGRAM", "TIKTOK"].includes(platform ?? "")) { risk = risk.plus(reservation.amount); continue; }
    const usage = await tx.providerUsage.findMany({ where: { productionJob: { automationSteps: { some: { automationRunId: reservation.automationRunId, stage: reservation.stage, platform: platform as "YOUTUBE" | "INSTAGRAM" | "TIKTOK" } } } }, select: { actualCost: true, estimatedCost: true } });
    const consumed = usage.reduce((total, item) => total.plus(item.actualCost ?? item.estimatedCost ?? 0), new Prisma.Decimal(0));
    risk = risk.plus(Prisma.Decimal.max(0, reservation.amount.minus(consumed)));
  }
  return risk.toNumber();
}

const decision = (spent: number, reserved: number, softLimit: Prisma.Decimal | null, hardLimit: Prisma.Decimal | null, estimate: number): BudgetDecision =>
  evaluateBudget({ spent, reserved, softLimit: softLimit ? Number(softLimit) : null, hardLimit: hardLimit ? Number(hardLimit) : null }, estimate);

export const reserveAutomationCost = async (input: {
  prisma: PrismaClient;
  budget: Budget;
  runId: string;
  stage: "SCRIPT" | "ASSET" | "TTS" | "RENDER";
  platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK";
  estimate: number;
  now?: Date;
}): Promise<CostReservationResult> => {
  const now = input.now ?? new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1));
  const reservationKey = `automation:${input.runId}:${input.stage.toLowerCase()}:${input.platform.toLowerCase()}:cost`;
  for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
    try {
      return await input.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM workspaces WHERE id = ${input.budget.workspaceId} FOR UPDATE`);
        const existing = await tx.automationCostReservation.findUnique({ where: { idempotencyKey: reservationKey } });
        if (existing && !existing.releasedAt && !existing.settledAt && existing.createdAt >= dayStart) return "EXISTING";
        const previousUsage = existing ? await tx.providerUsage.findMany({ where: { productionJob: { automationSteps: { some: { automationRunId: input.runId, stage: input.stage, platform: input.platform } } } }, select: { actualCost: true, estimatedCost: true } }) : [];
        const consumed = previousUsage.reduce((total, item) => total.plus(item.actualCost ?? item.estimatedCost ?? 0), new Prisma.Decimal(0));
        const requestedRisk = input.stage === "SCRIPT" ? Math.max(0, input.estimate - consumed.toNumber()) : input.estimate;
        const run = await tx.automationRun.findUniqueOrThrow({ where: { id: input.runId }, select: { channelId: true } });
        const budgets = await tx.automationBudget.findMany({ where: { workspaceId: input.budget.workspaceId, OR: [{ channelId: run.channelId }, { channelId: null }] } });
        for (const budget of budgets) {
          if (budget.currency !== "USD") return "UNATTRIBUTED_COST";
          const scope = scopeWhere(budget);
          const reservationScope = budget.channelId
            ? { automationRun: { channelId: budget.channelId } }
            : { automationRun: { channel: { workspaceId: budget.workspaceId } } };
          const [daily, monthly, dailyReserved, monthlyReserved, unattributed] = await Promise.all([
            tx.costLedger.findMany({ where: { currency: budget.currency, occurredAt: { gte: dayStart }, ...scope }, select: { direction: true, amount: true, providerUsageId: true, providerUsage: { select: { actualCost: true } } } }),
            tx.costLedger.findMany({ where: { currency: budget.currency, occurredAt: { gte: monthStart }, ...scope }, select: { direction: true, amount: true, providerUsageId: true, providerUsage: { select: { actualCost: true } } } }),
            remainingReservationRisk(tx, { ...reservationScope, id: { not: existing?.id }, currency: budget.currency, releasedAt: null, settledAt: null, createdAt: { gte: dayStart } }),
            remainingReservationRisk(tx, { ...reservationScope, id: { not: existing?.id }, currency: budget.currency, releasedAt: null, settledAt: null, createdAt: { gte: monthStart } }),
            tx.costLedger.count({ where: { currency: budget.currency, occurredAt: { gte: monthStart }, ...unattributedWhere } })
          ]);
          if (unattributed > 0) return "UNATTRIBUTED_COST";
          const dailyReservedAmount = dailyReserved;
          const monthlyReservedAmount = monthlyReserved;
          if (decision(sumLedger(daily), dailyReservedAmount, budget.dailySoftLimit, budget.dailyHardLimit, requestedRisk) === "HOLD" ||
            decision(sumLedger(monthly), monthlyReservedAmount, budget.monthlySoftLimit, budget.monthlyHardLimit, requestedRisk) === "HOLD") return "HARD_LIMIT";
        }
        const amount = input.stage === "SCRIPT" ? Prisma.Decimal.max(consumed, input.estimate.toFixed(6)) : consumed.plus(input.estimate.toFixed(6));
        if (existing) await tx.automationCostReservation.update({ where: { id: existing.id }, data: { amount, currency: input.budget.currency, releasedAt: null, settledAt: null, settlementBasis: null, createdAt: now } });
        else await tx.automationCostReservation.create({ data: { automationRunId: input.runId, stage: input.stage, idempotencyKey: reservationKey, amount, currency: input.budget.currency, createdAt: now } });
        await tx.automationRun.update({ where: { id: input.runId }, data: { budgetReserved: { increment: amount.minus(existing && !existing.releasedAt && !existing.settledAt ? existing.amount : 0) } } });
        return "RESERVED";
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
      if (!retryable || transactionAttempt === 2) throw error;
    }
  }
  throw new Error("BUDGET_RESERVATION_TRANSACTION_FAILED");
};
