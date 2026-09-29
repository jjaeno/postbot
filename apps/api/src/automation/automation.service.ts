import { ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AutomationBudgetRequestSchema, AutomationControlRequestSchema, AutomationRunRequestSchema, AutomationRunResponseSchema, AutomationSwitchRequestSchema, type AutomationRunResponse, type AutomationStage } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { JobsService } from "../jobs/jobs.service.js";
import { evaluateBudget, isCostStage } from "./automation-safety.js";
import { OperationsService } from "../operations/operations.service.js";
import { loadConfig } from "@postbot/config";

export const automationStages = ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH"] as const satisfies readonly AutomationStage[];
type Stage = (typeof automationStages)[number];
export const inventoryDeficit = (minimum: number, generating: number, review: number, approved: number, scheduled: number): number => Math.max(0, minimum - (generating + review + approved + scheduled));
const isTerminal = (status: string): boolean => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private scheduler: NodeJS.Timeout | null = null;

  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly jobs: JobsService, private readonly operations: OperationsService) {}

  onModuleInit(): void {
    this.scheduler = setInterval(() => void this.scheduleDueRuns(), loadConfig().AUTOMATION_POLL_INTERVAL_MS);
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

  async setBudget(workspaceId: string, userId: string, raw: unknown) {
    const input = AutomationBudgetRequestSchema.parse(raw);
    if (input.channelId) {
      const channel = await this.prisma.channel.findFirst({ where: { id: input.channelId, workspaceId }, select: { id: true } });
      if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND");
    }
    const existing = await this.prisma.automationBudget.findFirst({ where: { workspaceId, channelId: input.channelId } });
    const data = { currency: input.currency.toUpperCase(), dailySoftLimit: input.dailySoftLimit, dailyHardLimit: input.dailyHardLimit, monthlySoftLimit: input.monthlySoftLimit, monthlyHardLimit: input.monthlyHardLimit };
    const budget = await this.prisma.$transaction(async (tx) => {
      const saved = existing ? await tx.automationBudget.update({ where: { id: existing.id }, data }) : await tx.automationBudget.create({ data: { workspaceId, channelId: input.channelId, ...data } });
      await tx.budgetHistory.create({ data: { automationBudgetId: saved.id, workspaceId, channelId: input.channelId, changedByUserId: userId, before: existing ? { currency: existing.currency, dailySoftLimit: existing.dailySoftLimit?.toString() ?? null, dailyHardLimit: existing.dailyHardLimit?.toString() ?? null, monthlySoftLimit: existing.monthlySoftLimit?.toString() ?? null, monthlyHardLimit: existing.monthlyHardLimit?.toString() ?? null } : undefined, after: { currency: saved.currency, dailySoftLimit: saved.dailySoftLimit?.toString() ?? null, dailyHardLimit: saved.dailyHardLimit?.toString() ?? null, monthlySoftLimit: saved.monthlySoftLimit?.toString() ?? null, monthlyHardLimit: saved.monthlyHardLimit?.toString() ?? null } } });
      return saved;
    });
    await this.operations.audit(workspaceId, userId, "budget.update", "automation_budget", budget.id, { channelId: input.channelId ?? null });
    return budget;
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
      if (input.action === "skip" && ["POLICY", "PUBLISH"].includes(stage)) throw new ConflictException("AUTOMATION_GATE_CANNOT_BE_SKIPPED");
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
    if (step.productionJobId) {
      const existingJob = await this.prisma.productionJob.findUnique({ where: { id: step.productionJobId }, select: { status: true } });
      if (existingJob && ["FAILED", "NEEDS_REVIEW", "CANCELLED"].includes(existingJob.status)) {
        await this.jobs.recover(workspaceId, step.productionJobId, {});
        await this.prisma.$transaction([this.prisma.automationStep.update({ where: { id: step.id }, data: { status: "QUEUED", errorCode: null, errorMessage: null, finishedAt: null } }), this.prisma.automationRun.update({ where: { id: runId }, data: { status: "RUNNING", pausedReason: null, heartbeatAt: new Date() } })]);
      }
      return;
    }
    if (isCostStage(stage)) {
      const reserved = await this.reserveCost(workspaceId, runId, channelId, stage);
      if (!reserved) return;
    }
    const prepared = await this.prepareStage(workspaceId, runId, channelId, stage);
    if (!prepared) return;
    const job = await this.jobs.create(workspaceId, { type: stage, channelId, contentItemId: prepared.contentItemId, idempotencyKey: `automation:${runId}:${stage.toLowerCase()}`, payload: prepared.payload, runAfter: prepared.runAfter });
    await this.prisma.$transaction([this.prisma.automationStep.update({ where: { id: step.id }, data: { status: "QUEUED", productionJobId: job.id } }), this.prisma.automationRun.update({ where: { id: runId }, data: { status: "RUNNING", heartbeatAt: new Date(), nextRunAt: null } })]);
  }

  private async prepareStage(workspaceId: string, runId: string, channelId: string, stage: Stage): Promise<{ payload: Record<string, unknown>; contentItemId?: string; runAfter?: string } | null> {
    const automation = { runId, stage };
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId }, include: { collectionRules: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 }, templates: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 }, outputProfiles: { where: { isActive: true }, orderBy: { version: "desc" } }, scheduleRules: { where: { isActive: true } }, platformAccounts: { where: { status: "CONNECTED" }, include: { credential: true } } } });
    if (!channel) { await this.holdStep(runId, stage, "CHANNEL_NOT_AVAILABLE"); return null; }
    const priorOutput = async (priorStage: Stage): Promise<Record<string, unknown>> => {
      const prior = await this.prisma.automationStep.findUnique({ where: { automationRunId_stage: { automationRunId: runId, stage: priorStage } }, select: { output: true } });
      return prior?.output && typeof prior.output === "object" && !Array.isArray(prior.output) ? prior.output : {};
    };
    if (stage === "COLLECT") {
      const rule = channel.collectionRules[0];
      if (!rule) { await this.holdStep(runId, stage, "COLLECTION_RULE_REQUIRED"); return null; }
      const list = (value: Prisma.JsonValue | null): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
      return { payload: { automation, collect: { channelId, topic: channel.topic ?? channel.name, language: channel.language, keywords: list(rule.keywords), allowedSources: list(rule.allowedSources), excludedSources: list(rule.excludedSources), excludedKeywords: list(rule.excludedKeywords), excludedTopics: list(channel.excludedTopics), recencyHours: rule.recencyHours, idempotencyKey: `automation:${runId}:collect` } } };
    }
    if (stage === "SCRIPT") {
      const idea = (await priorOutput("COLLECT")).idea;
      if (!idea || typeof idea !== "object" || Array.isArray(idea) || typeof (idea as Record<string, unknown>).id !== "string") { await this.holdStep(runId, stage, "COLLECT_OUTPUT_REQUIRED"); return null; }
      return { payload: { automation, generation: { request: { ideaId: (idea as Record<string, unknown>).id, platform: channel.outputProfiles[0]?.platform ?? null, idempotencyKey: `automation:${runId}:script`, partial: "full" }, idea } } };
    }
    const scriptOutput = await priorOutput("SCRIPT");
    const contentItemId = typeof scriptOutput.contentItemId === "string" ? scriptOutput.contentItemId : null;
    if (!contentItemId) { await this.holdStep(runId, stage, "SCRIPT_OUTPUT_REQUIRED"); return null; }
    if (stage === "ASSET") {
      const item = await this.prisma.contentItem.findUnique({ where: { id: contentItemId }, select: { title: true, summary: true } });
      return { contentItemId, payload: { automation, assetPreparation: { channelId, contentItemId, prompt: `${item?.title ?? "Short-form explainer"}. ${item?.summary ?? ""}`.trim(), idempotencyKey: `automation:${runId}:asset` } } };
    }
    if (stage === "TTS") {
      const script = await this.prisma.scriptVersion.findFirst({ where: { contentItemId }, orderBy: { version: "desc" } });
      if (!script) { await this.holdStep(runId, stage, "SCRIPT_VERSION_REQUIRED"); return null; }
      return { contentItemId, payload: { automation, ttsPreparation: { channelId, contentItemId, text: [script.hook, script.body, script.callToAction].filter(Boolean).join(" "), voice: channel.templates[0]?.voiceProfile ?? "default", idempotencyKey: `automation:${runId}:tts` } } };
    }
    if (stage === "RENDER") {
      const sceneVersionId = typeof scriptOutput.sceneVersionId === "string" ? scriptOutput.sceneVersionId : null;
      if (!sceneVersionId) { await this.holdStep(runId, stage, "SCENE_VERSION_REQUIRED"); return null; }
      return { contentItemId, payload: { automation, render: { channelId, contentItemId, sceneVersionId, idempotencyKey: `automation:${runId}:render` } } };
    }
    if (stage === "POLICY") {
      const platform = channel.platformAccounts[0]?.platform ?? channel.outputProfiles[0]?.platform;
      if (!platform) { await this.holdStep(runId, stage, "PLATFORM_OUTPUT_REQUIRED"); return null; }
      return { contentItemId, payload: { automation, policy: { contentItemId, platform, region: "GLOBAL" } } };
    }
    const item = await this.prisma.contentItem.findUnique({ where: { id: contentItemId }, include: { policyChecks: { orderBy: { checkedAt: "desc" }, take: 1 }, sceneVersions: { orderBy: { version: "desc" }, take: 1 }, sourceReferences: true, assetUsages: { include: { asset: { include: { licenses: { orderBy: { checkedAt: "desc" }, take: 1 } } } } } } });
    if (!item || item.status !== "APPROVED") { await this.holdStep(runId, stage, channel.automationMode === "APPROVAL" ? "AWAITING_APPROVAL" : "AUTO_APPROVAL_GATE_FAILED"); return null; }
    const rightsVerified = item.assetUsages.length > 0 && item.assetUsages.every((usage) => usage.asset.licenses[0]?.status === "VERIFIED" && usage.asset.licenses[0]?.commercialUseAllowed === true);
    if (item.policyChecks[0]?.status !== "PASS" || item.sourceReferences.length === 0 || !rightsVerified || !item.sceneVersions[0]?.renderManifest) { await this.holdStep(runId, stage, "PUBLISH_SAFETY_GATE_FAILED"); return null; }
    const account = channel.platformAccounts.find((candidate) => candidate.platform === item.policyChecks[0]?.platform);
    if (!account) { await this.holdStep(runId, stage, "CONNECTED_PLATFORM_ACCOUNT_REQUIRED"); return null; }
    const scheduledAt = this.nextSchedule(channel.scheduleRules.filter((rule) => rule.platform === null || rule.platform === account.platform), new Date());
    if (!scheduledAt) { await this.holdStep(runId, stage, "SCHEDULE_SLOT_REQUIRED"); return null; }
    const idempotencyKey = `automation:${runId}:publish-plan:${account.platform.toLowerCase()}`;
    let plan = await this.prisma.publishPlan.findUnique({ where: { idempotencyKey } });
    if (!plan) plan = await this.prisma.publishPlan.create({ data: { contentItemId, platform: account.platform, platformAccountId: account.id, sceneVersionId: item.sceneVersions[0]?.id, status: "SCHEDULED", scheduledAt, idempotencyKey, title: item.title, description: item.summary } });
    await this.prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "SCHEDULED" } });
    return { contentItemId, runAfter: plan.scheduledAt.toISOString(), payload: { automation, publish: { publishPlanId: plan.id } } };
  }

  private nextSchedule(rules: Array<{ dayOfWeek: number; timeOfDayUtc: string }>, after: Date): Date | null {
    const minimum = new Date(after.getTime() + 1_000);
    const candidates: Date[] = [];
    for (let offset = 0; offset <= 8; offset += 1) {
      const day = new Date(Date.UTC(minimum.getUTCFullYear(), minimum.getUTCMonth(), minimum.getUTCDate() + offset));
      for (const rule of rules) {
        if (day.getUTCDay() !== rule.dayOfWeek) continue;
        const [hours, minutes, seconds] = rule.timeOfDayUtc.split(":").map(Number);
        const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours ?? 0, minutes ?? 0, seconds ?? 0));
        if (candidate > minimum) candidates.push(candidate);
      }
    }
    return candidates.sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
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
    if (!result) {
      await this.holdStep(runId, stage, "BUDGET_HARD_LIMIT");
      await this.operations.notify(workspaceId, { eventKey: "budget.hard_limit", severity: "CRITICAL", channelId, cooldownMinutes: 30, payload: { automationRunId: runId, stage } });
    }
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

  private toResponse(run: { id: string; channelId: string; status: string; idempotencyKey: string; checkpoint: Prisma.JsonValue | null; failureCount: number; pausedReason: string | null; nextRunAt: Date | null; heartbeatAt: Date | null; lastErrorCode: string | null; lastErrorMessage: string | null; steps: Array<{ stage: string; status: string; attemptCount: number; maxAttempts: number; productionJobId: string | null; errorCode: string | null; errorMessage: string | null }> }): AutomationRunResponse {
    return AutomationRunResponseSchema.parse({ id: run.id, channelId: run.channelId, status: run.status, idempotencyKey: run.idempotencyKey, checkpoint: run.checkpoint, failureCount: run.failureCount, pausedReason: run.pausedReason, nextRunAt: run.nextRunAt?.toISOString() ?? null, heartbeatAt: run.heartbeatAt?.toISOString() ?? null, lastErrorCode: run.lastErrorCode, lastErrorMessage: run.lastErrorMessage, steps: run.steps });
  }
}
