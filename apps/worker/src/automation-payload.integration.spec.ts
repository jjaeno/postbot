import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DeterministicJobProcessor } from "./job-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" &&
  new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");

describe.skipIf(!enabled)("automation payload safety", () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it.each(["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH"] as const)(
    "fails %s without domain input instead of marking the stage successful", async (type) => {
      const suffix = randomUUID();
      const user = await prisma.user.create({ data: { email: `${suffix}@acceptance.test`, displayName: "Safety test", passwordHash: "unused" } });
      const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Safety", slug: suffix } });
      const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Safety", slug: suffix } });
      const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: suffix } });
      const payload = { automation: { runId: run.id, stage: type } };
      const queueName = type.toLowerCase() as Lowercase<typeof type>;
      const job = await prisma.productionJob.create({ data: { channelId: channel.id, type, queueName, idempotencyKey: suffix, payload } });
      await prisma.automationStep.create({ data: { automationRunId: run.id, stage: type, productionJobId: job.id } });
      await expect(new DeterministicJobProcessor(prisma).process({ id: job.id, type, queueName, payload, runAfter: null })).rejects.toThrow("AUTOMATION_STAGE_NOT_CONNECTED");
      expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED", errorCode: "AUTOMATION_STAGE_NOT_CONNECTED" });
      expect(await prisma.automationStep.findUniqueOrThrow({ where: { automationRunId_stage: { automationRunId: run.id, stage: type } } })).toMatchObject({ status: "FAILED" });
      expect(await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "FAILED" });
      expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
    }
  );
});
