import { ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  AutomationBudgetRequestSchema,
  AutomationControlRequestSchema,
  AutomationRunRequestSchema,
  AutomationRunResponseSchema,
  AutomationSwitchRequestSchema,
  type AutomationRunResponse,
  type AutomationBudgetResponse,
  type AutomationStage,
  type Platform
} from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { loadConfig } from "@postbot/config";
import { JobsService } from "../jobs/jobs.service.js";
import { OperationsService } from "../operations/operations.service.js";
import { isCostStage } from "./automation-safety.js";
import { reserveAutomationCost } from "./automation-budget.js";
import { estimateAutomationStageCost, type AutomationCostUsage } from "./automation-cost-estimator.js";
import { nextZonedSchedule } from "./schedule-time.js";
import { createScheduledPlan, localPublishDay } from "../publishing/publish-slots.js";

export const automationStages = ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH"] as const satisfies readonly AutomationStage[];
const platformStages = automationStages.filter((stage): stage is Exclude<AutomationStage, "COLLECT"> => stage !== "COLLECT");
type Stage = (typeof automationStages)[number];
type BranchPlatform = Platform | null;
const branchKey = (platform: BranchPlatform): string => platform ?? "COMMON";
const isComplete = (status: string): boolean => status === "SUCCEEDED" || status === "SKIPPED";
const isTerminal = (status: string): boolean => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);
const asObject = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const decimalNumber = (value: Prisma.Decimal | null): number | null => value === null ? null : value.toNumber();
export const isAbandonedAutomationClaim = (updatedAt: Date, now = Date.now()): boolean => updatedAt.getTime() <= now - 60_000;

export const inventoryDeficit = (
  minimum: number,
  generating: number,
  review: number,
  approved: number,
  scheduled: number
): number => Math.max(0, minimum - (generating + review + approved + scheduled));

type RunStep = {
  id?: string;
  stage: string;
  platform: Platform | null;
  status: string;
};

export type AutomationRunDecision =
  | { status: "RUNNING"; runnable: Array<{ stage: Stage; platform: BranchPlatform }> }
  | { status: "SUCCEEDED" | "FAILED" | "PAUSED"; runnable: [] };

export const evaluateAutomationBranches = (steps: RunStep[]): AutomationRunDecision => {
  const common = steps.find((step) => step.stage === "COLLECT" && step.platform === null);
  if (!common) return { status: "FAILED", runnable: [] };
  if (common.status === "FAILED") return { status: "FAILED", runnable: [] };
  if (common.status === "HELD") return { status: "PAUSED", runnable: [] };
  if (!isComplete(common.status)) {
    return common.status === "PENDING"
      ? { status: "RUNNING", runnable: [{ stage: "COLLECT", platform: null }] }
      : { status: "RUNNING", runnable: [] };
  }

  const platforms = [...new Set(steps.flatMap((step) => step.platform ? [step.platform] : []))];
  const runnable: Array<{ stage: Stage; platform: BranchPlatform }> = [];
  let active = false;
  let failed = false;
  let held = false;
  for (const platform of platforms) {
    const branch = platformStages.map((stage) => steps.find((step) => step.stage === stage && step.platform === platform));
    if (branch.some((step) => !step)) {
      failed = true;
      continue;
    }
    const firstIncomplete = branch.findIndex((step) => !isComplete(step!.status));
    if (firstIncomplete < 0) continue;
    const step = branch[firstIncomplete]!;
    if (step.status === "FAILED") failed = true;
    else if (step.status === "HELD") held = true;
    else if (step.status === "PENDING") {
      runnable.push({ stage: step.stage as Stage, platform });
      active = true;
    } else {
      active = true;
    }
  }
  if (runnable.length > 0 || active) return { status: "RUNNING", runnable };
  if (failed) return { status: "FAILED", runnable: [] };
  if (held) return { status: "PAUSED", runnable: [] };
  return { status: "SUCCEEDED", runnable: [] };
};

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private scheduler: NodeJS.Timeout | null = null;
  private scheduling = false;

  constructor(
    @Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient,
    private readonly jobs: JobsService,
    private readonly operations: OperationsService
  ) {}

  onModuleInit(): void {
    this.scheduler = setInterval(() => void this.scheduleDueRuns().catch(() => undefined), loadConfig().AUTOMATION_POLL_INTERVAL_MS);
    void this.scheduleDueRuns().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.scheduler) clearInterval(this.scheduler);
  }

  async start(workspaceId: string, raw: unknown): Promise<AutomationRunResponse> {
    const input = AutomationRunRequestSchema.parse(raw);
    const workspaceSwitch = await this.prisma.automationSwitch.findFirst({
      where: { workspaceId, provider: null, isEnabled: false }
    });
    if (workspaceSwitch) throw new ConflictException("AUTOMATION_KILL_SWITCH_ENABLED");
    const existing = await this.prisma.automationRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } }
    });
    if (existing) {
      const owned = await this.prisma.channel.findFirst({ where: { id: existing.channelId, workspaceId }, select: { id: true } });
      if (!owned) throw new NotFoundException("AUTOMATION_RUN_NOT_FOUND");
      return this.toResponse(existing);
    }

    const channel = await this.prisma.channel.findFirst({
      where: { id: input.channelId, workspaceId, status: input.sample ? { in: ["ACTIVE", "PAUSED"] } : "ACTIVE" },
      include: {
        platformAccounts: true,
        scheduleRules: { where: { isActive: true } },
        outputProfiles: { where: { isActive: true } }
      }
    });
    if (!channel) throw new NotFoundException("ACTIVE_CHANNEL_NOT_FOUND");
    const availablePlatforms = [...new Set([
      ...channel.outputProfiles.map((profile) => profile.platform),
      ...channel.platformAccounts.filter((account) => account.status === "CONNECTED").map((account) => account.platform)
    ])].sort();
    const platforms = input.platforms ? [...new Set(input.platforms)].sort() : availablePlatforms;
    if (platforms.length === 0) throw new ConflictException("ACTIVE_OUTPUT_PLATFORM_REQUIRED");
    if (platforms.some((platform) => !availablePlatforms.includes(platform))) throw new ConflictException("REQUESTED_OUTPUT_PLATFORM_NOT_CONFIGURED");
    const selectedIdea = input.ideaId ? await this.prisma.contentIdea.findFirst({ where: { id: input.ideaId, channelId: channel.id, channel: { workspaceId } } }) : null;
    if (input.ideaId && !selectedIdea) throw new NotFoundException("CONTENT_IDEA_NOT_FOUND");

    const counts = await this.prisma.contentItem.groupBy({
      by: ["status"],
      where: { channelId: channel.id },
      _count: { _all: true }
    });
    const count = (status: "GENERATING" | "REVIEW_REQUIRED" | "APPROVED" | "SCHEDULED"): number =>
      counts.find((entry) => entry.status === status)?._count._all ?? 0;
    const deficit = selectedIdea || input.sample ? 1 : inventoryDeficit(
      channel.minInventoryCount,
      count("GENERATING"),
      count("REVIEW_REQUIRED"),
      count("APPROVED"),
      count("SCHEDULED")
    );
    const missingFullAutoSetup = !input.sample && channel.automationMode === "FULL_AUTO" && platforms.some((platform) =>
      !channel.platformAccounts.some((account) => account.status === "CONNECTED" && account.platform === platform)
      || !channel.scheduleRules.some((rule) => rule.platform === null || rule.platform === platform)
    );
    const heldReason = missingFullAutoSetup ? "NO_CONNECTED_ACCOUNT_OR_SCHEDULE" : null;
    const initialStatus: "SKIPPED" | "HELD" | "PENDING" = deficit === 0 ? "SKIPPED" : heldReason ? "HELD" : "PENDING";
    const ideaSnapshot = selectedIdea ? {
      id: selectedIdea.id, channelId: selectedIdea.channelId, title: selectedIdea.title, summary: selectedIdea.summary ?? "",
      canonicalUrl: selectedIdea.canonicalUrl, sourceName: selectedIdea.sourceName, sourceKind: selectedIdea.sourceKind,
      publishedAt: selectedIdea.publishedAt?.toISOString() ?? null, topic: channel.topic ?? channel.name, language: channel.language
    } : null;
    const steps = [
      { stage: "COLLECT" as const, platform: null, branchKey: "COMMON", status: selectedIdea && !heldReason ? "SUCCEEDED" as const : initialStatus, ...(ideaSnapshot ? { output: { idea: ideaSnapshot }, finishedAt: new Date() } : {}) },
      ...platforms.flatMap((platform) => platformStages.map((stage) => ({
        stage,
        platform,
        branchKey: platform,
        status: initialStatus
      })))
    ];
    const reservation = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channel.id} FOR UPDATE`;
      const active = !selectedIdea && !input.sample ? await tx.automationRun.findFirst({ where: { channelId: channel.id, status: { in: ["QUEUED", "RUNNING", "PAUSED", "DRAINING"] } }, orderBy: { createdAt: "desc" }, include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } } }) : null;
      if (active) return { run: active, created: false };
      const created = await tx.automationRun.create({
      data: {
        channelId: channel.id,
        idempotencyKey: input.idempotencyKey,
        status: deficit === 0 ? "SUCCEEDED" : heldReason ? "PAUSED" : "QUEUED",
        pausedReason: heldReason,
        checkpoint: {
          stage: deficit === 0 ? "inventory-satisfied" : selectedIdea ? "script" : "collect",
          deficit,
          completed: [],
          platforms,
          partial: input.partial
          , sample: input.sample === true
        },
        nextRunAt: deficit === 0 || heldReason ? null : new Date(),
        steps: { create: steps },
        events: { create: { action: "START", details: { deficit, mode: channel.automationMode, platforms, source: selectedIdea ? "manual-idea" : "scheduler" } } }
      },
      include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } }
      });
      return { run: created, created: true };
    });
    const run = reservation.run;
    if (!reservation.created) return this.toResponse(run);
    if (deficit > 0 && !heldReason) {
      if (selectedIdea) await Promise.all(platforms.map((platform) => this.enqueueStage(workspaceId, run.id, channel.id, "SCRIPT", platform)));
      else await this.enqueueStage(workspaceId, run.id, channel.id, "COLLECT", null);
    }
    return this.get(workspaceId, run.id);
  }

  async get(workspaceId: string, runId: string): Promise<AutomationRunResponse> {
    const run = await this.prisma.automationRun.findFirst({
      where: { id: runId, channel: { workspaceId } },
      include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } }
    });
    if (!run) throw new NotFoundException("AUTOMATION_RUN_NOT_FOUND");
    return this.toResponse(run);
  }

  async completeSampleSetup(workspaceId: string, runId: string): Promise<{ ok: true }> {
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, channel: { workspaceId } }, include: { steps: true, channel: { include: { platformAccounts: { include: { credential: true } }, templates: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 }, outputProfiles: { where: { isActive: true } } } } } });
    if (!run || asObject(run.checkpoint).sample !== true) throw new NotFoundException("SAMPLE_RUN_NOT_FOUND");
    if (!run.channel.platformAccounts.some((account) => account.status === "CONNECTED" && account.credential && (!account.credential.expiresAt || account.credential.expiresAt > new Date()))) throw new ConflictException("CONNECTED_PLATFORM_ACCOUNT_REQUIRED");
    if (run.steps.some((step) => ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER"].includes(step.stage) && step.status !== "SUCCEEDED")) throw new ConflictException("SAMPLE_NOT_READY");
    for (const profile of run.channel.outputProfiles) {
      const output = asObject(run.steps.find((step) => step.stage === "SCRIPT" && step.platform === profile.platform)?.output ?? null);
      if (typeof output.contentItemId !== "string" || typeof output.sceneVersionId !== "string") throw new ConflictException("SAMPLE_NOT_READY");
      const scene = await this.prisma.sceneVersion.findUnique({ where: { id: output.sceneVersionId }, include: { scriptVersion: true } });
      const check = await this.prisma.policyCheck.findFirst({ where: { contentItemId: output.contentItemId, platform: profile.platform }, orderBy: { checkedAt: "desc" } });
      if (!scene?.renderManifest || !scene.scriptVersion || asObject(scene.scriptVersion.qualitySnapshot).reviewStatus !== "APPROVED" || check?.status !== "PASS" || check.checkedAt < scene.createdAt || (run.channel.templates[0] && run.channel.templates[0].createdAt > scene.createdAt)) throw new ConflictException("SAMPLE_PREVIEW_AND_POLICY_APPROVAL_REQUIRED");
    }
    await this.prisma.$transaction([
      this.prisma.channel.update({ where: { id: run.channelId }, data: { status: "ACTIVE" } }),
      this.prisma.automationRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", pausedReason: null, nextRunAt: null } }),
      this.prisma.automationStep.updateMany({ where: { automationRunId: run.id, stage: "PUBLISH" }, data: { status: "CANCELLED", finishedAt: new Date() } })
    ]);
    return { ok: true };
  }

  async list(workspaceId: string, channelId?: string): Promise<AutomationRunResponse[]> {
    const runs = await this.prisma.automationRun.findMany({
      where: { channel: { workspaceId, ...(channelId ? { id: channelId } : {}) } },
      include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } },
      orderBy: { createdAt: "desc" }
    });
    return runs.map((run) => this.toResponse(run));
  }

  async setBudget(workspaceId: string, userId: string, raw: unknown) {
    const input = AutomationBudgetRequestSchema.parse(raw);
    if (input.channelId) {
      const channel = await this.prisma.channel.findFirst({
        where: { id: input.channelId, workspaceId },
        select: { id: true }
      });
      if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND");
    }
    const existing = await this.prisma.automationBudget.findFirst({
      where: { workspaceId, channelId: input.channelId }
    });
    const data = {
      currency: input.currency.toUpperCase(),
      dailySoftLimit: input.dailySoftLimit,
      dailyHardLimit: input.dailyHardLimit,
      monthlySoftLimit: input.monthlySoftLimit,
      monthlyHardLimit: input.monthlyHardLimit
    };
    const budget = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.automationBudget.update({ where: { id: existing.id }, data })
        : await tx.automationBudget.create({ data: { workspaceId, channelId: input.channelId, ...data } });
      await tx.budgetHistory.create({
        data: {
          automationBudgetId: saved.id,
          workspaceId,
          channelId: input.channelId,
          changedByUserId: userId,
          before: existing ? {
            currency: existing.currency,
            dailySoftLimit: existing.dailySoftLimit?.toString() ?? null,
            dailyHardLimit: existing.dailyHardLimit?.toString() ?? null,
            monthlySoftLimit: existing.monthlySoftLimit?.toString() ?? null,
            monthlyHardLimit: existing.monthlyHardLimit?.toString() ?? null
          } : undefined,
          after: {
            currency: saved.currency,
            dailySoftLimit: saved.dailySoftLimit?.toString() ?? null,
            dailyHardLimit: saved.dailyHardLimit?.toString() ?? null,
            monthlySoftLimit: saved.monthlySoftLimit?.toString() ?? null,
            monthlyHardLimit: saved.monthlyHardLimit?.toString() ?? null
          }
        }
      });
      return saved;
    });
    await this.operations.audit(workspaceId, userId, "budget.update", "automation_budget", budget.id, {
      channelId: input.channelId ?? null
    });
    return this.toBudgetResponse(budget);
  }

  async listBudgets(workspaceId: string): Promise<AutomationBudgetResponse[]> {
    const budgets = await this.prisma.automationBudget.findMany({
      where: { workspaceId },
      orderBy: [{ channelId: "asc" }, { updatedAt: "desc" }]
    });
    return budgets.map((budget) => this.toBudgetResponse(budget));
  }

  async setSwitch(workspaceId: string, raw: unknown) {
    const input = AutomationSwitchRequestSchema.parse(raw);
    const existing = await this.prisma.automationSwitch.findFirst({
      where: { workspaceId, provider: input.provider }
    });
    const data = { isEnabled: input.isEnabled, reason: input.reason ?? null };
    return existing
      ? this.prisma.automationSwitch.update({ where: { id: existing.id }, data })
      : this.prisma.automationSwitch.create({ data: { workspaceId, provider: input.provider, ...data } });
  }

  async control(workspaceId: string, runId: string, raw: unknown): Promise<AutomationRunResponse> {
    const input = AutomationControlRequestSchema.parse(raw);
    const run = await this.prisma.automationRun.findFirst({
      where: { id: runId, channel: { workspaceId } },
      include: { steps: true }
    });
    if (!run) throw new NotFoundException("AUTOMATION_RUN_NOT_FOUND");
    if (isTerminal(run.status) && input.action !== "retry") throw new ConflictException("AUTOMATION_RUN_TERMINAL");

    if (input.action === "retry") {
      const recoverable = run.steps.filter((step) =>
        (!input.stage || step.stage === input.stage)
        && (!input.platform || step.platform === input.platform)
        && (step.status === "FAILED" || step.status === "HELD")
      );
      if (recoverable.length === 0) throw new ConflictException("NO_RECOVERABLE_AUTOMATION_STEP");
      await this.prisma.$transaction([
        this.prisma.automationStep.updateMany({
          where: { id: { in: recoverable.map((step) => step.id) } },
          data: { status: "PENDING", errorCode: null, errorMessage: null, finishedAt: null }
        }),
        this.prisma.automationRun.update({
          where: { id: run.id },
          data: {
            status: "QUEUED",
            pausedReason: null,
            nextRunAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null
          }
        }),
        this.prisma.automationEvent.create({
          data: {
            automationRunId: run.id,
            action: "RETRY",
            reason: input.reason,
            details: {
              steps: recoverable.map((step) => ({ stage: step.stage, platform: step.platform }))
            }
          }
        })
      ]);
      await Promise.all(recoverable.map((step) =>
        this.enqueueStage(workspaceId, run.id, run.channelId, step.stage as Stage, step.platform)
      ));
    } else if (input.action === "skip" || input.action === "hold") {
      if (!input.stage) throw new ConflictException("AUTOMATION_STAGE_REQUIRED");
      if (input.action === "skip" && ["POLICY", "PUBLISH"].includes(input.stage)) {
        throw new ConflictException("AUTOMATION_GATE_CANNOT_BE_SKIPPED");
      }
      const matching = run.steps.filter((step) =>
        step.stage === input.stage && (!input.platform || step.platform === input.platform)
      );
      if (matching.length === 0) throw new ConflictException("AUTOMATION_STEP_NOT_FOUND");
      await this.prisma.$transaction([
        this.prisma.automationStep.updateMany({
          where: { id: { in: matching.map((step) => step.id) } },
          data: {
            status: input.action === "skip" ? "SKIPPED" : "HELD",
            errorMessage: input.reason ?? null,
            finishedAt: new Date()
          }
        }),
        this.prisma.automationRun.update({
          where: { id: run.id },
          data: { status: "RUNNING", pausedReason: null, nextRunAt: new Date() }
        }),
        this.prisma.automationEvent.create({
          data: {
            automationRunId: run.id,
            action: "HOLD",
            reason: input.reason,
            details: {
              stage: input.stage,
              platform: input.platform ?? null,
              skipped: input.action === "skip"
            }
          }
        })
      ]);
    } else {
      const status = input.action === "pause"
        ? "PAUSED"
        : input.action === "drain"
          ? "DRAINING"
          : input.action === "kill"
            ? "CANCELLED"
            : "QUEUED";
      const action = input.action === "pause"
        ? "PAUSE"
        : input.action === "drain"
          ? "DRAIN"
          : input.action === "kill"
            ? "KILL"
            : "RESUME";
      await this.prisma.$transaction([
        this.prisma.automationRun.update({
          where: { id: run.id },
          data: {
            status,
            pausedReason: input.action === "resume" ? null : input.reason ?? input.action,
            nextRunAt: input.action === "resume" ? new Date() : null
          }
        }),
        this.prisma.automationStep.updateMany({
          where: { automationRunId: run.id, status: "PENDING" },
          data: { status: input.action === "kill" ? "CANCELLED" : "PENDING" }
        }),
        this.prisma.automationCostReservation.updateMany({
          where: { automationRunId: run.id, releasedAt: null, settledAt: null },
          data: { releasedAt: input.action === "kill" ? new Date() : undefined }
        }),
        this.prisma.automationEvent.create({
          data: { automationRunId: run.id, action, reason: input.reason }
        })
      ]);
    }
    return this.get(workspaceId, run.id);
  }

  private async enqueueStage(
    workspaceId: string,
    runId: string,
    channelId: string,
    stage: Stage,
    platform: BranchPlatform
  ): Promise<void> {
    const step = await this.prisma.automationStep.findFirst({
      where: { automationRunId: runId, stage, branchKey: branchKey(platform) }
    });
    if (!step || ["SUCCEEDED", "CANCELLED", "SKIPPED"].includes(step.status)) return;
    if (stage === "PUBLISH") {
      const run = await this.prisma.automationRun.findUniqueOrThrow({ where: { id: runId }, select: { checkpoint: true } });
      if (asObject(run.checkpoint).sample === true) {
        await this.holdStep(runId, stage, platform, "SAMPLE_REVIEW_REQUIRED");
        return;
      }
    }
    if (step.productionJobId) {
      const existingJob = await this.prisma.productionJob.findUnique({
        where: { id: step.productionJobId },
        select: { status: true }
      });
      if (existingJob && ["FAILED", "NEEDS_REVIEW", "CANCELLED"].includes(existingJob.status)) {
        if (stage === "PUBLISH") {
          const output = asObject(step.output);
          if (typeof output.publishPlanId === "string") {
            await this.prisma.publishPlan.updateMany({
              where: { id: output.publishPlanId, status: "FAILED" },
              data: { status: "SCHEDULED" }
            });
          }
        }
        await this.jobs.recover(workspaceId, step.productionJobId, {});
        await this.prisma.$transaction([
          this.prisma.automationStep.update({
            where: { id: step.id },
            data: { status: "QUEUED", errorCode: null, errorMessage: null, finishedAt: null }
          }),
          this.prisma.automationRun.update({
            where: { id: runId },
            data: { status: "RUNNING", pausedReason: null, heartbeatAt: new Date() }
          })
        ]);
      }
      return;
    }
    if (step.status === "QUEUED") {
      if (!isAbandonedAutomationClaim(step.updatedAt)) return;
      await this.prisma.automationStep.updateMany({
        where: { id: step.id, status: "QUEUED", productionJobId: null },
        data: { status: "PENDING" }
      });
    }
    const claimed = await this.prisma.automationStep.updateMany({
      where: { id: step.id, status: "PENDING", productionJobId: null },
      data: { status: "QUEUED" }
    });
    if (claimed.count === 0) return;
    if (isCostStage(stage)) {
      const reserved = await this.reserveCost(workspaceId, runId, channelId, stage, platform);
      if (!reserved) return;
    }
    const prepared = await this.prepareStage(workspaceId, runId, channelId, stage, platform);
    if (!prepared) return;
    const platformKey = platform?.toLowerCase() ?? "common";
    const job = await this.jobs.create(workspaceId, {
      type: stage,
      channelId,
      contentItemId: prepared.contentItemId,
      idempotencyKey: `automation:${runId}:${platformKey}:${stage.toLowerCase()}`,
      payload: prepared.payload,
      runAfter: prepared.runAfter
    });
    await this.prisma.$transaction([
      this.prisma.automationStep.update({
        where: { id: step.id },
        data: { status: "QUEUED", productionJobId: job.id }
      }),
      this.prisma.automationRun.update({
        where: { id: runId },
        data: { status: "RUNNING", heartbeatAt: new Date(), nextRunAt: null }
      })
    ]);
  }

  private async prepareStage(
    workspaceId: string,
    runId: string,
    channelId: string,
    stage: Stage,
    platform: BranchPlatform
  ): Promise<{ payload: Record<string, unknown>; contentItemId?: string; runAfter?: string } | null> {
    const automation = { runId, stage, platform };
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, workspaceId },
      include: {
        collectionRules: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 },
        templates: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 },
        outputProfiles: { where: { isActive: true }, orderBy: { version: "desc" } },
        scheduleRules: { where: { isActive: true } },
        platformAccounts: {
          where: { status: "CONNECTED" },
          include: { credential: true }
        }
      }
    });
    if (!channel) {
      await this.holdStep(runId, stage, platform, "CHANNEL_NOT_AVAILABLE");
      return null;
    }
    const priorOutput = async (priorStage: Stage, priorPlatform: BranchPlatform): Promise<Record<string, unknown>> => {
      const prior = await this.prisma.automationStep.findFirst({
        where: {
          automationRunId: runId,
          stage: priorStage,
          branchKey: branchKey(priorPlatform)
        },
        select: { output: true }
      });
      return asObject(prior?.output ?? null);
    };

    if (stage === "COLLECT") {
      const rule = channel.collectionRules[0];
      if (!rule) {
        await this.holdStep(runId, stage, null, "COLLECTION_RULE_REQUIRED");
        return null;
      }
      const list = (value: Prisma.JsonValue | null): string[] =>
        Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
      return {
        payload: {
          automation,
          collect: {
            channelId,
            topic: channel.topic ?? channel.name,
            language: channel.language,
            keywords: list(rule.keywords),
            allowedSources: list(rule.allowedSources),
            excludedSources: list(rule.excludedSources),
            excludedKeywords: list(rule.excludedKeywords),
            excludedTopics: list(channel.excludedTopics),
            recencyHours: rule.recencyHours,
            idempotencyKey: `automation:${runId}:collect`
          }
        }
      };
    }

    if (!platform) {
      await this.holdStep(runId, stage, null, "PLATFORM_REQUIRED");
      return null;
    }
    if (stage === "SCRIPT") {
      const run = await this.prisma.automationRun.findUniqueOrThrow({ where: { id: runId }, select: { checkpoint: true } });
      const partial = asObject(run.checkpoint).partial;
      const idea = (await priorOutput("COLLECT", null)).idea;
      if (!idea || typeof idea !== "object" || Array.isArray(idea) || typeof (idea as Record<string, unknown>).id !== "string") {
        await this.holdStep(runId, stage, platform, "COLLECT_OUTPUT_REQUIRED");
        return null;
      }
      return {
        payload: {
          automation,
          generation: {
            request: {
              ideaId: (idea as Record<string, unknown>).id,
              platform,
              idempotencyKey: `automation:${runId}:${platform.toLowerCase()}:script`,
              partial: ["hook", "body", "metadata", "scene"].includes(String(partial)) ? partial : "full"
            },
            idea
          }
        }
      };
    }

    const scriptOutput = await priorOutput("SCRIPT", platform);
    const contentItemId = typeof scriptOutput.contentItemId === "string" ? scriptOutput.contentItemId : null;
    const sceneVersionId = typeof scriptOutput.sceneVersionId === "string" ? scriptOutput.sceneVersionId : null;
    if (!contentItemId) {
      await this.holdStep(runId, stage, platform, "SCRIPT_OUTPUT_REQUIRED");
      return null;
    }
    if (stage === "ASSET") {
      if (!sceneVersionId) {
        await this.holdStep(runId, stage, platform, "SCENE_VERSION_REQUIRED");
        return null;
      }
      const item = await this.prisma.contentItem.findUnique({
        where: { id: contentItemId },
        select: { title: true, summary: true }
      });
      return {
        contentItemId,
        payload: {
          automation,
          assetPreparation: {
            channelId,
            contentItemId,
            sceneVersionId,
            platform,
            prompt: `${item?.title ?? "Short-form explainer"}. ${item?.summary ?? ""}`.trim(),
            idempotencyKey: `automation:${runId}:${platform.toLowerCase()}:asset`
          }
        }
      };
    }
    if (stage === "TTS") {
      if (!sceneVersionId) {
        await this.holdStep(runId, stage, platform, "SCENE_VERSION_REQUIRED");
        return null;
      }
      const script = await this.prisma.scriptVersion.findFirst({
        where: { contentItemId, platform },
        orderBy: { version: "desc" }
      });
      if (!script) {
        await this.holdStep(runId, stage, platform, "SCRIPT_VERSION_REQUIRED");
        return null;
      }
      return {
        contentItemId,
        payload: {
          automation,
          ttsPreparation: {
            channelId,
            contentItemId,
            sceneVersionId,
            platform,
            text: [script.hook, script.body, script.callToAction].filter(Boolean).join(" "),
            voice: channel.templates[0]?.voiceProfile ?? "default",
            idempotencyKey: `automation:${runId}:${platform.toLowerCase()}:tts`
          }
        }
      };
    }
    if (stage === "RENDER") {
      if (!sceneVersionId) {
        await this.holdStep(runId, stage, platform, "SCENE_VERSION_REQUIRED");
        return null;
      }
      return {
        contentItemId,
        payload: {
          automation,
          render: {
            channelId,
            contentItemId,
            sceneVersionId,
            idempotencyKey: `automation:${runId}:${platform.toLowerCase()}:render`
          }
        }
      };
    }
    if (stage === "POLICY") {
      return {
        contentItemId,
        payload: {
          automation,
          policy: { contentItemId, platform, region: "GLOBAL" }
        }
      };
    }

    const [item, policyCheck, scene, sourceCount, usages, script] = await Promise.all([
      this.prisma.contentItem.findUnique({ where: { id: contentItemId } }),
      this.prisma.policyCheck.findFirst({
        where: { contentItemId, platform },
        orderBy: { checkedAt: "desc" },
        include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } }
      }),
      this.prisma.sceneVersion.findFirst({
        where: { contentItemId, platform },
        orderBy: { version: "desc" }
      }),
      this.prisma.sourceReference.count({ where: { contentItemId } }),
      this.prisma.assetUsage.findMany({
        where: { contentItemId, sceneVersionId },
        include: { asset: { include: { licenses: { orderBy: { checkedAt: "desc" }, take: 1 } } } }
      }),
      this.prisma.scriptVersion.findFirst({ where: { contentItemId, platform }, orderBy: { version: "desc" } })
    ]);
    if (!item || !script || asObject(script.qualitySnapshot).reviewStatus !== "APPROVED") {
      await this.holdStep(
        runId,
        stage,
        platform,
        channel.automationMode === "APPROVAL" ? "AWAITING_APPROVAL" : "AUTO_APPROVAL_GATE_FAILED"
      );
      return null;
    }
    const rightsVerified = usages.length > 0 && usages.every((usage) =>
      usage.asset.licenses[0]?.status === "VERIFIED"
      && usage.asset.licenses[0]?.commercialUseAllowed === true
    );
    if (policyCheck?.status !== "PASS" || !script || policyCheck.checkedAt < script.createdAt || !scene || policyCheck.checkedAt < scene.createdAt || sourceCount === 0 || !rightsVerified || !scene.renderManifest) {
      await this.holdStep(runId, stage, platform, "PUBLISH_SAFETY_GATE_FAILED");
      return null;
    }
    const account = channel.platformAccounts.find((candidate) => candidate.platform === platform);
    if (!account) {
      await this.holdStep(runId, stage, platform, "CONNECTED_PLATFORM_ACCOUNT_REQUIRED");
      return null;
    }
    const rules = channel.scheduleRules.filter((rule) => rule.platform === null || rule.platform === platform);
    const timezone = rules[0]?.timezone ?? "Asia/Seoul";
    const occupiedPlans = await this.prisma.publishPlan.findMany({ where: { platform, contentItem: { channelId: channel.id }, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] }, scheduledAt: { gte: new Date(Date.now() - 48 * 3_600_000) } }, select: { scheduledAt: true, platformAccountId: true } });
    let scheduledAt = this.nextSchedule(rules, new Date());
    for (let attempt = 0; scheduledAt && attempt < 32; attempt += 1) {
      const candidate = scheduledAt;
      const occupied = occupiedPlans.some((plan) => plan.platformAccountId === account.id && plan.scheduledAt.getTime() === candidate.getTime());
      const dayCount = occupiedPlans.filter((plan) => localPublishDay(plan.scheduledAt, timezone) === localPublishDay(candidate, timezone)).length;
      if (!occupied && dayCount < channel.dailyPublishLimit) break;
      scheduledAt = attempt === 31 ? null : this.nextSchedule(rules, candidate);
    }
    if (!scheduledAt) {
      await this.holdStep(runId, stage, platform, "SCHEDULE_SLOT_REQUIRED");
      return null;
    }
    const idempotencyKey = `automation:${runId}:publish-plan:${platform.toLowerCase()}`;
    let plan = await this.prisma.publishPlan.findUnique({ where: { idempotencyKey } });
    if (!plan) {
      const snapshot = asObject(script.qualitySnapshot);
      const metadata = asObject(snapshot.metadata ?? null);
      const title = typeof snapshot.reviewTitle === "string" ? snapshot.reviewTitle : item.title;
      const description = typeof metadata.description === "string" ? metadata.description : item.summary;
      const hashtags = Array.isArray(metadata.hashtags) ? metadata.hashtags.filter((tag): tag is string => typeof tag === "string") : [];
      try {
        plan = await createScheduledPlan(this.prisma, channel.id, timezone, channel.dailyPublishLimit, {
          contentItemId,
          platform,
          platformAccountId: account.id,
          sceneVersionId: scene.id,
          policySnapshotId: policyCheck.snapshots[0]?.id,
          status: "SCHEDULED",
          scheduledAt,
          idempotencyKey,
          title,
          description,
          hashtags
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        await this.holdStep(runId, stage, platform, "SCHEDULE_CONFLICT_RETRY_REQUIRED");
        return null;
      }
    }
    if (item.status !== "PUBLISHED") {
      await this.prisma.contentItem.update({
        where: { id: contentItemId },
        data: { status: "SCHEDULED" }
      });
    }
    return {
      contentItemId,
      runAfter: plan.scheduledAt.toISOString(),
      payload: { automation, publish: { publishPlanId: plan.id } }
    };
  }

  private nextSchedule(rules: Array<{ dayOfWeek: number; timeOfDayUtc: string; timezone?: string }>, after: Date): Date | null {
    return nextZonedSchedule(rules, after);
  }

  private async reserveCost(
    workspaceId: string,
    runId: string,
    channelId: string,
    stage: Stage,
    platform: BranchPlatform
  ): Promise<boolean> {
    if (!platform || !isCostStage(stage)) return true;
    const estimateDetails = await this.estimateCost(runId, channelId, stage, platform);
    const estimate = estimateDetails?.amountUsd ?? null;
    const budget = await this.prisma.automationBudget.findFirst({
      where: { workspaceId, OR: [{ channelId }, { channelId: null }] },
      orderBy: { channelId: "desc" }
    });
    if (!budget || estimate === null) {
      const reason = budget ? "COST_PRICING_REQUIRED" : "AUTOMATION_BUDGET_REQUIRED";
      await this.holdStep(runId, stage, platform, reason);
      await this.operations.notify(workspaceId, {
        eventKey: budget ? "cost.pricing_required" : "budget.configuration_required",
        severity: "WARNING",
        channelId,
        cooldownMinutes: 30,
        payload: { automationRunId: runId, stage, platform, action: budget ? "configure_provider_pricing" : "configure_budget" }
      });
      return false;
    }
    const costStage = stage as "SCRIPT" | "ASSET" | "TTS" | "RENDER";
    const result = await reserveAutomationCost({
      prisma: this.prisma,
      budget,
      runId,
      stage: costStage,
      platform,
      estimate
    });
    if (result === "HARD_LIMIT" || result === "UNATTRIBUTED_COST") {
      const reason = result === "HARD_LIMIT" ? "BUDGET_HARD_LIMIT" : "BUDGET_UNATTRIBUTED_COST";
      await this.holdStep(runId, stage, platform, reason);
      await this.operations.notify(workspaceId, {
        eventKey: result === "HARD_LIMIT" ? "budget.hard_limit" : "budget.unattributed_cost",
        severity: "CRITICAL",
        channelId,
        cooldownMinutes: 30,
        payload: { automationRunId: runId, stage, platform }
      });
      return false;
    }
    return true;
  }

  private async estimateCost(
    runId: string,
    channelId: string,
    stage: Stage,
    platform: BranchPlatform
  ) {
    if (!platform || !isCostStage(stage)) return null;
    const usage: AutomationCostUsage = {};
    if (stage !== "SCRIPT") {
      const scriptStep = await this.prisma.automationStep.findFirst({
        where: { automationRunId: runId, stage: "SCRIPT", branchKey: platform },
        select: { output: true }
      });
      const output = asObject(scriptStep?.output ?? null);
      const contentItemId = typeof output.contentItemId === "string" ? output.contentItemId : null;
      const sceneVersionId = typeof output.sceneVersionId === "string" ? output.sceneVersionId : null;
      if (!contentItemId || !sceneVersionId) return null;
      if (stage === "ASSET" || stage === "RENDER") {
        const scene = await this.prisma.sceneVersion.findFirst({ where: { id: sceneVersionId, contentItemId, platform } });
        const document = asObject(scene?.sceneDocument ?? null);
        const scenes = Array.isArray(document.scenes) ? document.scenes : [];
        if (stage === "ASSET") usage.imageCount = Math.round(scenes.length * (typeof document.aiStockRatio === "number" ? document.aiStockRatio : 1));
        else {
          const frames = typeof document.durationInFrames === "number" ? document.durationInFrames : 0;
          const fps = typeof document.fps === "number" ? document.fps : 0;
          usage.durationSeconds = fps > 0 ? frames / fps : 0;
        }
      } else if (stage === "TTS") {
        const script = await this.prisma.scriptVersion.findFirst({ where: { contentItemId, platform }, orderBy: { version: "desc" } });
        usage.characters = script ? [script.hook, script.body, script.callToAction].filter(Boolean).join(" ").length : 0;
      }
    }
    const estimate = estimateAutomationStageCost(loadConfig(), stage as "SCRIPT" | "ASSET" | "TTS" | "RENDER", usage);
    if (estimate) {
      const run = await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { checkpoint: true } });
      const checkpoint = asObject(run?.checkpoint ?? null);
      const estimates = asObject(checkpoint.estimates ?? null);
      await this.prisma.automationRun.update({
        where: { id: runId },
        data: { checkpoint: { ...checkpoint, estimates: { ...estimates, [`${platform}:${stage}`]: estimate } } as Prisma.InputJsonObject }
      });
    }
    return estimate;
  }

  private toBudgetResponse(budget: {
    id: string; channelId: string | null; currency: string;
    dailySoftLimit: Prisma.Decimal | null; dailyHardLimit: Prisma.Decimal | null;
    monthlySoftLimit: Prisma.Decimal | null; monthlyHardLimit: Prisma.Decimal | null; updatedAt: Date;
  }): AutomationBudgetResponse {
    return {
      id: budget.id,
      channelId: budget.channelId,
      currency: budget.currency,
      dailySoftLimit: decimalNumber(budget.dailySoftLimit),
      dailyHardLimit: decimalNumber(budget.dailyHardLimit),
      monthlySoftLimit: decimalNumber(budget.monthlySoftLimit),
      monthlyHardLimit: decimalNumber(budget.monthlyHardLimit),
      updatedAt: budget.updatedAt.toISOString()
    };
  }

  private async holdStep(
    runId: string,
    stage: Stage,
    platform: BranchPlatform,
    reason: string
  ): Promise<void> {
    const step = await this.prisma.automationStep.findFirst({
      where: { automationRunId: runId, stage, branchKey: branchKey(platform) },
      select: { id: true }
    });
    if (!step) return;
    await this.prisma.$transaction([
      this.prisma.automationStep.update({
        where: { id: step.id },
        data: {
          status: "HELD",
          errorCode: reason,
          errorMessage: reason,
          finishedAt: new Date()
        }
      }),
      this.prisma.automationRun.update({
        where: { id: runId },
        data: { status: "RUNNING", pausedReason: null, nextRunAt: new Date() }
      }),
      this.prisma.automationEvent.create({
        data: {
          automationRunId: runId,
          action: "HOLD",
          reason,
          details: { stage, platform }
        }
      })
    ]);
  }

  private async scheduleDueRuns(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
    const now = new Date();
    const channels = await this.prisma.channel.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        workspaceId: true,
        collectionRules: {
          where: { isActive: true },
          orderBy: { version: "desc" },
          take: 1
        }
      }
    });
    await Promise.all(channels.map(async (channel) => {
      const rule = channel.collectionRules[0];
      if (!rule) return;
      const intervalMs = rule.collectionFrequencyMinutes * 60_000;
      const bucket = Math.floor(now.getTime() / intervalMs);
      try {
        await this.start(channel.workspaceId, {
          channelId: channel.id,
          idempotencyKey: `scheduler:${channel.id}:${bucket}`
        });
      } catch {
        // A channel failure must not prevent scheduling independent channels.
      }
    }));
    const activeRuns = await this.prisma.automationRun.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
      include: {
        steps: true,
        channel: { select: { workspaceId: true } }
      }
    });
    for (const run of activeRuns) {
      try {
        await this.resumeNextStep(run);
      } catch {
        // A transient/deadlock failure is retried on the next scheduler tick.
      }
    }
    } finally {
      this.scheduling = false;
    }
  }

  private async resumeNextStep(run: {
    id: string;
    channelId: string;
    status: string;
    channel: { workspaceId: string };
    steps: Array<{ id: string; stage: string; platform: Platform | null; status: string; errorCode: string | null }>;
  }): Promise<void> {
    const decision = evaluateAutomationBranches(run.steps);
    if (decision.status !== "RUNNING") {
      const failure = run.steps.find((step) => step.status === "FAILED");
      const held = run.steps.find((step) => step.status === "HELD");
      await this.prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: decision.status,
          pausedReason: decision.status === "PAUSED" ? held?.errorCode ?? "BRANCH_HELD" : null,
          lastErrorCode: decision.status === "FAILED" ? failure?.errorCode ?? "BRANCH_FAILED" : null,
          nextRunAt: null
        }
      });
      return;
    }
    for (const { stage, platform } of decision.runnable) {
      await this.enqueueStage(run.channel.workspaceId, run.id, run.channelId, stage, platform);
    }
  }

  private toResponse(run: {
    id: string;
    createdAt?: Date;
    updatedAt?: Date;
    channelId: string;
    status: string;
    idempotencyKey: string;
    checkpoint: Prisma.JsonValue | null;
    failureCount: number;
    pausedReason: string | null;
    nextRunAt: Date | null;
    heartbeatAt: Date | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    steps: Array<{
      stage: string;
      platform: Platform | null;
      status: string;
      attemptCount: number;
      maxAttempts: number;
      productionJobId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
  }): AutomationRunResponse {
    return AutomationRunResponseSchema.parse({
      id: run.id,
      createdAt: run.createdAt?.toISOString(),
      finishedAt: ["SUCCEEDED", "CANCELLED"].includes(run.status) ? run.updatedAt?.toISOString() ?? null : null,
      channelId: run.channelId,
      status: run.status,
      idempotencyKey: run.idempotencyKey,
      checkpoint: run.checkpoint,
      failureCount: run.failureCount,
      pausedReason: run.pausedReason,
      nextRunAt: run.nextRunAt?.toISOString() ?? null,
      heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
      lastErrorCode: run.lastErrorCode,
      lastErrorMessage: run.lastErrorMessage,
      steps: run.steps
    });
  }
}
