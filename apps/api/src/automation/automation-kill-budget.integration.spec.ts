import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { JobsService } from "../jobs/jobs.service.js";
import type { OperationsService } from "../operations/operations.service.js";
import { AutomationService } from "./automation.service.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" && new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");
const prisma = new PrismaClient();
describe.skipIf(!enabled)("kill preserves unsettled paid work", () => {
  afterAll(async () => prisma.$disconnect());
  it("releases only unstarted cancelled jobs and keeps ambiguous/in-flight costs reserved", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@kill-budget.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Kill", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Kill", slug: key } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key, status: "RUNNING", budgetReserved: 3 } });
    const cases = [["SCRIPT", "NEEDS_REVIEW", "HELD", 1], ["ASSET", "QUEUED", "QUEUED", 0], ["TTS", "RUNNING", "RUNNING", 1]] as const;
    for (const [stage, status, stepStatus, attemptCount] of cases) {
      const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: stage, queueName: stage.toLowerCase(), status, startedAt: attemptCount ? new Date() : null, idempotencyKey: `${key}:${stage}`, payload: { automation: { runId: run.id, stage, platform: "YOUTUBE" } }, errorCode: stage === "SCRIPT" ? "AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED" : null } });
      if (attemptCount) await prisma.jobAttempt.create({ data: { productionJobId: job.id, attemptNumber: 1, status } });
      await prisma.automationStep.create({ data: { automationRunId: run.id, stage, platform: "YOUTUBE", branchKey: "YOUTUBE", status: stepStatus, productionJobId: job.id } });
      await prisma.automationCostReservation.create({ data: { automationRunId: run.id, stage, amount: 1, currency: "USD", idempotencyKey: `automation:${run.id}:${stage.toLowerCase()}:youtube:cost` } });
    }
    const service = new AutomationService(prisma, {} as JobsService, {} as OperationsService);
    await service.control(workspace.id, run.id, { action: "kill", reason: "Fixture cancellation" });
    const reservations = await prisma.automationCostReservation.findMany({ where: { automationRunId: run.id } });
    expect(reservations.find((item) => item.stage === "ASSET")?.releasedAt).not.toBeNull();
    expect(reservations.filter((item) => item.stage !== "ASSET").every((item) => item.releasedAt === null && item.settledAt === null)).toBe(true);
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).budgetReserved.toNumber()).toBe(2);
    expect(await prisma.productionJob.findFirstOrThrow({ where: { idempotencyKey: `${key}:TTS` } })).toMatchObject({ status: "RUNNING" });
    await expect(service.control(workspace.id, run.id, { action: "kill" })).rejects.toThrow("AUTOMATION_RUN_TERMINAL");
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).budgetReserved.toNumber()).toBe(2);
  });
});
