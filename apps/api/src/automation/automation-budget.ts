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

const sumLedger = (groups: Array<{ direction: "ESTIMATED" | "ACTUAL" | "CREDIT"; _sum: { amount: Prisma.Decimal | null } }>): number =>
  groups.reduce((total, group) => {
    const amount = Number(group._sum.amount?.toString() ?? "0");
    return total + (group.direction === "CREDIT" ? -amount : amount);
  }, 0);

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
        await tx.$queryRaw(Prisma.sql`SELECT id FROM automation_budgets WHERE id = ${input.budget.id} FOR UPDATE`);
        const existing = await tx.automationCostReservation.findUnique({ where: { idempotencyKey: reservationKey } });
        if (existing) return "EXISTING";
        const scope = scopeWhere(input.budget);
        const reservationScope = input.budget.channelId
          ? { automationRun: { channelId: input.budget.channelId } }
          : { automationRun: { channel: { workspaceId: input.budget.workspaceId } } };
        const [daily, monthly, reserved, unattributed] = await Promise.all([
          tx.costLedger.groupBy({ by: ["direction"], where: { currency: input.budget.currency, occurredAt: { gte: dayStart }, ...scope }, _sum: { amount: true } }),
          tx.costLedger.groupBy({ by: ["direction"], where: { currency: input.budget.currency, occurredAt: { gte: monthStart }, ...scope }, _sum: { amount: true } }),
          tx.automationCostReservation.aggregate({ where: { ...reservationScope, currency: input.budget.currency, releasedAt: null, settledAt: null }, _sum: { amount: true } }),
          tx.costLedger.count({ where: { currency: input.budget.currency, occurredAt: { gte: monthStart }, ...unattributedWhere } })
        ]);
        if (unattributed > 0) return "UNATTRIBUTED_COST";
        const reservedAmount = Number(reserved._sum.amount?.toString() ?? "0");
        if (decision(sumLedger(daily), reservedAmount, input.budget.dailySoftLimit, input.budget.dailyHardLimit, input.estimate) === "HOLD" ||
          decision(sumLedger(monthly), reservedAmount, input.budget.monthlySoftLimit, input.budget.monthlyHardLimit, input.estimate) === "HOLD") return "HARD_LIMIT";
        const amount = new Prisma.Decimal(input.estimate.toFixed(6));
        await tx.automationCostReservation.create({ data: { automationRunId: input.runId, stage: input.stage, idempotencyKey: reservationKey, amount, currency: input.budget.currency } });
        await tx.automationRun.update({ where: { id: input.runId }, data: { budgetReserved: { increment: amount } } });
        return "RESERVED";
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
      if (!retryable || transactionAttempt === 2) throw error;
    }
  }
  throw new Error("BUDGET_RESERVATION_TRANSACTION_FAILED");
};
