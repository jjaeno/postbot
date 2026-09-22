import { ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AutomationBudgetRequestSchema, AutomationControlRequestSchema, AutomationRunRequestSchema, AutomationRunResponseSchema, AutomationSwitchRequestSchema, type AutomationRunResponse, type AutomationStage } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { JobsService } from "../jobs/jobs.service.js";
import { evaluateBudget, isCostStage } from "./automation-safety.js";

export const automationStages = ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH"] as const satisfies readonly AutomationStage[];
type Stage = (typeof automationStages)[number];
export const inventoryDeficit = (minimum: number, generating: number, review: number, approved: number, scheduled: number): number => Math.max(0, minimum - (generating + review + approved + scheduled));
const isTerminal = (status: string): boolean => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private scheduler: NodeJS.Timeout | null = null;

  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly jobs: JobsService) {}

  onModuleInit(): void {
    this.scheduler = setInterval(() => void this.scheduleDueRuns(), 60_000);
    void this.scheduleDueRuns();
  }

  onModuleDestroy(): void {
    if (this.scheduler) clearInterval(this.scheduler);
  }

  async start(workspaceId: string, raw: unknown): Promise<AutomationRunResponse> {
    const input = AutomationRunRequestSchema.parse(raw);
    const workspaceSwitch = await this.prisma.automationSwitch.findFirst({ where: { workspaceId, provider: null, isEnabled: false } });
    if (workspaceSwitch) throw new ConflictException("AUTOMATION_KILL_SWITCH_ENABLED");
    const existing = await this.prisma.automationRun.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { steps: { orderBy: { createdAt: "asc" } } } });
    if (existing) return this.toResponse(existing);
    const channel = await this.prisma.channel.findFirst({ where: { id: input.channelId, workspaceId, status: "ACTIVE" }, include: { platformAccounts: true, scheduleRules: { where: { isActive: true } } } });
    if (!channel) throw new NotFoundException("ACTIVE_CHANNEL_NOT_FOUND");
    const counts = await this.prisma.contentItem.groupBy({ by: ["status"], where: { channelId: channel.id }, _count: { _all: true } });
    const count = (status: "GENERATING" | "REVIEW_REQUIRED" | "APPROVED" | "SCHEDULED"): number => counts.find((entry) => entry.status === status)?._count._all ?? 0;
    const deficit = inventoryDeficit(channel.minInventoryCount, count("GENERATING"), count("REVIEW_REQUIRED"), count("APPROVED"), count("SCHEDULED"));
    const heldReason = channel.automationMode === "FULL_AUTO" && (!channel.platformAccounts.some((account) => account.status === "CONNECTED") || channel.scheduleRules.length === 0) ? "NO_CONNECTED_ACCOUNT_OR_SCHEDULE" : null;
    const run = await this.prisma.$transaction((tx) => tx.automationRun.create({
      data: { channelId: channel.id, idempotencyKey: input.idempotencyKey, status: deficit === 0 ? "SUCCEEDED" : heldReason ? "PAUSED" : "QUEUED", pausedReason: heldReason, checkpoint: { stage: deficit === 0 ? "inventory-satisfied" : "collect", deficit, completed: [], estimatedCostsUsd: input.estimatedCostsUsd ?? {} }, nextRunAt: deficit === 0 || heldReason ? null : new Date(), steps: { create: automationStages.map((stage) => ({ stage, status: deficit === 0 ? "SKIPPED" : heldReason ? "HELD" : "PENDING" })) }, events: { create: { action: "START", details: { deficit, mode: channel.automationMode } } } },
      include: { steps: { orderBy: { createdAt: "asc" } } }
    }));
    if (deficit > 0 && !heldReason) await this.enqueueStage(workspaceId, run.id, channel.id, "COLLECT");
    return this.get(workspaceId, run.id);
  }

  async get(workspaceId: string, runId: string): Promise<AutomationRunResponse> {
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, channel: { workspaceId } }, include: { steps: { orderBy: { createdAt: "asc" } } } });
    if (!run) throw new NotFoundException("AUTOMATION_RUN_NOT_FOUND");
    return this.toResponse(run);
  }

  async list(workspaceId: string, channelId?: string): Promise<AutomationRunResponse[]> {
    const runs = await this.prisma.automationRun.findMany({ where: { channel: { workspaceId, ...(channelId ? { id: channelId } : {}) } }, include: { steps: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } });
    return runs.map((run) => this.toResponse(run));
  }

  async setBudget(workspaceId: string, raw: unknown) {
    const input = AutomationBudgetRequestSchema.parse(raw);
    if (input.channelId) {
      const channel = await this.prisma.channel.findFirst({ where: { id: input.channelId, workspaceId }, select: { id: true } });
      if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND");
    }
    const existing = await this.prisma.automationBudget.findFirst({ where: { workspaceId, channelId: input.channelId } });
    const data = { currency: input.currency.toUpperCase(), dailySoftLimit: input.dailySoftLimit, dailyHardLimit: input.dailyHardLimit, monthlySoftLimit: input.monthlySoftLimit, monthlyHardLimit: input.monthlyHardLimit };
    return existing ? this.prisma.automationBudget.update({ where: { id: existing.id }, data }) : this.prisma.automationBudget.create({ data: { workspaceId, channelId: input.channelId, ...data } });
  }

  async setSwitch(workspaceId: string, raw: unknown) {
    const input = AutomationSwitchRequestSchema.parse(raw);
    const existing = await this.prisma.automationSwitch.findFirst({ where: { workspaceId, provider: input.provider } });
    const data = { isEnabled: input.isEnabled, reason: input.reason ?? null };
    return existing ? this.prisma.automationSwitch.update({ where: { id: existing.id }, data }) : this.prisma.automationSwitch.create({ data: { workspaceId, provider: input.provider, ...data } });
  }

  async control(workspaceId: string, runId: string, raw: unknown): Promise<AutomationRunResponse> {
    const input = AutomationControlRequestSchema.parse(raw);
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, channel: { workspaceId } }, include: { steps: true } });
    if (!run) throw new NotFoundException("AUTOMATION_RUN_NOT_FOUND");
    if (isTerminal(run.status) && input.action !== "retry") throw new ConflictException("AUTOMATION_RUN_TERMINAL");
    const stage = input.stage;
    if (input.action === "retry") {
      const step = stage ? run.steps.find((item) => item.stage === stage) : run.steps.find((item) => item.status === "FAILED" || item.status === "HELD");
      if (!step) throw new ConflictException("NO_RECOVERABLE_AUTOMATION_STEP");
      await this.prisma.$transaction([this.prisma.automationStep.update({ where: { id: step.id }, data: { status: "PENDING", errorCode: null, errorMessage: null, finishedAt: null } }), this.prisma.automationRun.update({ where: { id: run.id }, data: { status: "QUEUED", pausedReason: null, nextRunAt: new Date(), lastErrorCode: null, lastErrorMessage: null } }), this.prisma.automationEvent.create({ data: { automationRunId: run.id, action: "RETRY", reason: input.reason, details: { stage: step.stage } } })]);
      await this.enqueueStage(workspaceId, run.id, run.channelId, step.stage as Stage);
    } else if (input.action === "skip" || input.action === "hold") {
      if (!stage) throw new ConflictException("AUTOMATION_STAGE_REQUIRED");
      await this.prisma.$transaction([this.prisma.automationStep.update({ where: { automationRunId_stage: { automationRunId: run.id, stage } }, data: { status: input.action === "skip" ? "SKIPPED" : "HELD", errorMessage: input.reason ?? null, finishedAt: new Date() } }), this.prisma.automationRun.update({ where: { id: run.id }, data: { status: input.action === "skip" ? "RUNNING" : "PAUSED", pausedReason: input.action === "hold" ? input.reason ?? "operator hold" : null } }), this.prisma.automationEvent.create({ data: { automationRunId: run.id, action: "HOLD", reason: input.reason, details: { stage, skipped: input.action === "skip" } } })]);
    } else {
      const status = input.action === "pause" ? "PAUSED" : input.action === "drain" ? "DRAINING" : input.action === "kill" ? "CANCELLED" : "QUEUED";
      const action = input.action === "pause" ? "PAUSE" : input.action === "drain" ? "DRAIN" : input.action === "kill" ? "KILL" : "RESUME";
      await this.prisma.$transaction([this.prisma.automationRun.update({ where: { id: run.id }, data: { status, pausedReason: input.action === "resume" ? null : input.reason ?? input.action, nextRunAt: input.action === "resume" ? new Date() : null } }), this.prisma.automationStep.updateMany({ where: { automationRunId: run.id, status: "PENDING" }, data: { status: input.action === "kill" ? "CANCELLED" : "PENDING" } }), this.prisma.automationCostReservation.updateMany({ where: { automationRunId: run.id, releasedAt: null, settledAt: null }, data: { releasedAt: input.action === "kill" ? new Date() : undefined } }), this.prisma.automationEvent.create({ data: { automationRunId: run.id, action, reason: input.reason } })]);
    }
    return this.get(workspaceId, run.id);
  }

  private async enqueueStage(workspaceId: string, runId: string, channelId: string, stage: Stage): Promise<void> {
    const step = await this.prisma.automationStep.findUnique({ where: { automationRunId_stage: { automationRunId: runId, stage } } });
    if (!step || ["SUCCEEDED", "CANCELLED", "SKIPPED"].includes(step.status)) return;
    if (isCostStage(stage)) {
      const reserved = await this.reserveCost(workspaceId, runId, channelId, stage);
      if (!reserved) return;
    }
    const job = await this.jobs.create(workspaceId, { type: stage, channelId, idempotencyKey: `automation:${runId}:${stage.toLowerCase()}`, payload: { automation: { runId, stage } } });
    await this.prisma.$transaction([this.prisma.automationStep.update({ where: { id: step.id }, data: { status: "QUEUED", productionJobId: job.id } }), this.prisma.automationRun.update({ where: { id: runId }, data: { status: "RUNNING", heartbeatAt: new Date(), nextRunAt: null } })]);
  }

  private async reserveCost(workspaceId: string, runId: string, channelId: string, stage: Stage): Promise<boolean> {
    const run = await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { checkpoint: true } });
    const estimates = run?.checkpoint && typeof run.checkpoint === "object" && !Array.isArray(run.checkpoint) ? (run.checkpoint as Record<string, unknown>).estimatedCostsUsd : null;
    const value = estimates && typeof estimates === "object" && !Array.isArray(estimates) ? (estimates as Record<string, unknown>)[stage] : null;
    const estimate = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    const reservationKey = `automation:${runId}:${stage.toLowerCase()}:cost`;
    const budget = await this.prisma.automationBudget.findFirst({ where: { workspaceId, OR: [{ channelId }, { channelId: null }] }, orderBy: { channelId: "desc" } });
    if (!budget || estimate === null) {
      await this.holdStep(runId, stage, "COST_ESTIMATE_OR_BUDGET_REQUIRED");
      return false;
    }
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1));
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.automationCostReservation.findUnique({ where: { idempotencyKey: reservationKey } });
      if (existing) return true;
      const [daily, monthly, reserved] = await Promise.all([
        tx.costLedger.aggregate({ where: { occurredAt: { gte: dayStart } }, _sum: { amount: true } }),
        tx.costLedger.aggregate({ where: { occurredAt: { gte: monthStart } }, _sum: { amount: true } }),
        tx.automationCostReservation.aggregate({ where: { automationRun: { channel: { workspaceId } }, releasedAt: null, settledAt: null }, _sum: { amount: true } })
      ]);
      const reservedAmount = Number(reserved._sum.amount?.toString() ?? "0");
      const dailyDecision = evaluateBudget({ spent: Number(daily._sum.amount?.toString() ?? "0"), reserved: reservedAmount, softLimit: budget.dailySoftLimit ? Number(budget.dailySoftLimit) : null, hardLimit: budget.dailyHardLimit ? Number(budget.dailyHardLimit) : null }, estimate);
      const monthlyDecision = evaluateBudget({ spent: Number(monthly._sum.amount?.toString() ?? "0"), reserved: reservedAmount, softLimit: budget.monthlySoftLimit ? Number(budget.monthlySoftLimit) : null, hardLimit: budget.monthlyHardLimit ? Number(budget.monthlyHardLimit) : null }, estimate);
      if (dailyDecision === "HOLD" || monthlyDecision === "HOLD") return false;
      await tx.automationCostReservation.create({ data: { automationRunId: runId, stage, idempotencyKey: reservationKey, amount: new Prisma.Decimal(estimate.toFixed(6)), currency: budget.currency } });
      await tx.automationRun.update({ where: { id: runId }, data: { budgetReserved: { increment: new Prisma.Decimal(estimate.toFixed(6)) } } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) await this.holdStep(runId, stage, "BUDGET_HARD_LIMIT");
    return result;
  }

  private async holdStep(runId: string, stage: Stage, reason: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.automationStep.update({ where: { automationRunId_stage: { automationRunId: runId, stage } }, data: { status: "HELD", errorCode: reason, errorMessage: reason, finishedAt: new Date() } }),
      this.prisma.automationRun.update({ where: { id: runId }, data: { status: "PAUSED", pausedReason: reason } }),
      this.prisma.automationEvent.create({ data: { automationRunId: runId, action: "HOLD", reason, details: { stage } } })
    ]);
  }

  private async scheduleDueRuns(): Promise<void> {
    const now = new Date();
    const channels = await this.prisma.channel.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, workspaceId: true, collectionRules: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 } }
    });
    await Promise.all(channels.map(async (channel) => {
      const rule = channel.collectionRules[0];
      if (!rule) return;
      const intervalMs = rule.collectionFrequencyMinutes * 60_000;
      const bucket = Math.floor(now.getTime() / intervalMs);
      try {
        await this.start(channel.workspaceId, { channelId: channel.id, idempotencyKey: `scheduler:${channel.id}:${bucket}` });
      } catch {
        // A channel failure must not prevent scheduling independent channels.
      }
    }));
    const activeRuns = await this.prisma.automationRun.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
      include: { steps: true, channel: { select: { workspaceId: true } } }
    });
    await Promise.all(activeRuns.map((run) => this.resumeNextStep(run)));
  }

  private async resumeNextStep(run: { id: string; channelId: string; status: string; channel: { workspaceId: string }; steps: Array<{ stage: string; status: string }> }): Promise<void> {
    const completed = run.steps.every((step) => step.status === "SUCCEEDED" || step.status === "SKIPPED");
    if (completed) {
      await this.prisma.automationRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", nextRunAt: null } });
      return;
    }
    const next = automationStages.find((stage, index) => run.steps.find((step) => step.stage === stage)?.status === "PENDING" && (index === 0 || run.steps.find((step) => step.stage === automationStages[index - 1])?.status === "SUCCEEDED"));
    if (next) await this.enqueueStage(run.channel.workspaceId, run.id, run.channelId, next);
  }

  private toResponse(run: { id: string; channelId: string; status: string; idempotencyKey: string; checkpoint: Prisma.JsonValue | null; failureCount: number; nextRunAt: Date | null; heartbeatAt: Date | null; lastErrorCode: string | null; lastErrorMessage: string | null; steps: Array<{ stage: string; status: string; attemptCount: number; maxAttempts: number; productionJobId: string | null; errorCode: string | null; errorMessage: string | null }> }): AutomationRunResponse {
    return AutomationRunResponseSchema.parse({ id: run.id, channelId: run.channelId, status: run.status, idempotencyKey: run.idempotencyKey, checkpoint: run.checkpoint, failureCount: run.failureCount, nextRunAt: run.nextRunAt?.toISOString() ?? null, heartbeatAt: run.heartbeatAt?.toISOString() ?? null, lastErrorCode: run.lastErrorCode, lastErrorMessage: run.lastErrorMessage, steps: run.steps });
  }
}
