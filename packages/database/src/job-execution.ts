import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";

export const jobExecution = new AsyncLocalStorage<{ jobId: string; token: string }>();

// Call inside the same transaction as the durable domain write. Recovery and
// completion serialize on this row; a superseded owner cannot commit late data.
export async function assertExecutionOwner(tx: Prisma.TransactionClient): Promise<void> {
  const owner = jobExecution.getStore();
  if (!owner) return; // Direct domain invocations have no worker claim.
  await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${owner.jobId} FOR UPDATE`;
  const job = await tx.productionJob.findUniqueOrThrow({ where: { id: owner.jobId } });
  if (job.executionToken !== owner.token || !["RUNNING", "CANCEL_REQUESTED"].includes(job.status)) throw new Error("JOB_EXECUTION_SUPERSEDED");
}
