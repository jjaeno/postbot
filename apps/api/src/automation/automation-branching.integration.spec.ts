import type { Platform } from "@postbot/contracts";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { JobsService } from "../jobs/jobs.service.js";
import type { OperationsService } from "../operations/operations.service.js";
import { AutomationService, automationStages, evaluateAutomationBranches } from "./automation.service.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" &&
  new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");

describe.skipIf(!enabled)("automation branch recovery", () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it("retries only failed Instagram publish and preserves completed YouTube/TikTok branches", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `${suffix}@branch.test`, displayName: "Branch", passwordHash: "unused" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Branch", slug: suffix } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Branch", slug: suffix } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: suffix, status: "FAILED" } });
    const platforms: Platform[] = ["YOUTUBE", "INSTAGRAM", "TIKTOK"];
    await prisma.automationStep.create({ data: { automationRunId: run.id, stage: "COLLECT", branchKey: "COMMON", status: "SUCCEEDED" } });

    let instagramJobId = "";
    for (const platform of platforms) {
      for (const stage of automationStages.slice(1)) {
        let productionJobId: string | undefined;
        if (stage === "PUBLISH") {
          const job = await prisma.productionJob.create({ data: {
            channelId: channel.id,
            type: "PUBLISH",
            queueName: "publish",
            status: platform === "INSTAGRAM" ? "FAILED" : "SUCCEEDED",
            idempotencyKey: `${suffix}:${platform}`,
            payload: { automation: { runId: run.id, stage, platform } }
          } });
          productionJobId = job.id;
          if (platform === "INSTAGRAM") instagramJobId = job.id;
        }
        await prisma.automationStep.create({ data: {
          automationRunId: run.id,
          stage,
          platform,
          branchKey: platform,
          status: platform === "INSTAGRAM" && stage === "PUBLISH" ? "FAILED" : "SUCCEEDED",
          productionJobId
        } });
      }
    }

    const recovered: string[] = [];
    const jobs = {
      recover: (_workspaceId: string, jobId: string) => { recovered.push(jobId); return Promise.resolve(null); }
    } as unknown as JobsService;
    const operations = {} as OperationsService;
    const service = new AutomationService(prisma, jobs, operations);
    const response = await service.control(workspace.id, run.id, {
      action: "retry",
      stage: "PUBLISH",
      platform: "INSTAGRAM",
      reason: "isolated retry"
    });

    expect(recovered).toEqual([instagramJobId]);
    expect(response.steps.find((step) => step.stage === "PUBLISH" && step.platform === "INSTAGRAM")?.status).toBe("QUEUED");
    expect(response.steps.find((step) => step.stage === "PUBLISH" && step.platform === "YOUTUBE")?.status).toBe("SUCCEEDED");
    expect(response.steps.find((step) => step.stage === "PUBLISH" && step.platform === "TIKTOK")?.status).toBe("SUCCEEDED");

    await prisma.automationStep.updateMany({
      where: { automationRunId: run.id, stage: "PUBLISH", platform: "INSTAGRAM" },
      data: { status: "SUCCEEDED" }
    });
    const steps = await prisma.automationStep.findMany({ where: { automationRunId: run.id } });
    expect(evaluateAutomationBranches(steps)).toEqual({ status: "SUCCEEDED", runnable: [] });
    expect(await prisma.productionJob.count({ where: { id: { in: response.steps.flatMap((step) => step.productionJobId ? [step.productionJobId] : []) } } })).toBe(3);
  });
});
