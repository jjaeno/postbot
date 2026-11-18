import { scheduleAnalysis } from "../optimization/schedule-analysis.js";
import { estimateLlmInputTokens } from "@postbot/providers";
import { normalizeNarration } from "@postbot/scene-schema";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  AutomationBudgetRequestSchema,
  TopicSelectionPolicySchema,
  ChannelCollectionProfileSchema,
  AutomationControlRequestSchema,
  AutomationRunRequestSchema,
  AutomationRunResponseSchema,
  AutomationSwitchRequestSchema,
  type AutomationRunResponse,
  type AutomationBudgetResponse,
  type AutomationStage,
  type Platform
} from "@postbot/contracts";
import { Prisma, settleJobReservation, type PrismaClient } from "@postbot/database";
import { assertPlatformEnabled, loadConfig } from "@postbot/config";
import { JobsService } from "../jobs/jobs.service.js";
import { OperationsService } from "../operations/operations.service.js";
import { isCostStage } from "./automation-safety.js";
import { reserveAutomationCost } from "./automation-budget.js";
import { estimateAutomationStageCost, type AutomationCostUsage } from "./automation-cost-estimator.js";
import { nextZonedSchedule } from "./schedule-time.js";
import { createScheduledPlan, localPublishDay } from "../publishing/publish-slots.js";
import { scheduleAnalytics } from "../analytics/schedule-analytics.js";
import { schedulePublicationConfirmations } from "../publishing/schedule-publication-confirmation.js";
import { readAssetUsagePurpose } from "@postbot/asset-library";

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
  _review: number,
  approved: number,
  scheduled: number
): number => Math.max(0, minimum - (generating + approved + scheduled));

type RunStep = {
  id?: string;
  stage: string;
  platform: Platform | null;
  status: string;
  updatedAt?: Date;
};

const canDispatchAutomationStep = (step: RunStep): boolean => step.status === "PENDING"
  || (["QUEUED", "RUNNING"].includes(step.status) && step.updatedAt !== undefined && isAbandonedAutomationClaim(step.updatedAt));

export type AutomationRunDecision =
  | { status: "RUNNING"; runnable: Array<{ stage: Stage; platform: BranchPlatform }> }
  | { status: "SUCCEEDED" | "FAILED" | "PAUSED"; runnable: [] };

export const evaluateAutomationBranches = (steps: RunStep[]): AutomationRunDecision => {
  const common = steps.find((step) => step.stage === "COLLECT" && step.platform === null);
  if (!common) return { status: "FAILED", runnable: [] };
  if (common.status === "FAILED") return { status: "FAILED", runnable: [] };
  if (common.status === "HELD") return { status: "PAUSED", runnable: [] };
  if (!isComplete(common.status)) {
    return canDispatchAutomationStep(common)
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
    else if (canDispatchAutomationStep(step)) {
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
  private settlementCursor: string | null = null;
  private publicationCursor: string | null = null;

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
        platformAccounts: { include: { credential: true } },
        collectionRules: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 },
        scheduleRules: { where: { isActive: true } },
        outputProfiles: { where: { isActive: true } },
        templates: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 }
      }
    });
    if (!channel) throw new NotFoundException("ACTIVE_CHANNEL_NOT_FOUND");
    const audio = asObject(asObject(channel.templates[0]?.visualStyle ?? null).audio ?? null);
    for (const key of ["bgmAssetId", "sfxAssetId"]) {
      const assetId = audio[key]; if (typeof assetId !== "string") continue;
      const asset = await this.prisma.asset.findFirst({ where: { id: assetId, channelId: channel.id, kind: "AUDIO", origin: "STOCK_FREE" }, include: { licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
      const license = asset?.licenses[0]; const now = new Date();
      if (!license || license.status !== "VERIFIED" || !license.commercialUseAllowed || !license.derivativeAllowed || (license.validFrom && license.validFrom > now) || (license.validUntil && license.validUntil <= now)) throw new ConflictException({ code: "AUDIO_ASSET_LICENSE_REQUIRED", message: "선택 음원의 채널 소유권·상업 사용·변형 권리를 확인해 주세요. 비용 발생 전에 중단했습니다." });
    }
    const availablePlatforms = [...new Set([
      ...channel.outputProfiles.map((profile) => profile.platform),
      ...channel.platformAccounts.filter((account) => account.status === "CONNECTED").map((account) => account.platform)
    ])].sort();
    const operationalPlatforms = availablePlatforms.filter((platform) => { try { assertPlatformEnabled(loadConfig(), platform); return true; } catch { return false; } });
    const platforms = input.platforms ? [...new Set(input.platforms)].sort() : operationalPlatforms;
    if (platforms.some((platform) => !operationalPlatforms.includes(platform))) throw new ConflictException("PLATFORM_DISABLED_OR_PUBLISHING_HELD");
    if (platforms.length === 0) throw new ConflictException("ACTIVE_OUTPUT_PLATFORM_REQUIRED");
    if (platforms.some((platform) => !availablePlatforms.includes(platform))) throw new ConflictException("REQUESTED_OUTPUT_PLATFORM_NOT_CONFIGURED");
    const policies = await this.policyProfiles();
    for (const platform of platforms) {
      const profile = channel.outputProfiles.find((candidate) => candidate.platform === platform);
      const policy = policies.find((candidate) => candidate.platform === platform);
      if (!policy) throw new ConflictException({ code: "POLICY_RULE_NOT_FOUND", message: `${platform}의 유효 정책이 없습니다. 운영 정책을 설정한 뒤 제작해 주세요.` });
      if (!profile || profile.minDurationSeconds < policy.minDurationSeconds || profile.maxDurationSeconds > policy.maxDurationSeconds) throw new ConflictException({ code: "OUTPUT_DURATION_POLICY_CONFLICT", message: `${platform} 출력 길이를 유효 정책 범위 ${policy.minDurationSeconds}~${policy.maxDurationSeconds}초 안으로 설정해 주세요. 제작 비용 발생 전에 중단했습니다.` });
    }
    const selectedIdea = input.ideaId ? await this.prisma.contentIdea.findFirst({ where: { id: input.ideaId, channelId: channel.id, channel: { workspaceId } } }) : null;
    if (input.ideaId && !selectedIdea) throw new NotFoundException("CONTENT_IDEA_NOT_FOUND");

    const blockedPlatforms = new Map<Platform, string>();
    if (!input.sample) for (const platform of platforms) {
      const account = channel.platformAccounts.find((account) => account.platform === platform);
      if (platform === "INSTAGRAM" && channel.outputProfiles.find((profile) => profile.platform === platform)?.publicSetting !== "PUBLIC") { blockedPlatforms.set(platform, "INSTAGRAM_VISIBILITY_SETTING_UNSUPPORTED"); continue; }
      if (account && (account.status !== "CONNECTED" || account.credential?.expiresAt && account.credential.expiresAt <= new Date() && !account.credential.encryptedRefreshToken)) blockedPlatforms.set(platform, "ACCOUNT_REAUTH_REQUIRED");
      else if (channel.automationMode === "FULL_AUTO" && (!account || !channel.scheduleRules.some((rule) => rule.platform === null || rule.platform === platform))) blockedPlatforms.set(platform, "NO_CONNECTED_ACCOUNT_OR_SCHEDULE");
    }
    const heldReason = platforms.every((platform) => blockedPlatforms.has(platform)) ? blockedPlatforms.values().next().value ?? null : null;
    const ideaSnapshot = selectedIdea ? {
      id: selectedIdea.id, channelId: selectedIdea.channelId, title: selectedIdea.title, summary: selectedIdea.summary ?? "",
      canonicalUrl: selectedIdea.canonicalUrl, sourceName: selectedIdea.sourceName, sourceKind: selectedIdea.sourceKind,
      publishedAt: selectedIdea.publishedAt?.toISOString() ?? null, topic: channel.topic ?? channel.name, language: channel.language
    } : null;
    const reservation = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channel.id} FOR UPDATE`;
      const duplicate = await tx.automationRun.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } } });
      if (duplicate) return { run: duplicate, created: false };
      const currentChannel = await tx.channel.findUniqueOrThrow({ where: { id: channel.id } });
      if (!input.sample && currentChannel.status !== "ACTIVE") throw new ConflictException("CHANNEL_NOT_ACTIVE");
      const rule = await tx.collectionRule.findFirst({ where: { channelId: channel.id, isActive: true }, orderBy: { version: "desc" } });
      const profile = rule?.profile ? ChannelCollectionProfileSchema.parse(rule.profile) : null;
      if (selectedIdea) {
        const current = await tx.contentIdea.findUniqueOrThrow({ where: { id: selectedIdea.id } });
        const reservation = asObject(current.rawSnapshot).reservationRunId;
        if (typeof reservation === "string" && await tx.automationRun.count({ where: { id: reservation, status: { in: ["QUEUED", "RUNNING", "PAUSED", "DRAINING"] } } })) throw new ConflictException("IDEA_ALREADY_IN_PRODUCTION");
        if (["REJECTED", "EXPIRED"].includes(current.status)) throw new ConflictException("IDEA_NOT_AVAILABLE");
      }
      const active = await tx.automationRun.findMany({ where: { channelId: channel.id, status: { in: ["QUEUED", "RUNNING", "PAUSED", "DRAINING"] } }, orderBy: { createdAt: "desc" }, include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } } });
      const producers = active.filter((run) => asObject(run.checkpoint).collectionMode === undefined && run.steps.some((step) => ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER"].includes(step.stage) && !["SUCCEEDED", "SKIPPED", "CANCELLED"].includes(step.status)));
      if (producers.length >= (profile?.production.producerConcurrency ?? 1)) {
        if (selectedIdea || input.sample) throw new ConflictException("PRODUCER_CONCURRENCY_LIMIT");
        return { run: producers[0]!, created: false };
      }
      if (active.some((run) => run.status === "DRAINING" || (run.status === "PAUSED" && asObject(run.checkpoint).explicitPause === true))) throw new ConflictException("CHANNEL_PRODUCTION_EXPLICITLY_PAUSED");
      const counts = await tx.contentItem.groupBy({ by: ["status"], where: { channelId: channel.id }, _count: { _all: true } });
      const count = (status: string) => counts.find((entry) => entry.status === status)?._count._all ?? 0;
      const nearScheduled = await tx.contentItem.count({ where: { channelId: channel.id, status: "SCHEDULED", publishPlans: { some: { status: "SCHEDULED", scheduledAt: { lte: new Date(Date.now() + (profile?.production.scheduledBufferHours ?? 24) * 3600000) } } } } });
      const deficit = selectedIdea || input.sample ? 1 : inventoryDeficit(currentChannel.minInventoryCount, Math.max(count("GENERATING"), producers.length), count("REVIEW_REQUIRED"), count("APPROVED"), nearScheduled);
      if (!input.sample && count("REVIEW_REQUIRED") >= (profile?.production.reviewCap ?? 5)) throw new ConflictException("PRODUCTION_REVIEW_CAP_REACHED");
      const initialStatus: "SKIPPED" | "HELD" | "PENDING" = deficit === 0 ? "SKIPPED" : heldReason ? "HELD" : "PENDING";
      const steps = [
        { stage: "COLLECT" as const, platform: null, branchKey: "COMMON", status: selectedIdea && !heldReason ? "SUCCEEDED" as const : initialStatus, ...(ideaSnapshot ? { output: { idea: ideaSnapshot }, finishedAt: new Date() } : {}) },
        ...platforms.flatMap((platform) => platformStages.map((stage) => ({
          stage,
          platform,
          branchKey: platform,
          status: initialStatus === "SKIPPED" ? initialStatus : blockedPlatforms.has(platform) && stage === "SCRIPT" ? "HELD" as const : initialStatus,
          ...(blockedPlatforms.has(platform) && stage === "SCRIPT" ? { errorCode: blockedPlatforms.get(platform) } : {})
        })))
      ];
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
          partial: input.partial,
          selectStoredOnly: profile !== null,
          sample: input.sample === true
        },
        nextRunAt: deficit === 0 || heldReason ? null : new Date(),
        steps: { create: steps },
        events: { create: { action: "START", details: { deficit, mode: channel.automationMode, platforms, source: selectedIdea ? "manual-idea" : "scheduler" } } }
      },
      include: { steps: { orderBy: [{ platform: "asc" }, { createdAt: "asc" }] } }
      });
      if (selectedIdea) {
        const current = await tx.contentIdea.findUniqueOrThrow({ where: { id: selectedIdea.id } });
        await tx.contentIdea.update({ where: { id: selectedIdea.id }, data: { rawSnapshot: { ...asObject(current.rawSnapshot), reservationRunId: created.id } } });
      }
      return { run: created, created: true };
    });
    const run = reservation.run;
    if (!reservation.created) return this.toResponse(run);
    if (run.status === "QUEUED") {
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
      this.prisma.automationRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", pausedReason: null, nextRunAt: null, lastErrorCode: null, lastErrorMessage: null } }),
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

  async policyProfiles() {
    const rules = await this.prisma.policyRule.findMany({ where: { region: "GLOBAL", effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }] });
    const seen = new Set<string>();
    return rules.flatMap((rule) => {
      if (seen.has(rule.platform)) return [];
      seen.add(rule.platform);
      const duration = asObject(rule.durationRule);
      return [{ platform: rule.platform, region: rule.region, version: rule.version, checkedAt: rule.checkedAt.toISOString(), minDurationSeconds: Number(duration.minDurationSeconds ?? duration.minSeconds ?? 0), maxDurationSeconds: Number(duration.maxDurationSeconds ?? duration.maxSeconds ?? 60) }];
    });
  }

  async listSwitches(workspaceId: string) {
    const switches = await this.prisma.automationSwitch.findMany({ where: { workspaceId }, select: { provider: true, isEnabled: true, reason: true }, orderBy: { updatedAt: "desc" } });
    const providers = [...new Set(switches.map((entry) => entry.provider))];
    return providers.map((provider) => switches.find((entry) => entry.provider === provider && !entry.isEnabled) ?? switches.find((entry) => entry.provider === provider)!);
  }

  async setSwitch(workspaceId: string, raw: unknown, role: string, userId: string) {
    if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
    const input = AutomationSwitchRequestSchema.parse(raw);
    const data = { isEnabled: input.isEnabled, reason: input.reason ?? null };
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      const existing = await tx.automationSwitch.findFirst({ where: { workspaceId, provider: input.provider } });
      if (!existing) return tx.automationSwitch.create({ data: { workspaceId, provider: input.provider, ...data } });
      // Older circuit-breaker races may have left duplicate rows: all must agree.
      await tx.automationSwitch.updateMany({ where: { workspaceId, provider: input.provider }, data });
      return { ...existing, ...data };
    });
    await this.operations.audit(workspaceId, userId, "automation.switch.update", "automation_switch", saved.id);
    return { provider: saved.provider, isEnabled: saved.isEnabled, reason: saved.reason };
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
      for (const step of recoverable) {
        if (!step.productionJobId) continue;
        const job = await this.prisma.productionJob.findUnique({ where: { id: step.productionJobId } });
        if (job && (asObject(job.result).reconciliationRequired === true || job.errorCode?.includes("RECONCILIATION_REQUIRED"))) throw new ConflictException("RECONCILIATION_REQUIRED_CONFIRM_PROVIDER_OUTCOME");
      }
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
      await this.prisma.$transaction(async (tx) => {
        // Cancel unclaimed jobs before releasing their reservations. A worker
        // that already claimed a paid job keeps its reservation until settlement.
        await tx.productionJob.updateMany({
          where: { automationSteps: { some: { automationRunId: run.id } }, status: input.action === "kill" ? { in: ["QUEUED", "RETRY_WAIT", "NEEDS_REVIEW"] } : { in: [] } },
          data: { status: "CANCELLED", finishedAt: new Date() }
        });
        await tx.automationStep.updateMany({
          where: { automationRunId: run.id, status: input.action === "kill" ? { in: ["PENDING", "QUEUED", "HELD"] } : "PENDING" },
          data: { status: input.action === "kill" ? "CANCELLED" : "PENDING" }
        });
        let released = new Prisma.Decimal(0);
        if (input.action === "kill") {
          const unstarted = await tx.automationStep.findMany({
            where: { automationRunId: run.id, productionJob: { is: { status: "CANCELLED", startedAt: null, attempts: { none: {} } } } },
            select: { stage: true, platform: true }
          });
          const keys = unstarted.filter((step) => step.platform !== null).map((step) => `automation:${run.id}:${step.stage.toLowerCase()}:${step.platform!.toLowerCase()}:cost`);
          const reservations = await tx.automationCostReservation.findMany({ where: { automationRunId: run.id, idempotencyKey: { in: keys }, releasedAt: null, settledAt: null } });
          for (const reservation of reservations) {
            const changed = await tx.automationCostReservation.updateMany({ where: { id: reservation.id, releasedAt: null, settledAt: null }, data: { releasedAt: new Date() } });
            if (changed.count === 1) released = released.plus(reservation.amount);
          }
        }
        await tx.automationRun.update({
          where: { id: run.id },
          data: {
            status,
            pausedReason: input.action === "resume" ? null : input.reason ?? input.action,
            nextRunAt: input.action === "resume" ? new Date() : null,
            checkpoint: { ...asObject(run.checkpoint), explicitPause: input.action === "pause" || input.action === "drain" },
            budgetReserved: { decrement: released }
          }
        });
        await tx.automationEvent.create({ data: { automationRunId: run.id, action, reason: input.reason } });
      });
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
    const currentRun = await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!currentRun || !["QUEUED", "RUNNING"].includes(currentRun.status)) return;
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
        select: { status: true, result: true, errorCode: true, errorMessage: true, finishedAt: true,
          attempts: { orderBy: { attemptNumber: "desc" }, take: 1, select: { attemptNumber: true } } }
      });
      // Reconcile a missed worker notification without executing terminal work again.
      if (existingJob && ["QUEUED", "RUNNING"].includes(step.status)
        && ["SUCCEEDED", "FAILED", "NEEDS_REVIEW", "CANCELLED"].includes(existingJob.status)) {
        const status = existingJob.status === "SUCCEEDED" ? "SUCCEEDED" : existingJob.status === "NEEDS_REVIEW" ? "HELD" : "FAILED";
        await this.prisma.automationStep.updateMany({
          where: { id: step.id, productionJobId: step.productionJobId, status: { in: ["QUEUED", "RUNNING"] } },
          data: { status, output: existingJob.result === null ? Prisma.DbNull : existingJob.result,
            attemptCount: existingJob.attempts[0]?.attemptNumber ?? step.attemptCount,
            finishedAt: existingJob.finishedAt ?? new Date(),
            errorCode: status === "SUCCEEDED" ? null : existingJob.errorCode ?? `JOB_${existingJob.status}`,
            errorMessage: status === "SUCCEEDED" ? null : existingJob.errorMessage }
        });
        return;
      }
      if (existingJob && ["FAILED", "NEEDS_REVIEW", "CANCELLED"].includes(existingJob.status)) {
        if (isCostStage(stage) && !await this.reserveCost(workspaceId, runId, channelId, stage, platform)) return;
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
      if (existingJob && ["QUEUED", "RETRY_WAIT"].includes(existingJob.status)) await this.jobs.recover(workspaceId, step.productionJobId, {});
      return;
    }
    if (step.status === "QUEUED") {
      if (!isAbandonedAutomationClaim(step.updatedAt)) return;
      await this.prisma.automationStep.updateMany({
        where: { id: step.id, status: "QUEUED", productionJobId: null, updatedAt: step.updatedAt },
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
    await this.jobs.create(workspaceId, {
      type: stage,
      channelId,
      contentItemId: prepared.contentItemId,
      idempotencyKey: `automation:${runId}:${platformKey}:${stage.toLowerCase()}`,
      payload: prepared.payload,
      runAfter: prepared.runAfter
    }, async (job) => {
      await this.prisma.$transaction([
        this.prisma.automationStep.updateMany({
          where: { id: step.id, status: { not: "CANCELLED" } },
          data: { productionJobId: job.id }
        }),
        this.prisma.automationRun.updateMany({
          where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
          data: { status: "RUNNING", heartbeatAt: new Date(), nextRunAt: null }
        })
      ]);
    });
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
      const currentRun = await this.prisma.automationRun.findUniqueOrThrow({ where: { id: runId }, select: { checkpoint: true } });
      const checkpoint = asObject(currentRun.checkpoint);
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
            mode: checkpoint.collectionMode ?? (checkpoint.selectStoredOnly === true ? "SELECT" : "COLLECT_SELECT"),
            channelId,
            topic: channel.topic ?? channel.name,
            language: channel.language,
            keywords: list(rule.keywords),
            allowedSources: list(rule.allowedSources),
            excludedSources: list(rule.excludedSources),
            excludedKeywords: list(rule.excludedKeywords),
            excludedTopics: list(channel.excludedTopics),
            recencyHours: rule.recencyHours,
            selectionPolicy: TopicSelectionPolicySchema.parse(rule.selectionPolicy ?? {}),
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
              partial: ["hook", "body", "metadata", "scene", "voice", "subtitle"].includes(String(partial)) ? partial : "full"
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
            language: script.language,
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
        include: { asset: { include: { licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } }
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
          hashtags,
          metadata: { publicSetting: channel.outputProfiles.find((profile) => profile.platform === platform)?.publicSetting ?? "PUBLIC" }
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

  private nextSchedule(rules: Array<{ dayOfWeek: number; timeOfDayUtc: string; timezone?: string; maxPosts?: number }>, after: Date): Date | null {
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
    const rule = await this.prisma.collectionRule.findFirst({ where: { channelId, isActive: true }, orderBy: { version: "desc" } });
    const profile = rule?.profile ? ChannelCollectionProfileSchema.parse(rule.profile) : null;
    if (profile && estimate !== null) {
      const usage = await this.prisma.providerUsage.findMany({ where: { productionJob: { automationSteps: { some: { automationRunId: runId, platform } } } }, select: { actualCost: true, estimatedCost: true, productionJob: { select: { type: true } } } });
      const spent = usage.reduce((total, item) => total.plus(item.actualCost ?? item.estimatedCost ?? 0), new Prisma.Decimal(0));
      const stageSpent = usage.filter((item) => item.productionJob?.type === stage).reduce((total, item) => total.plus(item.actualCost ?? item.estimatedCost ?? 0), new Prisma.Decimal(0));
      const projected = stage === "SCRIPT" ? spent.minus(stageSpent).plus(Prisma.Decimal.max(stageSpent, estimate)) : spent.plus(estimate);
      if (projected.gt(profile.production.maxEstimatedCostUsd)) {
        await this.holdStep(runId, stage, platform, "CHANNEL_PRODUCTION_COST_LIMIT"); return false;
      }
    }
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
    const run = await this.prisma.automationRun.findUniqueOrThrow({ where: { id: runId }, select: { checkpoint: true } });
    const partial = asObject(run.checkpoint).partial;
    if (["voice", "subtitle"].includes(String(partial)) && (stage === "SCRIPT" || stage === "ASSET" || (stage === "TTS" && partial === "subtitle"))) return { stage, provider: "local-reuse", model: "version-reuse", amountUsd: 0, usage: {}, pricing: {} };
    const usage: AutomationCostUsage = {};
    if (stage === "SCRIPT") {
      const step = await this.prisma.automationStep.findFirst({ where: { automationRunId: runId, stage: "COLLECT" }, select: { output: true } });
      const idea = asObject(asObject(step?.output ?? null).idea as Prisma.JsonValue ?? null);
      const source = typeof idea.id === "string" ? await this.prisma.contentIdea.findUnique({ where: { id: idea.id } }) : null;
      const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { templates: { where: { isActive: true } }, outputProfiles: { where: { platform, isActive: true } }, strategyVersions: { where: { appliedAt: { not: null } }, orderBy: { version: "desc" }, take: 1 } } });
      // Duplicate text fields cover the actual title/summary/source prompt copies.
      usage.inputTokens = estimateLlmInputTokens({ idea, source, channel, copies: [idea, source, channel] });
      usage.outputTokens = loadConfig().LLM_MAX_OUTPUT_TOKENS;
    }
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
        if (stage === "ASSET") {
          const imageScenes = scenes.filter((entry) => asObject(entry as Prisma.JsonValue).visualMode !== "GRAPHIC");
          const aiCount = Math.round(imageScenes.length * (typeof document.aiStockRatio === "number" ? document.aiStockRatio : 1));
          const usages = await this.prisma.assetUsage.findMany({ where: { sceneVersionId }, select: { usageSnapshot: true, purpose: true } });
          usage.imageCount = imageScenes.slice(0, aiCount).filter((entry) => {
            const id = asObject(entry as Prisma.JsonValue).id;
            return typeof id !== "string" || !usages.some((usage) => readAssetUsagePurpose(usage) === `scene-image:${platform}:${id}`);
          }).length;
        }
        else {
          const frames = typeof document.durationInFrames === "number" ? document.durationInFrames : 0;
          const fps = typeof document.fps === "number" ? document.fps : 0;
          usage.durationSeconds = fps > 0 ? frames / fps : 0;
        }
      } else if (stage === "TTS") {
        const script = await this.prisma.scriptVersion.findFirst({ where: { contentItemId, platform }, orderBy: { version: "desc" } });
        const prepared = await this.prisma.assetUsage.findMany({ where: { sceneVersionId }, select: { usageSnapshot: true, purpose: true } });
        const reusable = prepared.some((usage) => readAssetUsagePurpose(usage).startsWith("tts-narration"));
        usage.characters = reusable ? 0 : script ? normalizeNarration([script.hook, script.body, script.callToAction].filter(Boolean).join(" "), script.language).speech.length : 0;
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
      this.prisma.automationStep.updateMany({
        where: { id: step.id, status: { not: "CANCELLED" } },
        data: {
          status: "HELD",
          errorCode: reason,
          errorMessage: reason,
          finishedAt: new Date()
        }
      }),
      this.prisma.automationRun.updateMany({
        where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
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

  private analysisCursor: string | null = null;

  private async scheduleDueRuns(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
    const now = new Date();
    await this.settleKnownReservations();
    this.publicationCursor = await schedulePublicationConfirmations(this.prisma, this.jobs, now, this.publicationCursor);
    await scheduleAnalytics(this.prisma, this.jobs, now);
    this.analysisCursor = await scheduleAnalysis(this.prisma, this.jobs, now, this.analysisCursor);
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
      const profile = rule.profile ? ChannelCollectionProfileSchema.parse(rule.profile) : null;
      if (profile) {
        for (const [mode, minutes] of [["DISCOVER", profile.cadence.collectMinutes], ["RANK", profile.cadence.selectMinutes]] as const) {
          try { await this.scheduleCollectionPass(channel.workspaceId, channel.id, mode, Math.floor(now.getTime() / (minutes * 60000))); } catch { /* Independent cadence retries on the next tick. */ }
        }
        const available = await this.prisma.contentIdea.count({ where: { channelId: channel.id, status: { in: ["CANDIDATE", "SHORTLISTED"] }, usedContentItemId: null, rejectionReason: null } });
        if (available === 0) return;
        const waiting = await this.prisma.automationRun.findFirst({ where: { channelId: channel.id, pausedReason: "NO_UNUSED_SOURCE_CANDIDATE", nextRunAt: { gt: now } } });
        if (waiting) return;
      }
      const intervalMs = (profile?.cadence.produceMinutes ?? rule.collectionFrequencyMinutes) * 60_000;
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

  private async settleKnownReservations(): Promise<void> {
    const reservations = await this.prisma.automationCostReservation.findMany({ where: { releasedAt: null, settledAt: null, ...(this.settlementCursor ? { id: { gt: this.settlementCursor } } : {}) }, orderBy: { id: "asc" }, take: 100 });
    for (const reservation of reservations) {
      const platform = reservation.idempotencyKey.split(":").at(-2)?.toUpperCase();
      if (platform !== "YOUTUBE" && platform !== "INSTAGRAM" && platform !== "TIKTOK") continue;
      const step = await this.prisma.automationStep.findFirst({ where: { automationRunId: reservation.automationRunId, stage: reservation.stage, platform }, select: { productionJobId: true } });
      if (step?.productionJobId) await settleJobReservation(this.prisma, step.productionJobId);
    }
    this.settlementCursor = reservations.length === 100 ? reservations.at(-1)!.id : null;
  }

  private async scheduleCollectionPass(workspaceId: string, channelId: string, mode: "DISCOVER" | "RANK", bucket: number): Promise<void> {
    const idempotencyKey = `collection:${channelId}:${mode}:${bucket}`;
    const run = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: channelId } });
      if (channel.status !== "ACTIVE") return null;
      if (await tx.automationSwitch.count({ where: { workspaceId, provider: null, isEnabled: false } })) return null;
      const existing = await tx.automationRun.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
      const pending = await tx.automationRun.findFirst({ where: { channelId, status: { in: ["QUEUED", "RUNNING", "PAUSED"] }, checkpoint: { path: "$.collectionMode", equals: mode } } });
      if (pending) return pending;
      return tx.automationRun.create({ data: { channelId, idempotencyKey, status: "QUEUED", checkpoint: { collectionMode: mode }, steps: { create: { stage: "COLLECT", branchKey: "COMMON", status: "PENDING" } } } });
    });
    if (run && ["QUEUED", "RUNNING"].includes(run.status)) await this.enqueueStage(workspaceId, run.id, channelId, "COLLECT", null);
  }

  private async resumeNextStep(run: {
    id: string;
    channelId: string;
    status: string;
    channel: { workspaceId: string };
    steps: Array<{ id: string; stage: string; platform: Platform | null; status: string; errorCode: string | null; errorMessage?: string | null; updatedAt?: Date }>;
  }): Promise<void> {
    const decision = evaluateAutomationBranches(run.steps);
    if (decision.status !== "RUNNING") {
      const failure = run.steps.find((step) => step.status === "FAILED");
      const held = run.steps.find((step) => step.status === "HELD");
      await this.prisma.automationRun.updateMany({
        where: { id: run.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: decision.status,
          pausedReason: decision.status === "PAUSED" ? held?.errorCode ?? "BRANCH_HELD" : null,
          lastErrorCode: decision.status === "FAILED" ? failure?.errorCode ?? "BRANCH_FAILED" : null,
          lastErrorMessage: decision.status === "FAILED" ? failure?.errorMessage ?? null : null,
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
      productionState: asObject(run.checkpoint).collectionMode ? "DISCOVERY" : run.status === "CANCELLED" ? "CANCELLED"
        : asObject(run.checkpoint).skipped === true || asObject(run.checkpoint).stage === "inventory-satisfied" ? "NOT_REQUIRED"
        : run.steps.some((step) => ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER"].includes(step.stage) && step.status === "FAILED") ? "FAILED"
        : run.steps.some((step) => ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY"].includes(step.stage) && step.status === "HELD") ? "REVIEW_REQUIRED"
        : run.steps.filter((step) => step.stage !== "PUBLISH").every((step) => ["SUCCEEDED", "SKIPPED", "CANCELLED"].includes(step.status)) ? "READY" : "PRODUCING",
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
