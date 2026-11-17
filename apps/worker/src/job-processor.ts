import { RenderQualityReviewError } from "@postbot/renderer";
import { randomUUID } from "node:crypto";
import { AmbiguousPublishError } from "@postbot/publishers";
import { assertExecutionOwner, jobExecution, assertJobScope, type Prisma, type PrismaClient } from "@postbot/database";
import type { EnqueueJobInput } from "@postbot/jobs";
import { AssetPreparationJobPayloadSchema, CollectAutomationJobPayloadSchema, PolicyAutomationJobPayloadSchema, RenderJobPayloadSchema, ScriptGenerationJobPayloadSchema, TtsPreparationJobPayloadSchema } from "@postbot/contracts";
import { ScriptGenerationProcessor } from "./script-generation-processor.js";
import { AssetPreparationProcessor } from "./asset-preparation-processor.js";
import { RenderProcessor } from "./render-processor.js";
import { PublishProcessor } from "./publish-processor.js";
import { AnalyticsProcessor } from "./analytics-processor.js";
import { CollectProcessor } from "./collect-processor.js";
import { PolicyProcessor } from "./policy-processor.js";
import { loadConfig } from "@postbot/config";

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

const automationRunId = (payload: Record<string, unknown>): string | null => {
  const automation = payload.automation;
  return automation && typeof automation === "object" && !Array.isArray(automation) && typeof (automation as Record<string, unknown>).runId === "string" ? String((automation as Record<string, unknown>).runId) : null;
};

const automationPlatform = (payload: Record<string, unknown>): "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | null => {
  const automation = payload.automation;
  if (!automation || typeof automation !== "object" || Array.isArray(automation)) return null;
  const platform = (automation as Record<string, unknown>).platform;
  return platform === "YOUTUBE" || platform === "INSTAGRAM" || platform === "TIKTOK" ? platform : null;
};

const providerForJobType = (type: EnqueueJobInput["type"]): string | null => {
  const providers: Partial<Record<EnqueueJobInput["type"], string>> = {
    SCRIPT: "llm",
    ASSET: "image",
    TTS: "tts",
    RENDER: "renderer",
    PUBLISH: "publisher"
  };
  return providers[type] ?? null;
};

export class DeterministicJobProcessor {
  private readonly scriptGeneration: ScriptGenerationProcessor;
  private readonly assetPreparation: AssetPreparationProcessor;
  private readonly render: RenderProcessor;
  private readonly publish: PublishProcessor;
  private readonly analytics: AnalyticsProcessor;
  private readonly collect: CollectProcessor;
  private readonly policy: PolicyProcessor;

  constructor(private readonly prisma: PrismaClient) {
    this.scriptGeneration = new ScriptGenerationProcessor(prisma);
    this.assetPreparation = new AssetPreparationProcessor(prisma);
    this.render = new RenderProcessor(prisma);
    this.publish = new PublishProcessor(prisma);
    this.analytics = new AnalyticsProcessor(prisma);
    this.collect = new CollectProcessor(prisma);
    this.policy = new PolicyProcessor(prisma);
  }

  async process(input: EnqueueJobInput): Promise<void> {
    const owner = { jobId: input.id, token: randomUUID() };
    await jobExecution.run(owner, async () => {
      const heartbeat = setInterval(() => {
        void this.prisma.productionJob.updateMany({ where: { id: owner.jobId, executionToken: owner.token, status: { in: ["RUNNING", "CANCEL_REQUESTED"] } }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
      }, 5_000);
      try { await this.execute(input); }
      finally { clearInterval(heartbeat); }
    });
  }

  private async execute(input: EnqueueJobInput): Promise<void> {
    const persisted = await this.prisma.productionJob.findUnique({ where: { id: input.id } });
    if (!persisted) throw new Error("JOB_NOT_FOUND");
    if (persisted?.status === "SUCCEEDED" || persisted?.status === "CANCELLED") return;
    if (persisted.status === "NEEDS_REVIEW" || persisted.status === "RUNNING") return;
    // Redis only carries delivery. Execute the authoritative DB payload.
    input = { ...input, type: persisted.type, payload: persisted.payload as Record<string, unknown>, runAfter: persisted.runAfter };

    const runId = automationRunId(input.payload);
    const run = runId ? await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { status: true } }) : null;
    if (runId && run?.status === "CANCELLED") {
      await this.cancel(input.id, null);
      return;
    }
    if (runId && run && !["QUEUED", "RUNNING"].includes(run.status)) return;
    if (await this.isProviderDisabled(input.id, input.type)) {
      await this.holdForProviderSwitch(input.id, input.type);
      return;
    }
    const attemptNumber = await this.start(input.id);
    if (attemptNumber === "completed") return;
    if (attemptNumber === null) {
      await this.cancel(input.id, null);
      return;
    }
    const config = loadConfig();
    const realPaid = (input.type === "SCRIPT" && config.LLM_PROVIDER === "openai") || (input.type === "ASSET" && config.IMAGE_PROVIDER === "google") || (input.type === "TTS" && config.TTS_PROVIDER === "elevenlabs");
    if (realPaid) {
      const reservation = runId ? await this.prisma.automationCostReservation.findUnique({ where: { idempotencyKey: `automation:${runId}:${input.type.toLowerCase()}:${automationPlatform(input.payload)?.toLowerCase()}:cost` } }) : null;
      if (!reservation || reservation.releasedAt || reservation.settledAt) { await this.needsReview(input.id, attemptNumber, { reason: "Start a budgeted production workflow." }, "BUDGET_WORKFLOW_REQUIRED"); return; }
    }

    // The scheduler currently emits only { automation: { runId, stage } }.
    // Never turn an unimplemented stage into a successful deterministic job.
    if (automationRunId(input.payload)) {
      const executable =
        (input.type === "COLLECT" && CollectAutomationJobPayloadSchema.safeParse(input.payload).success) ||
        (input.type === "SCRIPT" && ScriptGenerationJobPayloadSchema.safeParse(input.payload).success) ||
        (input.type === "ASSET" && AssetPreparationJobPayloadSchema.safeParse(input.payload).success) ||
        (input.type === "TTS" && TtsPreparationJobPayloadSchema.safeParse(input.payload).success) ||
        (input.type === "RENDER" && RenderJobPayloadSchema.safeParse(input.payload).success) ||
        (input.type === "POLICY" && PolicyAutomationJobPayloadSchema.safeParse(input.payload).success) ||
        (input.type === "PUBLISH" && typeof input.payload.publish === "object" && input.payload.publish !== null &&
          "publishPlanId" in input.payload.publish && typeof input.payload.publish.publishPlanId === "string");
      if (!executable) {
        await this.fail(input.id, attemptNumber, "AUTOMATION_STAGE_NOT_CONNECTED", "Automation stage has no executable domain payload.");
        throw new Error("AUTOMATION_STAGE_NOT_CONNECTED");
      }
    }

    try { await assertJobScope(this.prisma, persisted); }
    catch { await this.fail(input.id, attemptNumber, "JOB_SCOPE_MISMATCH", "Job resources do not match the persisted scope."); throw new Error("JOB_SCOPE_MISMATCH"); }

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

    if (input.type === "COLLECT" && CollectAutomationJobPayloadSchema.safeParse(input.payload).success) {
      try { await this.succeed(input.id, attemptNumber, await this.collect.process(input.payload)); return; }
      catch (error) {
        const message = error instanceof Error ? error.message : "COLLECT_FAILED";
        if (message === "NO_UNUSED_SOURCE_CANDIDATE_WAIT_FOR_NEXT_COLLECTION" && runId) {
          const rule = await this.prisma.collectionRule.findFirst({ where: { channelId: persisted.channelId ?? "", isActive: true }, orderBy: { version: "desc" } });
          const next = new Date(Date.now() + (rule?.collectionFrequencyMinutes ?? 60) * 60_000);
          await this.succeed(input.id, attemptNumber, { skipped: true, reason: message, nextCollectionAt: next.toISOString() });
          await this.prisma.$transaction([
            this.prisma.automationStep.updateMany({ where: { automationRunId: runId, status: { not: "CANCELLED" } }, data: { status: "SKIPPED", errorCode: "NO_UNUSED_SOURCE_CANDIDATE", finishedAt: new Date() } }),
            this.prisma.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "SUCCEEDED", nextRunAt: next, pausedReason: "NO_UNUSED_SOURCE_CANDIDATE", checkpoint: { skipped: true, reason: message, nextCollectionAt: next.toISOString() } } }),
            this.prisma.automationEvent.create({ data: { automationRunId: runId, action: "HOLD", reason: "NO_UNUSED_SOURCE_CANDIDATE", details: { skipped: true, nextCollectionAt: next.toISOString() } } })
          ]);
          return;
        }
        await this.fail(input.id, attemptNumber, "COLLECT_FAILED", message); throw error;
      }
    }

    if (input.type === "SCRIPT" && ScriptGenerationJobPayloadSchema.safeParse(input.payload).success) {
      try {
        const result = await this.scriptGeneration.process(input.id, input.payload);
        await this.succeed(input.id, attemptNumber, result);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "SCRIPT_GENERATION_FAILED";
        if (message === "AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED") { await this.needsReview(input.id, attemptNumber, { reconciliationRequired: true }, message); return; }
        await this.fail(input.id, attemptNumber, "SCRIPT_GENERATION_FAILED", message);
        throw error;
      }
    }

    if (input.type === "ASSET" && AssetPreparationJobPayloadSchema.safeParse(input.payload).success) {
      try {
        const result = await this.assetPreparation.processAsset(input.payload, input.id);
        if (result.needsReview === true) {
          await this.needsReview(input.id, attemptNumber, result, typeof result.reviewCode === "string" ? result.reviewCode : undefined);
          return;
        }
        await this.succeed(input.id, attemptNumber, result);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "ASSET_PREPARATION_FAILED";
        if (message === "AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED") { await this.needsReview(input.id, attemptNumber, { reconciliationRequired: true }, message); return; }
        await this.fail(input.id, attemptNumber, "ASSET_PREPARATION_FAILED", message);
        throw error;
      }
    }

    if (input.type === "TTS" && TtsPreparationJobPayloadSchema.safeParse(input.payload).success) {
      try {
        const result = await this.assetPreparation.processTts(input.payload, input.id);
        if (result.needsReview === true) { await this.needsReview(input.id, attemptNumber, result); return; }
        await this.succeed(input.id, attemptNumber, result);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "TTS_PREPARATION_FAILED";
        if (message === "AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED") { await this.needsReview(input.id, attemptNumber, { reconciliationRequired: true }, message); return; }
        await this.fail(input.id, attemptNumber, "TTS_PREPARATION_FAILED", message);
        throw error;
      }
    }

    if (input.type === "RENDER" && RenderJobPayloadSchema.safeParse(input.payload).success) {
      try {
        await this.succeed(input.id, attemptNumber, await this.render.process(input.payload, input.id));
        return;
      } catch (error) {
        if (error instanceof Error && error.message === "RENDER_CANCELLED") { await this.cancel(input.id, attemptNumber); return; }
        if (error instanceof RenderQualityReviewError) { await this.needsReview(input.id, attemptNumber, { findings: [...error.findings], reason: "Adjust the scene layout or narration timing before rendering." }, "RENDER_TECHNICAL_REVIEW_REQUIRED"); return; }
        const message = error instanceof Error ? error.message : "RENDER_FAILED";
        await this.fail(input.id, attemptNumber, "RENDER_FAILED", message);
        throw error;
      }
    }
    if (input.type === "POLICY" && PolicyAutomationJobPayloadSchema.safeParse(input.payload).success) {
      try {
        const result = await this.policy.process(input.payload);
        if (result.status !== "pass") { await this.needsReview(input.id, attemptNumber, result, "POLICY_REVIEW_REQUIRED"); return; }
        await this.succeed(input.id, attemptNumber, result); return;
      } catch (error) { const message = error instanceof Error ? error.message : "POLICY_CHECK_FAILED"; await this.fail(input.id, attemptNumber, "POLICY_CHECK_FAILED", message); throw error; }
    }
    if (input.type === "PUBLISH") {
      try {
        const published = await this.publish.process(input.payload);
        const analytics = automationRunId(input.payload) ? await this.syncAnalyticsAfterPublish(input.payload).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "ANALYTICS_SYNC_FAILED" })) : null;
        await this.succeed(input.id, attemptNumber, { ...published, ...(analytics ? { analytics } : {}) }); return;
       } catch (error) {
        if (error instanceof AmbiguousPublishError) { await this.needsReview(input.id, attemptNumber, { reconciliationRequired: true, externalOperationId: error.externalOperationId }, "AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED"); return; }
        const message = error instanceof Error ? error.message : "PUBLISH_FAILED"; await this.fail(input.id, attemptNumber, "PUBLISH_FAILED", message); throw error;
      }
    }
    if (input.type === "ANALYTICS") {
      try { await this.succeed(input.id, attemptNumber, await this.analytics.process(input.payload)); return; } catch (error) { const message = error instanceof Error ? error.message : "ANALYTICS_SYNC_FAILED"; await this.fail(input.id, attemptNumber, "ANALYTICS_SYNC_FAILED", message); throw error; }
    }

    await this.succeed(input.id, attemptNumber, {
      deterministic: true,
      type: input.type,
      queueName: input.queueName,
      attemptNumber
    });
  }

  private async syncAnalyticsAfterPublish(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const publish = payload.publish;
    if (!publish || typeof publish !== "object" || Array.isArray(publish) || typeof (publish as Record<string, unknown>).publishPlanId !== "string") throw new Error("INVALID_PUBLISH_PAYLOAD");
    const plan = await this.prisma.publishPlan.findUniqueOrThrow({ where: { id: String((publish as Record<string, unknown>).publishPlanId) }, select: { platform: true, contentItem: { select: { channelId: true } } } });
    const runId = automationRunId(payload);
    if (!runId) return { skipped: true };
    const now = new Date(); const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const key = `automation:${runId}:${plan.platform.toLowerCase()}:analytics`;
    const sync = await this.prisma.analyticsSync.upsert({ where: { idempotencyKey: key }, update: {}, create: { channelId: plan.contentItem.channelId, platform: plan.platform, status: "RUNNING", idempotencyKey: key, periodStart, periodEnd: now, timezone: "UTC" } });
    return this.analytics.process({ analytics: { syncId: sync.id } });
  }

  private async start(jobId: string): Promise<number | "completed" | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
      const record = await tx.productionJob.findUnique({
        where: { id: jobId },
        include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
      });
      if (record && ["SUCCEEDED", "RUNNING", "NEEDS_REVIEW"].includes(record.status)) return "completed";
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
          executionToken: jobExecution.getStore()?.token ?? null,
          heartbeatAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
      // A failed automation-state write must roll back the claim and attempt.
      // Otherwise redelivery sees RUNNING and drops work that never executed.
      await this.markAutomationStepRunning(jobId, attemptNumber, tx);
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
    const job = await this.prisma.productionJob.findUnique({ where: { id: jobId }, select: { payload: true, type: true } });
    const runId = job ? automationRunId(job.payload as Record<string, unknown>) : null;
    if (runId && job) {
      const now = new Date();
      const run = await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { checkpoint: true } });
      const previousCheckpoint = run?.checkpoint && typeof run.checkpoint === "object" && !Array.isArray(run.checkpoint) ? run.checkpoint : {};
      await this.prisma.$transaction([
        this.prisma.automationStep.updateMany({ where: { automationRunId: runId, productionJobId: jobId }, data: { status: "SUCCEEDED", attemptCount: attemptNumber, output: result as Prisma.InputJsonObject, finishedAt: now } }),
        this.prisma.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING", failureCount: 0, heartbeatAt: now, checkpoint: { ...previousCheckpoint, stage: job.type.toLowerCase(), platform: automationPlatform(job.payload as Record<string, unknown>), lastJobId: jobId, completedAt: now.toISOString() } } })
      ]);
      await this.settleReservation(runId, jobId, job.type, false);
    }
  }

  private async isProviderDisabled(jobId: string, type: EnqueueJobInput["type"]): Promise<boolean> {
    const provider = providerForJobType(type);
    if (!provider) return false;
    const job = await this.prisma.productionJob.findUnique({ where: { id: jobId }, select: { channel: { select: { workspaceId: true, errorAction: true } } } });
    if (!job?.channel) return false;
    const blocked = await this.prisma.automationSwitch.findFirst({ where: { workspaceId: job.channel.workspaceId, OR: [{ provider }, { provider: null }], isEnabled: false } });
    return blocked !== null;
  }

  private async holdForProviderSwitch(jobId: string, type: EnqueueJobInput["type"]): Promise<void> {
    const job = await this.prisma.productionJob.findUnique({ where: { id: jobId }, select: { payload: true, type: true, channel: { select: { workspaceId: true, errorAction: true } } } });
    const runId = job ? automationRunId(job.payload as Record<string, unknown>) : null;
    await this.prisma.productionJob.update({ where: { id: jobId }, data: { status: "NEEDS_REVIEW", errorCode: "PROVIDER_SWITCH_DISABLED", errorMessage: "The provider kill switch is enabled." } });
    if (!runId) return;
    await this.prisma.$transaction([
      this.prisma.automationStep.updateMany({ where: { automationRunId: runId, productionJobId: jobId }, data: { status: "HELD", errorCode: "PROVIDER_SWITCH_DISABLED", errorMessage: "The provider kill switch is enabled.", finishedAt: new Date() } }),
      this.prisma.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING", pausedReason: null, nextRunAt: new Date() } }),
      this.prisma.automationEvent.create({ data: { automationRunId: runId, action: "HOLD", reason: "PROVIDER_SWITCH_DISABLED", details: { provider: providerForJobType(type), platform: automationPlatform(job?.payload as Record<string, unknown>) } } })
    ]);
  }

  private async fail(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void> {
    await this.finish(jobId, attemptNumber, "FAILED", {
      status: "FAILED",
      finishedAt: new Date(),
      errorCode,
      errorMessage
    });
    const job = await this.prisma.productionJob.findUnique({ where: { id: jobId }, select: { payload: true, type: true, channel: { select: { workspaceId: true, errorAction: true } } } });
    if (job?.channel) {
      const bucket = Math.floor(Date.now() / 1_800_000);
      await this.prisma.notification.upsert({ where: { notificationKey: `${job.channel.workspaceId}:job.failed:${jobId}:${bucket}` }, create: { workspaceId: job.channel.workspaceId, notificationKey: `${job.channel.workspaceId}:job.failed:${jobId}:${bucket}`, eventKey: "job.failed", severity: "WARNING", payload: { jobId, type: job.type, errorCode } }, update: {} });
    }
    const runId = job ? automationRunId(job.payload as Record<string, unknown>) : null;
    if (runId && job) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.automationStep.updateMany({ where: { automationRunId: runId, productionJobId: jobId }, data: { status: "FAILED", attemptCount: attemptNumber, errorCode, errorMessage, finishedAt: now } }),
        this.prisma.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING", failureCount: { increment: 1 }, heartbeatAt: now, nextRunAt: now, lastErrorCode: errorCode, lastErrorMessage: errorMessage } })
      ]);
      await this.settleReservation(runId, jobId, job.type, true);
      const run = await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { failureCount: true } });
      const actions = job.channel?.errorAction;
      const notifyOnly = actions && typeof actions === "object" && !Array.isArray(actions) && actions.onConsecutiveFailures === "notify_only";
      if (run && run.failureCount >= 3 && !notifyOnly) {
        await this.prisma.$transaction([
          this.prisma.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "PAUSED", pausedReason: "CONSECUTIVE_FAILURE_THRESHOLD" } }),
          this.prisma.automationEvent.create({ data: { automationRunId: runId, action: "AUTO_PAUSE", reason: "CONSECUTIVE_FAILURE_THRESHOLD", details: { failureCount: run.failureCount, errorCode } } })
        ]);
        const channel = await this.prisma.productionJob.findUnique({ where: { id: jobId }, select: { channelId: true } });
        if (channel?.channelId) await this.prisma.channel.update({ where: { id: channel.channelId }, data: { status: "PAUSED" } });
      }
    }
  }

  private async settleReservation(runId: string, jobId: string, type: EnqueueJobInput["type"], release: boolean): Promise<void> {
    const job = await this.prisma.productionJob.findUnique({ where: { id: jobId }, select: { payload: true } });
    const platform = job ? automationPlatform(job.payload as Record<string, unknown>) : null;
    if (!platform) return;
    const key = `automation:${runId}:${type.toLowerCase()}:${platform.toLowerCase()}:cost`;
    const reservation = await this.prisma.automationCostReservation.findUnique({ where: { idempotencyKey: key } });
    if (!reservation || reservation.releasedAt || reservation.settledAt) return;
    const record = await this.prisma.productionJob.findUniqueOrThrow({ where: { id: jobId } });
    const calls = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload : {};
    if (JSON.stringify(calls._llmAttempts ?? {}).includes('"STARTED"') || JSON.stringify(calls._mediaCalls ?? {}).includes('"STARTED"')) return;
    const usage = await this.prisma.providerUsage.aggregate({ where: { productionJobId: jobId }, _sum: { actualCost: true, estimatedCost: true } });
    // Configured-rate usage estimates are not reconciled invoice charges. Keep
    // paid reservations until actual costs are recorded; failure is not a refund.
    const paid = (type === "SCRIPT" && loadConfig().LLM_PROVIDER === "openai") || (type === "ASSET" && loadConfig().IMAGE_PROVIDER === "google") || (type === "TTS" && loadConfig().TTS_PROVIDER === "elevenlabs");
    if (paid && usage._sum.estimatedCost?.gt(0) && usage._sum.actualCost === null) return;
    if (release && paid && usage._sum.actualCost?.gt(0)) return;
    const actual = usage?._sum.actualCost;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.automationCostReservation.updateMany({ where: { id: reservation.id, releasedAt: null, settledAt: null }, data: actual ? { settledAt: now } : { releasedAt: now } });
      if (claimed.count === 1) await tx.automationRun.update({ where: { id: runId }, data: { budgetReserved: { decrement: reservation.amount }, ...(actual ? { budgetActual: { increment: actual } } : {}) } });
    });
  }

  private async markAutomationStepRunning(jobId: string, attemptNumber: number, tx: Prisma.TransactionClient): Promise<void> {
    const job = await tx.productionJob.findUnique({ where: { id: jobId }, select: { payload: true } });
    const runId = job ? automationRunId(job.payload as Record<string, unknown>) : null;
    if (!runId) return;
    const now = new Date();
    await tx.automationStep.updateMany({ where: { automationRunId: runId, productionJobId: jobId }, data: { status: "RUNNING", attemptCount: attemptNumber, startedAt: now } });
    await tx.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING", heartbeatAt: now } });
  }

  private async needsReview(jobId: string, attemptNumber: number, result: Record<string, unknown>, errorCode = "ASSET_LICENSE_REVIEW_REQUIRED"): Promise<void> {
    const stockMessage = "장면에 맞는 스톡 이미지가 없습니다. 이미지 설명·태그를 보완하거나 관련 소재를 등록한 뒤 재시도하세요.";
    const layoutMessage = "장면의 글자 배치·소재·자막 타이밍을 확인하고 검토 사유를 보완한 뒤 재시도하세요.";
    await this.finish(jobId, attemptNumber, "NEEDS_REVIEW", {
      status: "NEEDS_REVIEW",
      result: result as Prisma.InputJsonObject,
      finishedAt: new Date(),
      errorCode,
      errorMessage: errorCode === "STOCK_MATCH_REQUIRED" ? stockMessage : errorCode === "RENDER_TECHNICAL_REVIEW_REQUIRED" ? layoutMessage : errorCode === "AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED" ? "Publication outcome requires reconciliation before retry; no automatic re-upload." : result.reconciliationRequired === true ? "Provider call outcome and billing require reconciliation before retry; no automatic paid retry." : errorCode === "POLICY_REVIEW_REQUIRED" ? "Policy findings require manual review." : "Asset license requires manual review."
    });
    const job = await this.prisma.productionJob.findUnique({ where: { id: jobId }, select: { payload: true, type: true } });
    const runId = job ? automationRunId(job.payload as Record<string, unknown>) : null;
    if (runId && job && result.reconciliationRequired !== true) await this.settleReservation(runId, jobId, job.type, false);
    if (runId) await this.prisma.$transaction([
      this.prisma.automationStep.updateMany({ where: { automationRunId: runId, productionJobId: jobId }, data: { status: "HELD", attemptCount: attemptNumber, output: result as Prisma.InputJsonObject, errorCode, errorMessage: errorCode === "STOCK_MATCH_REQUIRED" ? stockMessage : errorCode === "RENDER_TECHNICAL_REVIEW_REQUIRED" ? layoutMessage : "Manual review is required.", finishedAt: new Date() } }),
      this.prisma.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING", pausedReason: null, heartbeatAt: new Date(), nextRunAt: new Date() } })
    ]);
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
    await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.jobAttempt.update({ where: { productionJobId_attemptNumber: { productionJobId: jobId, attemptNumber } }, data: { status: attemptStatus, finishedAt: new Date(), errorCode: typeof jobData.errorCode === "string" ? jobData.errorCode : null, errorMessage: typeof jobData.errorMessage === "string" ? jobData.errorMessage : null } });
      await tx.productionJob.update({ where: { id: jobId }, data: { ...jobData, executionToken: null, heartbeatAt: null } });
    });
  }
}
