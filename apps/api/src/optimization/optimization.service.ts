import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import { AssignExperimentRequestSchema, CreateExperimentRequestSchema, ExperimentActionRequestSchema, ExperimentResponseSchema, GenerateSuggestionsRequestSchema, OptimizationSettingsSchema, OptimizationSuggestionResponseSchema, SuggestionActionRequestSchema, UpdateOptimizationSettingsRequestSchema, type ExperimentResponse, type OptimizationSettings, type OptimizationSuggestionResponse } from "@postbot/contracts";
import { createHash } from "node:crypto";
import { OperationsService } from "../operations/operations.service.js";
import { deterministicExperimentArm, compareExperimentArms } from "@postbot/optimization";
export { deterministicExperimentArm } from "@postbot/optimization";

const MIN_SAMPLE_SIZE = 4;
const RULE_VERSION = "optimization-rules-v1";
const METRIC_VERSION = "analytics-mapping-v2";
const terminalSuggestion = new Set(["REJECTED", "APPLIED", "EXPIRED"]);
const terminalExperiment = new Set(["COMPLETED", "CANCELLED", "STOPPED", "INCONCLUSIVE"]);
const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const toInputJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const isProtected = (content: { title: string; topicKey: string }, settings: OptimizationSettings): boolean => {
  const text = `${content.title} ${content.topicKey}`.toLocaleLowerCase();
  return [...settings.protectedTopics, ...settings.protectedBrandPhrases, ...settings.prohibitedPatterns].some((entry) => text.includes(entry.toLocaleLowerCase()));
};

@Injectable()
export class OptimizationService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly operations: OperationsService) {}

  async getSettings(workspaceId: string, channelId: string): Promise<OptimizationSettings> {
    const channel = await this.channel(workspaceId, channelId);
    return OptimizationSettingsSchema.parse(asRecord(channel.optimizationSettings));
  }

  async updateSettings(workspaceId: string, role: string, userId: string, raw: unknown): Promise<OptimizationSettings> {
    this.requireOwner(role);
    const input = UpdateOptimizationSettingsRequestSchema.parse(raw);
    await this.channel(workspaceId, input.channelId);
    await this.prisma.channel.update({ where: { id: input.channelId }, data: { optimizationSettings: input.settings } });
    await this.operations.audit(workspaceId, userId, "optimization.settings.update", "channel", input.channelId);
    return input.settings;
  }

  async generate(workspaceId: string, raw: unknown): Promise<OptimizationSuggestionResponse> {
    const input = GenerateSuggestionsRequestSchema.parse(raw);
    const existing = await this.prisma.optimizationSuggestion.findUnique({ where: { suggestionKey: hash(input.idempotencyKey) } });
    if (existing) {
      if (existing.channelId !== input.channelId) throw new ConflictException("OPTIMIZATION_IDEMPOTENCY_CONFLICT");
      await this.channel(workspaceId, existing.channelId);
      return this.suggestionResponse(existing);
    }
    const channel = await this.channel(workspaceId, input.channelId);
    const settings = OptimizationSettingsSchema.parse(asRecord(channel.optimizationSettings));
    const snapshots = await this.prisma.analyticsMetricSnapshot.findMany({
      where: { mappingVersion: { not: "legacy-ambiguous-v1" }, metric: input.metric, status: "AVAILABLE", value: { not: null }, observedAt: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, platformPost: { platform: input.platform, publishPlan: { contentItem: { channelId: channel.id } } } },
      include: {
        platformPost: {
          include: {
            publishPlan: {
              include: {
                contentItem: { include: { scriptVersions: { orderBy: { version: "desc" }, take: 1 } } }
              }
            }
          }
        }
      },
      orderBy: [{ platformPostId: "asc" }, { observedAt: "desc" }]
    });
    const latestByPost = new Map<string, typeof snapshots[number]>();
    for (const snapshot of snapshots) if (!latestByPost.has(snapshot.platformPostId)) latestByPost.set(snapshot.platformPostId, snapshot);
    const candidates = [...latestByPost.values()].filter((snapshot) => !isProtected(snapshot.platformPost.publishPlan.contentItem, settings));
    const complete = candidates.filter((snapshot) => snapshot.platformPost.publishPlan.contentItem.scriptVersions[0]?.durationSeconds !== null && snapshot.platformPost.publishPlan.contentItem.scriptVersions[0]?.durationSeconds !== undefined);
    const values = complete.map((snapshot) => Number(snapshot.value));
    const mean = values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
    const variance = values.length === 0 ? 0 : values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
    const standardDeviation = Math.sqrt(variance);
    const nonOutliers = complete.filter((snapshot) => standardDeviation === 0 || Math.abs(Number(snapshot.value) - mean) <= standardDeviation * 2);
    const sorted = [...nonOutliers].sort((left, right) => Number(right.value) - Number(left.value) || left.platformPostId.localeCompare(right.platformPostId));
    const sampleSize = sorted.length;
    const split = Math.max(1, Math.floor(sampleSize / 2));
    const top = sorted.slice(0, split);
    const bottom = sorted.slice(-split);
    const averageDuration = (items: typeof sorted): number => items.length === 0 ? 0 : items.reduce((total, item) => total + Number(item.platformPost.publishPlan.contentItem.scriptVersions[0]?.durationSeconds ?? 0), 0) / items.length;
    const topDuration = averageDuration(top);
    const bottomDuration = averageDuration(bottom);
    const sufficient = sampleSize >= MIN_SAMPLE_SIZE && candidates.length === complete.length && nonOutliers.length >= MIN_SAMPLE_SIZE;
    const confidence = sufficient ? Math.min(0.95, 0.45 + sampleSize / 100 + Math.min(0.25, Math.abs(topDuration - bottomDuration) / Math.max(1, bottomDuration))) : 0;
    const targetDuration = bottomDuration === 0 ? 0 : Math.round(bottomDuration * (1 + Math.max(-settings.maxChangeRatio, Math.min(settings.maxChangeRatio, (topDuration - bottomDuration) / bottomDuration))));
    const evidence = { platform: input.platform, metric: input.metric, periodStart: input.periodStart, periodEnd: input.periodEnd, baseline: { mean, standardDeviation, bottomDuration, topDuration }, cohorts: { topPostIds: top.map((item) => item.platformPostId), bottomPostIds: bottom.map((item) => item.platformPostId) }, completeness: { total: candidates.length, complete: complete.length, outliersExcluded: complete.length - nonOutliers.length }, conclusion: sufficient ? "hypothesis" : "insufficient_sample_or_incomplete_data" };
    const suggestion = await this.prisma.optimizationSuggestion.create({ data: { channelId: channel.id, suggestionKey: hash(input.idempotencyKey), status: "PENDING", title: sufficient ? "Test a bounded duration adjustment" : "Collect more comparable performance data", rationale: sufficient ? "This is a correlation-based hypothesis, not a causal claim. Run an experiment before broad adoption." : "The sample, completeness, or outlier screening is insufficient for a confirmed pattern.", evidence, sampleSize, confidenceScore: new Prisma.Decimal(confidence.toFixed(6)), expectedImpact: { metric: input.metric, direction: topDuration >= bottomDuration ? "increase" : "decrease", hypothesisOnly: true }, targetStrategy: sufficient && settings.autoApplyFields.includes("durationSeconds") ? toInputJson({ durationSeconds: targetDuration, maxChangeRatio: settings.maxChangeRatio }) : Prisma.DbNull, risk: { protectedItemsExcluded: candidates.length - snapshots.length, requiresExperiment: true, rollback: "restore previous StrategyVersion" }, inputSnapshot: { snapshotIds: sorted.map((item) => item.id), metricVersion: METRIC_VERSION, ruleVersion: RULE_VERSION }, metricVersion: METRIC_VERSION, ruleVersion: RULE_VERSION, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    return this.suggestionResponse(suggestion);
  }

  async listSuggestions(workspaceId: string, channelId: string): Promise<OptimizationSuggestionResponse[]> {
    await this.channel(workspaceId, channelId);
    const now = new Date();
    await this.prisma.optimizationSuggestion.updateMany({ where: { channelId, status: { in: ["PENDING", "PROPOSED", "APPROVED"] }, expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
    const suggestions = await this.prisma.optimizationSuggestion.findMany({ where: { channelId }, orderBy: { createdAt: "desc" } });
    return suggestions.map((suggestion) => this.suggestionResponse(suggestion));
  }

  async listStrategies(workspaceId: string, channelId: string) {
    await this.channel(workspaceId, channelId);
    const versions = await this.prisma.strategyVersion.findMany({ where: { channelId }, orderBy: { version: "desc" } });
    return versions.map((version) => ({ version: version.version, name: version.name, appliedAt: version.appliedAt?.toISOString() ?? null, strategy: asRecord(version.strategy) }));
  }

  async suggestionAction(workspaceId: string, role: string, userId: string, suggestionId: string, raw: unknown): Promise<OptimizationSuggestionResponse> {
    this.requireOwner(role);
    const input = SuggestionActionRequestSchema.parse(raw);
    const suggestion = await this.prisma.optimizationSuggestion.findFirst({ where: { id: suggestionId, channel: { workspaceId } } });
    if (!suggestion) throw new NotFoundException("OPTIMIZATION_SUGGESTION_NOT_FOUND");
    if (terminalSuggestion.has(suggestion.status)) throw new ConflictException("SUGGESTION_TERMINAL");
    if (suggestion.expiresAt && suggestion.expiresAt < new Date()) return this.suggestionResponse(await this.prisma.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status: "EXPIRED", decidedAt: new Date() } }));
    if (input.action === "reject" || input.action === "expire") {
      const status = input.action === "reject" ? "REJECTED" : "EXPIRED";
      const updated = await this.prisma.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status, decidedAt: new Date(), risk: { ...asRecord(suggestion.risk), decisionReason: input.reason ?? null } } });
      await this.operations.audit(workspaceId, userId, `optimization.suggestion.${input.action}`, "optimization_suggestion", updated.id);
      return this.suggestionResponse(updated);
    }
    if (input.action === "approve") { const updated = await this.prisma.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status: "APPROVED", decidedAt: new Date() } }); await this.operations.audit(workspaceId, userId, "optimization.suggestion.approve", "optimization_suggestion", updated.id); return this.suggestionResponse(updated); }
    if (suggestion.status !== "APPROVED") throw new ConflictException("SUGGESTION_REQUIRES_APPROVAL");
    const evidence = asRecord(suggestion.evidence);
    if (suggestion.metricVersion !== METRIC_VERSION && ((evidence.platform === "YOUTUBE" && evidence.metric === "completion_rate") || (evidence.platform === "INSTAGRAM" && evidence.metric === "impressions"))) throw new ConflictException("LEGACY_METRIC_REQUIRES_RESYNC_AND_NEW_SUGGESTION");
    const applied = await this.applyStrategy(suggestion);
    await this.operations.audit(workspaceId, userId, "optimization.suggestion.apply", "optimization_suggestion", applied.id);
    return this.suggestionResponse(applied);
  }

  async createExperiment(workspaceId: string, role: string, raw: unknown): Promise<ExperimentResponse> {
    this.requireOwner(role);
    const input = CreateExperimentRequestSchema.parse(raw);
    await this.channel(workspaceId, input.channelId);
    const profile = await this.prisma.platformOutputProfile.findFirst({ where: { channelId: input.channelId, platform: input.platform, isActive: true }, orderBy: { version: "desc" } });
    const settings = await this.getSettings(workspaceId, input.channelId);
    if (!profile || [input.control.durationSeconds, input.variant.durationSeconds].some((value) => value < profile.minDurationSeconds || value > profile.maxDurationSeconds) || Math.abs(input.variant.durationSeconds / input.control.durationSeconds - 1) > settings.maxChangeRatio) throw new ConflictException("EXPERIMENT_DURATION_OUTSIDE_ALLOWED_RANGE");
    const experiment = await this.prisma.experiment.create({ data: { channelId: input.channelId, name: input.name, hypothesis: input.hypothesis, allocation: toInputJson({ control: input.control, variant: input.variant, platform: input.platform, periodDays: input.periodDays }), successCriteria: toInputJson(input.successCriteria), targetMetric: input.targetMetric, minSampleSize: input.minSampleSize, stopCriteria: input.stopCriteria ? toInputJson(input.stopCriteria) : Prisma.DbNull } });
    return this.experimentResponse(experiment);
  }

  async listExperiments(workspaceId: string, channelId: string): Promise<ExperimentResponse[]> {
    await this.channel(workspaceId, channelId);
    return (await this.prisma.experiment.findMany({ where: { channelId }, orderBy: { createdAt: "desc" } })).map((item) => this.experimentResponse(item));
  }

  async experimentAction(workspaceId: string, role: string, experimentId: string, raw: unknown, userId?: string): Promise<ExperimentResponse> {
    this.requireOwner(role);
    const input = ExperimentActionRequestSchema.parse(raw);
    const experiment = await this.prisma.experiment.findFirst({ where: { id: experimentId, channel: { workspaceId } } });
    if (!experiment) throw new NotFoundException("EXPERIMENT_NOT_FOUND");
    if (input.action === "complete" && experiment.status === "COMPLETED") return this.experimentResponse(experiment);
    if (terminalExperiment.has(experiment.status)) throw new ConflictException("EXPERIMENT_TERMINAL");
    if (input.action === "complete") {
      if (!experiment.startedAt || !["RUNNING", "PAUSED"].includes(experiment.status)) throw new ConflictException("EXPERIMENT_NOT_STARTED");
      const allocation = asRecord(experiment.allocation);
      const platform = allocation.platform;
      if (platform !== "YOUTUBE" && platform !== "INSTAGRAM" && platform !== "TIKTOK") throw new ConflictException("EXPERIMENT_PLATFORM_REQUIRED");
      const end = new Date(Math.min(Date.now(), experiment.startedAt.getTime() + (typeof allocation.periodDays === "number" ? allocation.periodDays : 30) * 86_400_000));
      const assignments = await this.prisma.experimentAssignment.findMany({
        where: { experimentId },
        include: { contentItem: { include: { publishPlans: {
          where: { platform, status: "PUBLISHED" },
          include: {
            sceneVersion: { include: { scriptVersion: true } },
            platformPost: { include: { analyticsSnapshots: {
              where: { mappingVersion: { not: "legacy-ambiguous-v1" }, metric: experiment.targetMetric ?? "", status: "AVAILABLE", value: { not: null }, observedAt: { gte: experiment.startedAt, lte: end } },
              orderBy: [{ observedAt: "desc" }, { revision: "desc" }]
            } } }
          }
        } } } }
      });
      const control: number[] = []; const variant: number[] = []; const evidence: Array<{ contentItemId: string; arm: string; snapshotId: string; observedAt: string }> = [];
      for (const assignment of assignments) {
        const matching = assignment.contentItem.publishPlans.filter((plan) => {
          const context = asRecord(asRecord(plan.sceneVersion?.scriptVersion?.qualitySnapshot ?? null).generationContext ?? null);
          return asRecord(context.experiment ?? null).assignmentKey === assignment.assignmentKey && plan.platformPost && plan.platformPost.publishedAt >= assignment.assignedAt && plan.platformPost.publishedAt <= end;
        });
        const snapshots = matching.flatMap((plan) => plan.platformPost?.analyticsSnapshots.filter((metric) => metric.observedAt >= plan.platformPost!.publishedAt) ?? []).sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime() || right.revision - left.revision);
        const snapshot = snapshots[0];
        if (!snapshot?.value || !["control", "variant"].includes(assignment.arm)) continue;
        const value = snapshot.value.toNumber();
        if (!Number.isFinite(value)) continue;
        (assignment.arm === "control" ? control : variant).push(value);
        evidence.push({ contentItemId: assignment.contentItemId, arm: assignment.arm, snapshotId: snapshot.id, observedAt: snapshot.observedAt.toISOString() });
      }
      const criteria = asRecord(experiment.successCriteria);
      const comparison = compareExperimentArms(control, variant, experiment.minSampleSize, typeof criteria.minRelativeImprovement === "number" ? criteria.minRelativeImprovement : 0.1, criteria.direction === "lower" ? "lower" : "higher");
      if (!comparison.sufficient) throw new ConflictException({ code: "EXPERIMENT_INSUFFICIENT_SAMPLES", message: `각 그룹에 ${experiment.minSampleSize}건의 가용 지표가 필요합니다. 현재 대조 ${control.length}, 변경 ${variant.length}건입니다.` });
      const changed = await this.prisma.experiment.updateMany({ where: { id: experimentId, status: { in: ["RUNNING", "PAUSED"] } }, data: { status: "COMPLETED", endedAt: end, result: toInputJson({ ...comparison, metric: experiment.targetMetric, platform, periodStart: experiment.startedAt.toISOString(), periodEnd: end.toISOString(), evidence, metricVersion: METRIC_VERSION }) } });
      const completed = await this.prisma.experiment.findUniqueOrThrow({ where: { id: experimentId } });
      if (completed.status !== "COMPLETED") throw new ConflictException("EXPERIMENT_TERMINAL");
      if (userId && changed.count === 1) await this.operations.audit(workspaceId, userId, "experiment.complete", "experiment", experimentId);
      return this.experimentResponse(completed);
    }
    if (input.action === "start") {
      return this.experimentResponse(await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM channels WHERE id = ${experiment.channelId} FOR UPDATE`;
        const current = await tx.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
        if (terminalExperiment.has(current.status)) throw new ConflictException("EXPERIMENT_TERMINAL");
        const conflicting = await tx.experiment.findFirst({ where: { channelId: experiment.channelId, status: "RUNNING", id: { not: experiment.id } } });
        if (conflicting) throw new ConflictException("CONFLICTING_CHANNEL_EXPERIMENT");
        return tx.experiment.update({ where: { id: current.id }, data: { status: "RUNNING", startedAt: current.startedAt ?? new Date() } });
      }));
    }
    const status = input.action === "pause" ? "PAUSED" : input.action === "stop" ? "STOPPED" : "INCONCLUSIVE";
    const terminal = terminalExperiment.has(status);
    return this.experimentResponse(await this.prisma.experiment.update({ where: { id: experiment.id }, data: { status, endedAt: terminal ? new Date() : undefined, stopReason: terminal ? input.reason ?? null : undefined, result: terminal ? { outcome: status.toLocaleLowerCase(), reason: input.reason ?? null } : undefined } }));
  }

  async assignExperiment(workspaceId: string, experimentId: string, raw: unknown): Promise<{ arm: "control" | "variant"; assignmentKey: string }> {
    const input = AssignExperimentRequestSchema.parse(raw);
    const experiment = await this.prisma.experiment.findFirst({ where: { id: experimentId, status: "RUNNING", channel: { workspaceId } } });
    if (!experiment) throw new NotFoundException("RUNNING_EXPERIMENT_NOT_FOUND");
    const content = await this.prisma.contentItem.findFirst({ where: { id: input.contentItemId, channelId: experiment.channelId } });
    if (!content) throw new NotFoundException("CONTENT_ITEM_NOT_FOUND");
    const key = hash(`${experiment.id}:${content.id}`);
    const arm = deterministicExperimentArm(experiment.id, content.id);
    const assignment = await this.prisma.experimentAssignment.upsert({ where: { experimentId_contentItemId: { experimentId: experiment.id, contentItemId: content.id } }, create: { experimentId: experiment.id, contentItemId: content.id, arm, assignmentKey: key }, update: {} });
    return { arm: assignment.arm === "control" ? "control" : "variant", assignmentKey: assignment.assignmentKey };
  }

  async rollback(workspaceId: string, role: string, userId: string, channelId: string, version: number): Promise<{ id: string; version: number }> {
    this.requireOwner(role);
    await this.channel(workspaceId, channelId);
    const previous = await this.prisma.strategyVersion.findUnique({ where: { channelId_version: { channelId, version } } });
    if (!previous) throw new NotFoundException("STRATEGY_VERSION_NOT_FOUND");
    const next = await this.prisma.strategyVersion.aggregate({ where: { channelId }, _max: { version: true } });
    const restored = await this.prisma.strategyVersion.create({ data: { channelId, version: (next._max.version ?? 0) + 1, name: `Rollback of ${previous.name}`, strategy: toInputJson(previous.strategy), promptVersion: previous.promptVersion, appliedAt: new Date() } });
    await this.operations.audit(workspaceId, userId, "strategy.rollback", "strategy_version", restored.id, { restoredFromVersion: version });
    return { id: restored.id, version: restored.version };
  }

  private async applyStrategy(suggestion: { id: string; channelId: string; targetStrategy: Prisma.JsonValue | null }) {
    const target = asRecord(suggestion.targetStrategy);
    if (typeof target.durationSeconds !== "number" || !Number.isFinite(target.durationSeconds) || target.durationSeconds <= 0 || Object.keys(target).some((field) => !["durationSeconds", "maxChangeRatio"].includes(field))) throw new ConflictException("UNSAFE_STRATEGY_FIELD");
    return this.prisma.$transaction(async (tx) => {
      let current = await tx.strategyVersion.aggregate({ where: { channelId: suggestion.channelId }, _max: { version: true } });
      if (!current._max.version) {
        const profile = await tx.platformOutputProfile.findFirst({ where: { channelId: suggestion.channelId, isActive: true }, orderBy: { version: "desc" } });
        if (!profile) throw new ConflictException("OUTPUT_PROFILE_REQUIRED");
        await tx.strategyVersion.create({ data: { channelId: suggestion.channelId, version: 1, name: "Initial channel settings", strategy: { durationSeconds: (profile.minDurationSeconds + profile.maxDurationSeconds) / 2 }, appliedAt: new Date() } });
        current = { _max: { version: 1 } };
      }
      const version = await tx.strategyVersion.create({ data: { channelId: suggestion.channelId, version: (current._max.version ?? 0) + 1, name: "Approved optimization", strategy: toInputJson(target), appliedAt: new Date() } });
      return tx.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status: "APPLIED", appliedAt: new Date(), strategyVersionId: version.id, rollbackStrategyVersionId: (current._max.version ?? 0) > 0 ? (await tx.strategyVersion.findUnique({ where: { channelId_version: { channelId: suggestion.channelId, version: current._max.version ?? 0 } }, select: { id: true } }))?.id ?? null : null } });
    });
  }

  private async channel(workspaceId: string, channelId: string) { const channel = await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId } }); if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND"); return channel; }
  private requireOwner(role: string): void { if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED"); }
  private suggestionResponse(suggestion: { id: string; channelId: string; status: string; title: string; rationale: string; evidence: Prisma.JsonValue; targetStrategy: Prisma.JsonValue | null; sampleSize: number; confidenceScore: Prisma.Decimal | null; expectedImpact: Prisma.JsonValue | null; risk: Prisma.JsonValue | null; expiresAt: Date | null; createdAt: Date; appliedAt: Date | null }): OptimizationSuggestionResponse { return OptimizationSuggestionResponseSchema.parse({ ...suggestion, confidenceScore: suggestion.confidenceScore ? Number(suggestion.confidenceScore) : null, expiresAt: suggestion.expiresAt?.toISOString() ?? null, createdAt: suggestion.createdAt.toISOString(), appliedAt: suggestion.appliedAt?.toISOString() ?? null }); }
  private experimentResponse(experiment: { id: string; channelId: string; status: string; name: string; hypothesis: string; targetMetric: string | null; minSampleSize: number; allocation: Prisma.JsonValue; successCriteria: Prisma.JsonValue; stopCriteria: Prisma.JsonValue | null; result: Prisma.JsonValue | null; stopReason: string | null; startedAt: Date | null; endedAt: Date | null }): ExperimentResponse { return ExperimentResponseSchema.parse({ ...experiment, startedAt: experiment.startedAt?.toISOString() ?? null, endedAt: experiment.endedAt?.toISOString() ?? null }); }
}
