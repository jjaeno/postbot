import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import { AssignExperimentRequestSchema, CreateExperimentRequestSchema, ExperimentActionRequestSchema, ExperimentResponseSchema, GenerateSuggestionsRequestSchema, OptimizationSettingsSchema, OptimizationSuggestionResponseSchema, SuggestionActionRequestSchema, UpdateOptimizationSettingsRequestSchema, type ExperimentResponse, type OptimizationSettings, type OptimizationSuggestionResponse } from "@postbot/contracts";
import { createHash } from "node:crypto";

const MIN_SAMPLE_SIZE = 4;
const RULE_VERSION = "optimization-rules-v1";
const METRIC_VERSION = "analytics-mapping-v1";
const terminalSuggestion = new Set(["REJECTED", "APPLIED", "EXPIRED"]);
const terminalExperiment = new Set(["COMPLETED", "CANCELLED", "STOPPED", "INCONCLUSIVE"]);
const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const toInputJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export const deterministicExperimentArm = (experimentId: string, contentItemId: string): "control" | "variant" => Number.parseInt(hash(`${experimentId}:${contentItemId}`).slice(0, 8), 16) % 2 === 0 ? "control" : "variant";
const isProtected = (content: { title: string; topicKey: string }, settings: OptimizationSettings): boolean => {
  const text = `${content.title} ${content.topicKey}`.toLocaleLowerCase();
  return [...settings.protectedTopics, ...settings.protectedBrandPhrases, ...settings.prohibitedPatterns].some((entry) => text.includes(entry.toLocaleLowerCase()));
};

@Injectable()
export class OptimizationService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async getSettings(workspaceId: string, channelId: string): Promise<OptimizationSettings> {
    const channel = await this.channel(workspaceId, channelId);
    return OptimizationSettingsSchema.parse(asRecord(channel.optimizationSettings));
  }

  async updateSettings(workspaceId: string, role: string, raw: unknown): Promise<OptimizationSettings> {
    this.requireOwner(role);
    const input = UpdateOptimizationSettingsRequestSchema.parse(raw);
    await this.channel(workspaceId, input.channelId);
    await this.prisma.channel.update({ where: { id: input.channelId }, data: { optimizationSettings: input.settings } });
    return input.settings;
  }

  async generate(workspaceId: string, raw: unknown): Promise<OptimizationSuggestionResponse> {
    const input = GenerateSuggestionsRequestSchema.parse(raw);
    const existing = await this.prisma.optimizationSuggestion.findUnique({ where: { suggestionKey: hash(input.idempotencyKey) } });
    if (existing) return this.suggestionResponse(existing);
    const channel = await this.channel(workspaceId, input.channelId);
    const settings = OptimizationSettingsSchema.parse(asRecord(channel.optimizationSettings));
    const snapshots = await this.prisma.analyticsMetricSnapshot.findMany({
      where: { metric: input.metric, status: "AVAILABLE", value: { not: null }, observedAt: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, platformPost: { platform: input.platform, publishPlan: { contentItem: { channelId: channel.id } } } },
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

  async suggestionAction(workspaceId: string, role: string, suggestionId: string, raw: unknown): Promise<OptimizationSuggestionResponse> {
    this.requireOwner(role);
    const input = SuggestionActionRequestSchema.parse(raw);
    const suggestion = await this.prisma.optimizationSuggestion.findFirst({ where: { id: suggestionId, channel: { workspaceId } } });
    if (!suggestion) throw new NotFoundException("OPTIMIZATION_SUGGESTION_NOT_FOUND");
    if (terminalSuggestion.has(suggestion.status)) throw new ConflictException("SUGGESTION_TERMINAL");
    if (suggestion.expiresAt && suggestion.expiresAt < new Date()) return this.suggestionResponse(await this.prisma.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status: "EXPIRED", decidedAt: new Date() } }));
    if (input.action === "reject" || input.action === "expire") {
      const status = input.action === "reject" ? "REJECTED" : "EXPIRED";
      const updated = await this.prisma.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status, decidedAt: new Date(), risk: { ...asRecord(suggestion.risk), decisionReason: input.reason ?? null } } });
      return this.suggestionResponse(updated);
    }
    if (input.action === "approve") return this.suggestionResponse(await this.prisma.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status: "APPROVED", decidedAt: new Date() } }));
    if (suggestion.status !== "APPROVED") throw new ConflictException("SUGGESTION_REQUIRES_APPROVAL");
    const applied = await this.applyStrategy(suggestion);
    return this.suggestionResponse(applied);
  }

  async createExperiment(workspaceId: string, role: string, raw: unknown): Promise<ExperimentResponse> {
    this.requireOwner(role);
    const input = CreateExperimentRequestSchema.parse(raw);
    await this.channel(workspaceId, input.channelId);
    const experiment = await this.prisma.experiment.create({ data: { channelId: input.channelId, name: input.name, hypothesis: input.hypothesis, allocation: toInputJson({ control: input.control, variant: input.variant }), successCriteria: toInputJson(input.successCriteria), targetMetric: input.targetMetric, minSampleSize: input.minSampleSize, stopCriteria: input.stopCriteria ? toInputJson(input.stopCriteria) : Prisma.DbNull } });
    return this.experimentResponse(experiment);
  }

  async experimentAction(workspaceId: string, role: string, experimentId: string, raw: unknown): Promise<ExperimentResponse> {
    this.requireOwner(role);
    const input = ExperimentActionRequestSchema.parse(raw);
    const experiment = await this.prisma.experiment.findFirst({ where: { id: experimentId, channel: { workspaceId } } });
    if (!experiment) throw new NotFoundException("EXPERIMENT_NOT_FOUND");
    if (terminalExperiment.has(experiment.status)) throw new ConflictException("EXPERIMENT_TERMINAL");
    if (input.action === "start") {
      const conflicting = await this.prisma.experiment.findFirst({ where: { channelId: experiment.channelId, status: "RUNNING", id: { not: experiment.id } } });
      if (conflicting) throw new ConflictException("CONFLICTING_CHANNEL_EXPERIMENT");
    }
    const status = input.action === "start" ? "RUNNING" : input.action === "pause" ? "PAUSED" : input.action === "stop" ? "STOPPED" : input.action === "inconclusive" ? "INCONCLUSIVE" : "COMPLETED";
    const terminal = terminalExperiment.has(status);
    return this.experimentResponse(await this.prisma.experiment.update({ where: { id: experiment.id }, data: { status, startedAt: input.action === "start" ? new Date() : undefined, endedAt: terminal ? new Date() : undefined, stopReason: terminal ? input.reason ?? null : undefined, result: terminal ? { outcome: status === "COMPLETED" ? "pending-analysis" : status.toLocaleLowerCase(), reason: input.reason ?? null } : undefined } }));
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

  async rollback(workspaceId: string, role: string, channelId: string, version: number): Promise<{ id: string; version: number }> {
    this.requireOwner(role);
    await this.channel(workspaceId, channelId);
    const previous = await this.prisma.strategyVersion.findUnique({ where: { channelId_version: { channelId, version } } });
    if (!previous) throw new NotFoundException("STRATEGY_VERSION_NOT_FOUND");
    const next = await this.prisma.strategyVersion.aggregate({ where: { channelId }, _max: { version: true } });
    const restored = await this.prisma.strategyVersion.create({ data: { channelId, version: (next._max.version ?? 0) + 1, name: `Rollback of ${previous.name}`, strategy: toInputJson(previous.strategy), promptVersion: previous.promptVersion, appliedAt: new Date() } });
    return { id: restored.id, version: restored.version };
  }

  private async applyStrategy(suggestion: { id: string; channelId: string; targetStrategy: Prisma.JsonValue | null }) {
    const target = asRecord(suggestion.targetStrategy);
    if (Object.keys(target).length === 0 || Object.keys(target).some((field) => field !== "durationSeconds")) throw new ConflictException("UNSAFE_STRATEGY_FIELD");
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.strategyVersion.aggregate({ where: { channelId: suggestion.channelId }, _max: { version: true } });
      const version = await tx.strategyVersion.create({ data: { channelId: suggestion.channelId, version: (current._max.version ?? 0) + 1, name: "Approved optimization", strategy: toInputJson(target), appliedAt: new Date() } });
      return tx.optimizationSuggestion.update({ where: { id: suggestion.id }, data: { status: "APPLIED", appliedAt: new Date(), strategyVersionId: version.id, rollbackStrategyVersionId: (current._max.version ?? 0) > 0 ? (await tx.strategyVersion.findUnique({ where: { channelId_version: { channelId: suggestion.channelId, version: current._max.version ?? 0 } }, select: { id: true } }))?.id ?? null : null } });
    });
  }

  private async channel(workspaceId: string, channelId: string) { const channel = await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId } }); if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND"); return channel; }
  private requireOwner(role: string): void { if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED"); }
  private suggestionResponse(suggestion: { id: string; channelId: string; status: string; title: string; rationale: string; evidence: Prisma.JsonValue; targetStrategy: Prisma.JsonValue | null; sampleSize: number; confidenceScore: Prisma.Decimal | null; expectedImpact: Prisma.JsonValue | null; risk: Prisma.JsonValue | null; expiresAt: Date | null; createdAt: Date; appliedAt: Date | null }): OptimizationSuggestionResponse { return OptimizationSuggestionResponseSchema.parse({ ...suggestion, confidenceScore: suggestion.confidenceScore ? Number(suggestion.confidenceScore) : null, expiresAt: suggestion.expiresAt?.toISOString() ?? null, createdAt: suggestion.createdAt.toISOString(), appliedAt: suggestion.appliedAt?.toISOString() ?? null }); }
  private experimentResponse(experiment: { id: string; channelId: string; status: string; name: string; hypothesis: string; targetMetric: string | null; minSampleSize: number; allocation: Prisma.JsonValue; successCriteria: Prisma.JsonValue; stopCriteria: Prisma.JsonValue | null; result: Prisma.JsonValue | null; stopReason: string | null; startedAt: Date | null; endedAt: Date | null }): ExperimentResponse { return ExperimentResponseSchema.parse({ ...experiment, startedAt: experiment.startedAt?.toISOString() ?? null, endedAt: experiment.endedAt?.toISOString() ?? null }); }
}
