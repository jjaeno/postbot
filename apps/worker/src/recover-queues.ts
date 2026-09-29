import "dotenv/config";
import { createPrismaClient } from "@postbot/database";
import { BullMqQueueAdapter, JobQueueNameSchema, JobTypeSchema } from "@postbot/jobs";
import { loadConfig } from "@postbot/config";

const prisma = createPrismaClient();
const config = loadConfig();
const queue = new BullMqQueueAdapter(config.REDIS_URL);
const staleBefore = new Date(Date.now() - config.QUEUE_RECOVERY_STALE_AFTER_MS);

try {
  const stale = await prisma.productionJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore } },
    data: { status: "RETRY_WAIT", errorCode: "QUEUE_STATE_RECOVERED", errorMessage: "Recovered after Redis queue state loss." }
  });
  const jobs = await prisma.productionJob.findMany({
    where: { status: { in: ["QUEUED", "RETRY_WAIT"] } },
    orderBy: { createdAt: "asc" }
  });
  let enqueued = 0;
  for (const job of jobs) {
    const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload as Record<string, unknown> : {};
    await queue.enqueue({ id: job.id, type: JobTypeSchema.parse(job.type), queueName: JobQueueNameSchema.parse(job.queueName), payload, runAfter: job.runAfter });
    enqueued += 1;
  }
  process.stdout.write(`${JSON.stringify({ staleJobsReset: stale.count, jobsEnqueued: enqueued })}\n`);
} finally {
  await queue.close();
  await prisma.$disconnect();
}
