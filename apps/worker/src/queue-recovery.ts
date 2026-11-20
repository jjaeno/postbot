import { hasRecoverableResult } from "@postbot/database";
import type { Prisma, PrismaClient } from "@postbot/database";
import { jobQueueNames, productionJobRequestIntent, JobQueueNameSchema, JobTypeSchema, type QueueAdapter } from "@postbot/jobs";

async function* scanJobs(prisma: PrismaClient, where: Prisma.ProductionJobWhereInput) {
  let cursor: string | undefined;
  do {
    const rows: Awaited<ReturnType<PrismaClient["productionJob"]["findMany"]>> = await prisma.productionJob.findMany({ where: { AND: [where, ...(cursor ? [{ id: { gt: cursor } }] : [])] }, orderBy: { id: "asc" }, take: 100 });
    for (const row of rows) yield row;
    cursor = rows.length === 100 ? rows.at(-1)?.id : undefined;
  } while (cursor);
}
async function* scanPlans(prisma: PrismaClient, where: Prisma.PublishPlanWhereInput) {
  let cursor: string | undefined;
  do {
    const rows: Prisma.PublishPlanGetPayload<{ include: { contentItem: { select: { channelId: true } } } }>[] = await prisma.publishPlan.findMany({ where: { AND: [where, ...(cursor ? [{ id: { gt: cursor } }] : [])] }, include: { contentItem: { select: { channelId: true } } }, orderBy: { id: "asc" }, take: 100 });
    for (const row of rows) yield row;
    cursor = rows.length === 100 ? rows.at(-1)?.id : undefined;
  } while (cursor);
}
// Fresh heartbeat or an active Redis delivery prevents takeover. Known receipts
// can resume with original keys; an uncertain remote outcome remains held.
export async function recoverQueues(prisma: PrismaClient, queue: QueueAdapter, staleAfterMs: number): Promise<{ staleJobsReset: number; jobsEnqueued: number }> {
  if (!queue.state) throw new Error("QUEUE_STATE_REQUIRED");
  const staleBefore = new Date(Date.now() - staleAfterMs);
  let reset = 0;
  for await (const job of scanJobs(prisma, { status: { in: ["RUNNING", "CANCEL_REQUESTED"] }, OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, startedAt: { lt: staleBefore } }] })) {
    if (await queue.state(job.id, JobQueueNameSchema.parse(job.queueName)) === "active") continue;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${job.id} FOR UPDATE`;
      const current = await tx.productionJob.findUniqueOrThrow({ where: { id: job.id } });
      if (!["RUNNING", "CANCEL_REQUESTED"].includes(current.status) || current.executionToken !== job.executionToken || (current.heartbeatAt ?? current.startedAt ?? current.updatedAt) >= staleBefore) return;
      if (current.status === "CANCEL_REQUESTED") {
        await tx.productionJob.update({ where: { id: current.id }, data: { status: "CANCELLED", executionToken: null, heartbeatAt: null, finishedAt: new Date() } });
        await tx.jobAttempt.updateMany({ where: { productionJobId: current.id, status: "RUNNING" }, data: { status: "CANCELLED", finishedAt: new Date(), errorCode: "OWNER_LOST_DURING_CANCEL" } });
        reset++; return;
      }
      const domain = current.payload && typeof current.payload === "object" && !Array.isArray(current.payload) ? current.payload : {};
      const publish = domain.publish && typeof domain.publish === "object" && !Array.isArray(domain.publish) ? domain.publish : {};
      const readOnlyPublication = job.type === "PUBLISH" && (typeof publish.externalVideoId === "string" || typeof publish.publishPlanId === "string" && await tx.platformPost.count({ where: { publishPlanId: publish.publishPlanId } }) > 0);
      const review = ["SCRIPT", "ASSET", "TTS", "PUBLISH"].includes(job.type) && !readOnlyPublication && !await hasRecoverableResult(tx, current);
      await tx.productionJob.update({ where: { id: job.id }, data: { executionToken: null, heartbeatAt: null, status: review ? "NEEDS_REVIEW" : "RETRY_WAIT", errorCode: review ? "RECONCILIATION_REQUIRED" : "QUEUE_STATE_RECOVERED", ...(review ? { result: { reconciliationRequired: true } } : {}) } });
      await tx.jobAttempt.updateMany({ where: { productionJobId: job.id, status: "RUNNING" }, data: { status: review ? "NEEDS_REVIEW" : "FAILED", finishedAt: new Date(), errorCode: "OWNER_LOST" } });
      if (job.type === "ANALYTICS") {
        const domain = (job.payload as Record<string, unknown>).analytics as { syncId?: string } | undefined;
        if (domain?.syncId) await tx.analyticsSync.updateMany({ where: { id: domain.syncId, status: "COLLECTING" }, data: { status: "PARTIAL", nextAttemptAt: null } });
      }
      if (job.type === "PUBLISH") {
        const payload = job.payload as Record<string, unknown>;
        const publish = payload.publish as { publishPlanId?: string } | undefined;
        if (publish?.publishPlanId) await tx.publishPlan.updateMany({ where: { id: publish.publishPlanId, status: "PUBLISHING", platformPost: null }, data: { status: "HELD" } });
      }
      reset += 1;
    });
  }
  // Repair legacy orphan reservations. The DB job itself is the durable outbox.
  for await (const plan of scanPlans(prisma, { status: "SCHEDULED", platformPost: null })) await prisma.productionJob.createMany({ skipDuplicates: true, data: { channelId: plan.contentItem.channelId, contentItemId: plan.contentItemId, type: "PUBLISH", queueName: "publish", idempotencyKey: `publish:${plan.id}`, runAfter: plan.scheduledAt, payload: { publish: { publishPlanId: plan.id }, _requestIntent: productionJobRequestIntent({ channelId: plan.contentItem.channelId, contentItemId: plan.contentItemId, type: "PUBLISH", queueName: "publish", runAfterDate: plan.scheduledAt, payload: { publish: { publishPlanId: plan.id } } }) } } });
  for await (const plan of scanPlans(prisma, { status: "PUBLISHING", platformPost: null, attempts: { none: {} }, updatedAt: { lt: staleBefore } })) await prisma.publishPlan.updateMany({ where: { id: plan.id, status: "PUBLISHING", updatedAt: plan.updatedAt }, data: { status: "HELD" } });
  let jobsEnqueued = 0;
  for await (const job of scanJobs(prisma, { status: { in: ["QUEUED", "RETRY_WAIT"] } })) { await queue.enqueue({ id: job.id, type: JobTypeSchema.parse(job.type), queueName: JobQueueNameSchema.parse(job.queueName), payload: job.payload as Record<string, unknown>, runAfter: job.runAfter }); jobsEnqueued++; }
  if (queue.pruneTerminal) for (const name of jobQueueNames) await queue.pruneTerminal(name);
  return { staleJobsReset: reset, jobsEnqueued };
}
