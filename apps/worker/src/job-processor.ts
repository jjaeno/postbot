import type { Prisma, PrismaClient } from "@postbot/database";
import type { EnqueueJobInput } from "@postbot/jobs";
import { AssetPreparationJobPayloadSchema, RenderJobPayloadSchema, ScriptGenerationJobPayloadSchema, TtsPreparationJobPayloadSchema } from "@postbot/contracts";
import { ScriptGenerationProcessor } from "./script-generation-processor.js";
import { AssetPreparationProcessor } from "./asset-preparation-processor.js";
import { RenderProcessor } from "./render-processor.js";
import { PublishProcessor } from "./publish-processor.js";

type ProductionJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRY_WAIT"
  | "NEEDS_REVIEW"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCEL_REQUESTED"
  | "CANCELLED";

type WorkerBehavior =
  | { mode: "success" }
  | { mode: "retry-then-success"; failAttempts: number }
  | { mode: "fail"; errorCode: string; message: string }
  | { mode: "timeout"; timeoutMs: number };

const payloadString = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" ? value : null;
};

const payloadNumber = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  return typeof value === "number" ? value : null;
};

const readBehavior = (payload: Record<string, unknown>): WorkerBehavior => {
  const behavior = payloadString(payload, "deterministicBehavior") ?? "success";
  if (behavior === "retry-then-success") {
    return { mode: "retry-then-success", failAttempts: payloadNumber(payload, "failAttempts") ?? 1 };
  }
  if (behavior === "fail") {
    return {
      mode: "fail",
      errorCode: payloadString(payload, "errorCode") ?? "DETERMINISTIC_FAILURE",
      message: payloadString(payload, "message") ?? "Deterministic worker failure."
    };
  }
  if (behavior === "timeout") {
    return { mode: "timeout", timeoutMs: payloadNumber(payload, "timeoutMs") ?? 60_000 };
  }
  return { mode: "success" };
};

const sleep = async (timeoutMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
};

export class DeterministicJobProcessor {
  private readonly scriptGeneration: ScriptGenerationProcessor;
  private readonly assetPreparation: AssetPreparationProcessor;
  private readonly render: RenderProcessor;
  private readonly publish: PublishProcessor;

  constructor(private readonly prisma: PrismaClient) {
    this.scriptGeneration = new ScriptGenerationProcessor(prisma);
    this.assetPreparation = new AssetPreparationProcessor(prisma);
    this.render = new RenderProcessor(prisma);
    this.publish = new PublishProcessor(prisma);
  }

  async process(input: EnqueueJobInput): Promise<void> {
    const attemptNumber = await this.start(input.id);
    if (attemptNumber === null) {
      await this.cancel(input.id, null);
      return;
    }

    const behavior = readBehavior(input.payload);
    if (behavior.mode === "timeout") {
      await sleep(behavior.timeoutMs);
    }

    if (await this.isCancelRequested(input.id)) {
      await this.cancel(input.id, attemptNumber);
      return;
    }

    if (behavior.mode === "fail") {
      await this.fail(input.id, attemptNumber, behavior.errorCode, behavior.message);
      throw new Error(behavior.message);
    }

    if (behavior.mode === "retry-then-success" && attemptNumber <= behavior.failAttempts) {
      await this.retry(input.id, attemptNumber, "RETRY_REQUESTED", "Deterministic retry requested.");
      throw new Error("Deterministic retry requested.");
    }

    if (input.type === "SCRIPT" && ScriptGenerationJobPayloadSchema.safeParse(input.payload).success) {
      try {
        const result = await this.scriptGeneration.process(input.id, input.payload);
        await this.succeed(input.id, attemptNumber, result);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "SCRIPT_GENERATION_FAILED";
        await this.fail(input.id, attemptNumber, "SCRIPT_GENERATION_FAILED", message);
        throw error;
      }
    }

    if (input.type === "ASSET" && AssetPreparationJobPayloadSchema.safeParse(input.payload).success) {
      try {
        const result = await this.assetPreparation.processAsset(input.payload, input.id);
        if (result.needsReview === true) {
          await this.needsReview(input.id, attemptNumber, result);
          return;
        }
        await this.succeed(input.id, attemptNumber, result);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "ASSET_PREPARATION_FAILED";
        await this.fail(input.id, attemptNumber, "ASSET_PREPARATION_FAILED", message);
        throw error;
      }
    }

    if (input.type === "TTS" && TtsPreparationJobPayloadSchema.safeParse(input.payload).success) {
      try {
        await this.succeed(input.id, attemptNumber, await this.assetPreparation.processTts(input.payload, input.id));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "TTS_PREPARATION_FAILED";
        await this.fail(input.id, attemptNumber, "TTS_PREPARATION_FAILED", message);
        throw error;
      }
    }

    if (input.type === "RENDER" && RenderJobPayloadSchema.safeParse(input.payload).success) {
      try {
        await this.succeed(input.id, attemptNumber, await this.render.process(input.payload, input.id));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "RENDER_FAILED";
        await this.fail(input.id, attemptNumber, "RENDER_FAILED", message);
        throw error;
      }
    }
    if (input.type === "PUBLISH") {
      try { await this.succeed(input.id, attemptNumber, await this.publish.process(input.payload)); return; } catch (error) { const message = error instanceof Error ? error.message : "PUBLISH_FAILED"; await this.fail(input.id, attemptNumber, "PUBLISH_FAILED", message); throw error; }
    }

    await this.succeed(input.id, attemptNumber, {
      deterministic: true,
      type: input.type,
      queueName: input.queueName,
      attemptNumber
    });
  }

  private async start(jobId: string): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.productionJob.findUnique({
        where: { id: jobId },
        include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
      });
      if (!record || record.status === "CANCEL_REQUESTED" || record.status === "CANCELLED") {
        return null;
      }
      const attemptNumber = (record.attempts[0]?.attemptNumber ?? 0) + 1;
      await tx.jobAttempt.create({
        data: {
          productionJobId: jobId,
          attemptNumber,
          status: "RUNNING"
        }
      });
      await tx.productionJob.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
      return attemptNumber;
    });
  }

  private async retry(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void> {
    await this.finish(jobId, attemptNumber, "RETRY_WAIT", {
      status: "RETRY_WAIT",
      errorCode,
      errorMessage
    });
  }

  private async succeed(jobId: string, attemptNumber: number, result: Record<string, unknown>): Promise<void> {
    await this.finish(jobId, attemptNumber, "SUCCEEDED", {
      status: "SUCCEEDED",
      result: result as Prisma.InputJsonObject,
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null
    });
  }

  private async fail(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void> {
    await this.finish(jobId, attemptNumber, "FAILED", {
      status: "FAILED",
      finishedAt: new Date(),
      errorCode,
      errorMessage
    });
  }

  private async needsReview(jobId: string, attemptNumber: number, result: Record<string, unknown>): Promise<void> {
    await this.finish(jobId, attemptNumber, "NEEDS_REVIEW", {
      status: "NEEDS_REVIEW",
      result: result as Prisma.InputJsonObject,
      finishedAt: new Date(),
      errorCode: "ASSET_LICENSE_REVIEW_REQUIRED",
      errorMessage: "Asset license requires manual review."
    });
  }

  private async cancel(jobId: string, attemptNumber: number | null): Promise<void> {
    if (attemptNumber === null) {
      await this.prisma.productionJob.update({
        where: { id: jobId },
        data: {
          status: "CANCELLED",
          finishedAt: new Date(),
          errorCode: "JOB_CANCELLED",
          errorMessage: "Job was cancelled."
        }
      });
      return;
    }
    await this.finish(jobId, attemptNumber, "CANCELLED", {
      status: "CANCELLED",
      finishedAt: new Date(),
      errorCode: "JOB_CANCELLED",
      errorMessage: "Job was cancelled."
    });
  }

  private async isCancelRequested(jobId: string): Promise<boolean> {
    const job = await this.prisma.productionJob.findUnique({
      where: { id: jobId },
      select: { status: true }
    });
    return job?.status === "CANCEL_REQUESTED";
  }

  private async finish(
    jobId: string,
    attemptNumber: number,
    attemptStatus: ProductionJobStatus,
    jobData: Prisma.ProductionJobUpdateInput
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.jobAttempt.update({
        where: {
          productionJobId_attemptNumber: {
            productionJobId: jobId,
            attemptNumber
          }
        },
        data: {
          status: attemptStatus,
          finishedAt: new Date(),
          errorCode: typeof jobData.errorCode === "string" ? jobData.errorCode : null,
          errorMessage: typeof jobData.errorMessage === "string" ? jobData.errorMessage : null
        }
      }),
      this.prisma.productionJob.update({
        where: { id: jobId },
        data: jobData
      })
    ]);
  }
}
