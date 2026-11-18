import { RenderQualityReviewError } from "@postbot/renderer";
import { randomUUID } from "node:crypto";
import { AmbiguousPublishError } from "@postbot/publishers";
import { OAuthReauthenticationRequired, settleJobReservation, assertExecutionOwner, jobExecution, assertJobScope, type Prisma, type PrismaClient } from "@postbot/database";
import type { EnqueueJobInput } from "@postbot/jobs";
import { AssetPreparationJobPayloadSchema, ChannelCollectionProfileSchema, CollectAutomationJobPayloadSchema, PolicyAutomationJobPayloadSchema, RenderJobPayloadSchema, ScriptGenerationJobPayloadSchema, TtsPreparationJobPayloadSchema } from "@postbot/contracts";
import { ScriptGenerationProcessor } from "./script-generation-processor.js";
import { AssetPreparationProcessor } from "./asset-preparation-processor.js";
import { RenderProcessor } from "./render-processor.js";
import { PublishProcessor } from "./publish-processor.js";
import { AnalyticsProcessor } from "./analytics-processor.js";
import { CollectProcessor } from "./collect-processor.js";
import { PolicyProcessor } from "./policy-processor.js";
import { loadConfig } from "@postbot/config";
import { ProviderCallError } from "@postbot/providers";
import { resolveOAuthAccessToken } from "./oauth-token.js";

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
    const run = runId ? await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { status: true, checkpoint: true } }) : null;
    if (runId && run?.status === "CANCELLED") {
      await this.cancel(input.id, null);
      return;
    }
    if (runId && run && !["QUEUED", "RUNNING"].includes(run.status)) return;
    if (persisted.channelId) {
      const channel = await this.prisma.channel.findUnique({ where: { id: persisted.channelId }, select: { status: true } });
      const sample = run?.checkpoint && typeof run.checkpoint === "object" && !Array.isArray(run.checkpoint) && run.checkpoint.sample === true;
      const publish = input.payload.publish;
      const planId = publish && typeof publish === "object" && !Array.isArray(publish) && "publishPlanId" in publish ? publish.publishPlanId : null;
      const readOnlyConfirmation = input.type === "PUBLISH" && typeof planId === "string" && (await this.prisma.platformPost.count({ where: { publishPlanId: planId } }) > 0 || Boolean(publish && typeof publish === "object" && "externalVideoId" in publish));
      if (channel && channel.status !== "ACTIVE" && !(sample && channel.status === "PAUSED") && !readOnlyConfirmation) {
        await this.prisma.productionJob.update({ where: { id: input.id }, data: { status: "NEEDS_REVIEW", errorCode: "CHANNEL_NOT_ACTIVE" } });
        if (runId) await this.prisma.$transaction([
          this.prisma.automationStep.updateMany({ where: { automationRunId: runId, productionJobId: input.id }, data: { status: "HELD", errorCode: "CHANNEL_NOT_ACTIVE" } }),
          this.prisma.automationRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "PAUSED", pausedReason: "CHANNEL_NOT_ACTIVE" } })
        ]);
        return;
      }
    }
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
      const platform = automationPlatform(input.payload);
      if (platform && persisted.channelId) {
        const account = await this.prisma.platformAccount.findFirst({ where: { channelId: persisted.channelId, platform }, include: { credential: true } });
        if (account) {
          try { await resolveOAuthAccessToken(this.prisma, account); }
          catch (error) {
            if (error instanceof Error && ["OAUTH_REFRESH_IN_PROGRESS", "OAUTH_REFRESH_TRANSIENT", "OAUTH_REFRESH_SUPERSEDED"].includes(error.message)) { await this.handleProviderError(input.id, attemptNumber, new ProviderCallError("TRANSIENT", true, true)); return; }
            await this.needsReview(input.id, attemptNumber, { failureKind: error instanceof OAuthReauthenticationRequired ? "AUTH" : "VALIDATION", platform }, error instanceof OAuthReauthenticationRequired ? "ACCOUNT_REAUTH_REQUIRED" : "OAUTH_CONFIGURATION_REVIEW_REQUIRED"); return;
          }
        }
      }
      const reservation = runId ? await this.prisma.automationCostReservation.findUnique({ where: { idempotencyKey: `automation:${runId}:${input.type.toLowerCase()}:${automationPlatform(input.payload)?.toLowerCase()}:cost` } }) : null;
      if (!reservation) { await this.needsReview(input.id, attemptNumber, { reason: "Start a budgeted production workflow." }, "BUDGET_WORKFLOW_REQUIRED"); return; }
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      if (!reservation.settledAt && !reservation.releasedAt && reservation.createdAt < dayStart) { await this.needsReview(input.id, attemptNumber, { reason: "Reauthorize this reservation against the current UTC budget window." }, "BUDGET_WINDOW_REAUTHORIZATION_REQUIRED"); return; }
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
          const profile = rule?.profile ? ChannelCollectionProfileSchema.parse(rule.profile) : null;
          const next = new Date(Date.now() + (profile?.cadence.collectMinutes ?? rule?.collectionFrequencyMinutes ?? 60) * 60_000);
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
        if (await this.handleProviderError(input.id, attemptNumber, error)) return;
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
        if (await this.handleProviderError(input.id, attemptNumber, error)) return;
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
        if (await this.handleProviderError(input.id, attemptNumber, error)) return;
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
        await this.fail(input.id, attemptNumber, message === "RENDER_TIMEOUT" ? "RENDER_TIMEOUT" : "RENDER_FAILED", message);
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
        if (published.reviewRequired === true) { await this.needsReview(input.id, attemptNumber, published, typeof published.reason === "string" ? published.reason : "PUBLICATION_CONFIRMATION_REVIEW_REQUIRED"); return; }
        if (published.pending === true) {
          await this.retry(input.id, attemptNumber, published.rescheduled === true ? "PUBLISH_RESCHEDULED" : "PUBLICATION_CONFIRMATION_PENDING", published.rescheduled === true ? "Wait for the reserved publishing slot." : "Upload is recorded; only read the platform status on retry.");
          await this.prisma.productionJob.update({ where: { id: input.id }, data: { runAfter: typeof published.nextCheckAt === "string" ? new Date(published.nextCheckAt) : new Date(Date.now() + 60000), result: published as Prisma.InputJsonObject } });
          throw new Error("PUBLICATION_CONFIRMATION_PENDING");
        }
        const analytics = published.published === true && automationRunId(input.payload) ? await this.syncAnalyticsAfterPublish(input.payload).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "ANALYTICS_SYNC_FAILED" })) : null;
        await this.succeed(input.id, attemptNumber, { ...published, ...(analytics ? { analytics } : {}) }); return;
       } catch (error) {
        if (error instanceof Error && error.message === "PUBLICATION_CONFIRMATION_PENDING") throw error;
        if (error instanceof OAuthReauthenticationRequired) { await this.needsReview(input.id, attemptNumber, { failureKind: "AUTH" }, "ACCOUNT_REAUTH_REQUIRED"); return; }
        if (error instanceof Error && ["OAUTH_REFRESH_IN_PROGRESS", "OAUTH_REFRESH_TRANSIENT", "OAUTH_REFRESH_SUPERSEDED"].includes(error.message)) { await this.handleProviderError(input.id, attemptNumber, new ProviderCallError("TRANSIENT", true, true)); return; }
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
      await this.settleReservation(jobId);
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

  private async handleProviderError(jobId: string, attemptNumber: number, error: unknown): Promise<boolean> {
    const cacheWait = error instanceof Error && error.message === "ASSET_CACHE_IN_PROGRESS";
    if (cacheWait) error = new ProviderCallError("TRANSIENT", true, true);
    if (error instanceof Error && ["PREPARED_IMAGE_OBJECT_MISSING_RESTORE_REQUIRED", "PREPARED_TTS_OBJECT_MISSING_RESTORE_REQUIRED", "ASSET_CACHE_OBJECT_MISSING_RESTORE_OR_RECONCILE"].includes(error.message)) {
      await this.needsReview(jobId, attemptNumber, { failureKind: "QUALITY", restoreRequired: true }, error.message); return true;
    }
    if (error instanceof Error && ["IMAGE_PRICING_REQUIRED", "TTS_PRICING_REQUIRED", "LLM_PRICING_REQUIRED", "BUDGET_RESERVATION_EXHAUSTED", "BUDGET_WINDOW_REAUTHORIZATION_REQUIRED", "BUDGET_WORKFLOW_REQUIRED", "CHANNEL_GENERATION_COST_LIMIT", "TTS_VOICE_CONFIGURATION_REQUIRED"].includes(error.message)) {
      await this.needsReview(jobId, attemptNumber, { failureKind: error.message === "TTS_VOICE_CONFIGURATION_REQUIRED" ? "VALIDATION" : "BUDGET", rejected: true }, error.message); return true;
    }
    if (!(error instanceof ProviderCallError)) return false;
    if (!error.rejected) { await this.needsReview(jobId, attemptNumber, { reconciliationRequired: true, failureKind: error.kind }, "AMBIGUOUS_PROVIDER_CALL_RECONCILIATION_REQUIRED"); return true; }
    if (!error.retryable || attemptNumber >= (cacheWait ? 5 : 3)) {
      await this.needsReview(jobId, attemptNumber, { failureKind: error.kind, status: error.status, rejected: true }, error.message);
      return true;
    }
    const base = Math.min(3600000, (cacheWait ? 60000 : 30000) * 2 ** (attemptNumber - 1));
    const retryAt = new Date(Math.max(error.retryAt?.getTime() ?? 0, Date.now() + base + Math.floor(Math.random() * base * 0.25)));
    await this.retry(jobId, attemptNumber, error.message, "Provider rejected this attempt; retry uses the original request key.");
    await this.prisma.productionJob.update({ where: { id: jobId }, data: { runAfter: retryAt } });
    throw error;
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
      await this.settleReservation(jobId);
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

  private async settleReservation(jobId: string): Promise<void> {
    await settleJobReservation(this.prisma, jobId);
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
    if (runId && job && result.reconciliationRequired !== true) await this.settleReservation(jobId);
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
