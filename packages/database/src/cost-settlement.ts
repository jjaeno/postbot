import { Prisma, type PrismaClient } from "@prisma/client";

const object = (value: Prisma.JsonValue | undefined | null): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export async function settleJobReservation(prisma: PrismaClient, jobId: string): Promise<"SETTLED" | "RELEASED" | "AMBIGUOUS" | "UNCHANGED"> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
    const payload = object(job.payload); const automation = object(payload.automation);
    if (typeof automation.runId !== "string" || typeof automation.platform !== "string") return "UNCHANGED";
    const key = `automation:${automation.runId}:${job.type.toLowerCase()}:${automation.platform.toLowerCase()}:cost`;
    let reservation = await tx.automationCostReservation.findUnique({ where: { idempotencyKey: key } });
    if (reservation) {
      await tx.$queryRaw`SELECT id FROM automation_cost_reservations WHERE id = ${reservation.id} FOR UPDATE`;
      reservation = await tx.automationCostReservation.findUnique({ where: { id: reservation.id } });
    }
    if (!reservation || reservation.releasedAt || reservation.settledAt || !["SUCCEEDED", "FAILED", "CANCELLED", "NEEDS_REVIEW"].includes(job.status)) return "UNCHANGED";
    const journals = [payload._llmAttempts, payload._mediaCalls];
    if (journals.some((journal) => JSON.stringify(journal ?? {}).includes('"STARTED"'))) return "AMBIGUOUS";
    const usage = await tx.providerUsage.findMany({ where: { productionJobId: jobId } });
    if (usage.some((item) => item.actualCost === null && item.estimatedCost === null && item.quantity.gt(0))) {
      await tx.providerUsage.updateMany({ where: { productionJobId: jobId, actualCost: null, estimatedCost: null, quantity: { gt: 0 } }, data: { billingState: "USAGE_KNOWN_RATE_PENDING" } });
      return "AMBIGUOUS";
    }
    if (usage.some((item) => item.billingState === "AMBIGUOUS") || (!usage.length && journals.some((journal) => JSON.stringify(journal ?? {}).includes('"COMPLETED"')))) return "AMBIGUOUS";
    const actual = usage.reduce((total, item) => total.plus(item.actualCost ?? 0), new Prisma.Decimal(0));
    const known = usage.length > 0;
    const basis = known ? usage.every((item) => item.actualCost !== null) ? "INVOICE_CONFIRMED" : "KNOWN_USAGE_BILLING_PENDING" : "NOT_CALLED_OR_CACHE_REUSED";
    const claimed = await tx.automationCostReservation.updateMany({ where: { id: reservation.id, releasedAt: null, settledAt: null }, data: { ...(known ? { settledAt: new Date() } : { releasedAt: new Date() }), settlementBasis: basis, accountedActual: actual } });
    if (claimed.count) await tx.automationRun.update({ where: { id: reservation.automationRunId }, data: { budgetReserved: { decrement: reservation.amount }, budgetActual: { increment: actual.minus(reservation.accountedActual) } } });
    return known ? "SETTLED" : "RELEASED";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
