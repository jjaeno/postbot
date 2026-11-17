import { spawn } from "node:child_process";
import { PrismaClient, jobExecution } from "@postbot/database";
import { BullMqQueueAdapter } from "@postbot/jobs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { recoverQueues } from "./queue-recovery.js";
import { DeterministicJobProcessor } from "./job-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" && new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");
describe.skipIf(!enabled)("owner loss recovery with MySQL and Redis", () => {
  const prisma = new PrismaClient();
  const queue = new BullMqQueueAdapter(process.env.REDIS_URL ?? "redis://127.0.0.1:16379", `recovery-${randomUUID()}`);
  afterAll(async () => { await queue.close(); await prisma.$disconnect(); });
  async function fixture(type: "COLLECT" | "SCRIPT" = "COLLECT", fresh = false) {
    const old = new Date(Date.now() - 600_000);
    return prisma.productionJob.create({ data: { type, queueName: type.toLowerCase(), idempotencyKey: randomUUID(), payload: {}, status: "RUNNING", executionToken: randomUUID(), heartbeatAt: fresh ? new Date() : old, startedAt: old, attempts: { create: { attemptNumber: 1, status: "RUNNING" } } } });
  }
  it("recovers a dead owner once under competing schedulers and rejects its late completion", async () => {
    const job = await fixture();
    await prisma.jobAttempt.deleteMany({ where: { productionJobId: job.id } });
    await prisma.productionJob.update({ where: { id: job.id }, data: { status: "QUEUED", executionToken: null, payload: { deterministicBehavior: "timeout", timeoutMs: 600_000 } } });
    const code = `import { PrismaClient } from "@postbot/database"; import { DeterministicJobProcessor } from "./src/job-processor.ts";
      const db = new PrismaClient(); const id = ${JSON.stringify(job.id)};
      const work = new DeterministicJobProcessor(db).process({ id, type: "COLLECT", queueName: "collect", payload: {}, runAfter: null });
      const poll = setInterval(async () => { if ((await db.productionJob.findUniqueOrThrow({ where: { id } })).status === "RUNNING") { clearInterval(poll); process.stdout.write("claimed"); } }, 50);
      await work;`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", () => reject(new Error("CHILD_EXITED_BEFORE_CLAIM"))); });
    const killed = await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await exited;
    // Advance the persisted heartbeat rather than waiting ten real minutes.
    await prisma.productionJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date(Date.now() - 600_000), payload: {} } });
    await Promise.all([recoverQueues(prisma, queue, 60_000), recoverQueues(prisma, queue, 60_000)]);
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RETRY_WAIT", executionToken: null });
    const processor = new DeterministicJobProcessor(prisma);
    await expect(jobExecution.run({ jobId: job.id, token: killed.executionToken! }, () => processor["succeed"](job.id, 1, { stale: true }))).rejects.toThrow("JOB_EXECUTION_SUPERSEDED");
    await Promise.all([processor.process({ id: job.id, type: "COLLECT", queueName: "collect", payload: {}, runAfter: null }), processor.process({ id: job.id, type: "COLLECT", queueName: "collect", payload: {}, runAfter: null })]);
    const saved = await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id }, include: { attempts: true } });
    expect(saved.status).toBe("SUCCEEDED");
    expect(saved.attempts).toHaveLength(2);
    await recoverQueues(prisma, queue, 60_000);
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).result).toEqual(saved.result);
  }, 60_000);
  it("preserves long-running owners with fresh heartbeat and holds uncertain paid work", async () => {
    const live = await fixture("COLLECT", true);
    const paid = await fixture("SCRIPT");
    await recoverQueues(prisma, queue, 60_000);
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("RUNNING");
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "RECONCILIATION_REQUIRED" });
  });
});
