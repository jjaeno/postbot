import type { PrismaClient } from "@postbot/database";
import { JobQueueNameSchema, JobTypeSchema, type QueueAdapter } from "@postbot/jobs";

// Queue activity and a live DB heartbeat both prevent takeover. Paid/publish
// work is held regardless of journal state: a dead process may have died between
// starting a remote operation and persisting its journal.
export async function recoverQueues(prisma: PrismaClient, queue: QueueAdapter, staleAfterMs: number): Promise<{ staleJobsReset: number; jobsEnqueued: number }> {
  if (!queue.state) throw new Error("QUEUE_STATE_REQUIRED");
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const stale = await prisma.productionJob.findMany({ where: { status: "RUNNING", OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, startedAt: { lt: staleBefore } }] } });
  let reset = 0;
  for (const job of stale) {
    if (await queue.state(job.id, JobQueueNameSchema.parse(job.queueName)) === "active") continue;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${job.id} FOR UPDATE`;
      const current = await tx.productionJob.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status !== "RUNNING" || current.executionToken !== job.executionToken || (current.heartbeatAt ?? current.startedAt ?? current.updatedAt) >= staleBefore) return;
      const review = ["SCRIPT", "ASSET", "TTS", "PUBLISH"].includes(job.type);
      await tx.productionJob.update({ where: { id: job.id }, data: { executionToken: null, heartbeatAt: null, status: review ? "NEEDS_REVIEW" : "RETRY_WAIT", errorCode: review ? "RECONCILIATION_REQUIRED" : "QUEUE_STATE_RECOVERED", ...(review ? { result: { reconciliationRequired: true } } : {}) } });
      await tx.jobAttempt.updateMany({ where: { productionJobId: job.id, status: "RUNNING" }, data: { status: review ? "NEEDS_REVIEW" : "FAILED", finishedAt: new Date(), errorCode: "OWNER_LOST" } });
      if (job.type === "PUBLISH") {
        const payload = job.payload as Record<string, unknown>;
        const publish = payload.publish as { publishPlanId?: string } | undefined;
        if (publish?.publishPlanId) await tx.publishPlan.updateMany({ where: { id: publish.publishPlanId, status: "PUBLISHING", platformPost: null }, data: { status: "HELD" } });
      }
      reset += 1;
    });
  }
  // Repair legacy orphan reservations. The DB job itself is the durable outbox.
  const plans = await prisma.publishPlan.findMany({ where: { status: "SCHEDULED", platformPost: null }, include: { contentItem: { select: { channelId: true } } } });
  for (const plan of plans) await prisma.productionJob.createMany({ skipDuplicates: true, data: { channelId: plan.contentItem.channelId, contentItemId: plan.contentItemId, type: "PUBLISH", queueName: "publish", idempotencyKey: `publish:${plan.id}`, runAfter: plan.scheduledAt, payload: { publish: { publishPlanId: plan.id } } } });
  const orphanPublishing = await prisma.publishPlan.findMany({ where: { status: "PUBLISHING", platformPost: null, attempts: { none: {} }, updatedAt: { lt: staleBefore } } });
  for (const plan of orphanPublishing) await prisma.publishPlan.updateMany({ where: { id: plan.id, status: "PUBLISHING", updatedAt: plan.updatedAt }, data: { status: "HELD" } });
  const jobs = await prisma.productionJob.findMany({ where: { status: { in: ["QUEUED", "RETRY_WAIT"] } }, orderBy: { createdAt: "asc" } });
  for (const job of jobs) await queue.enqueue({ id: job.id, type: JobTypeSchema.parse(job.type), queueName: JobQueueNameSchema.parse(job.queueName), payload: job.payload as Record<string, unknown>, runAfter: job.runAfter });
  return { staleJobsReset: reset, jobsEnqueued: jobs.length };
}
