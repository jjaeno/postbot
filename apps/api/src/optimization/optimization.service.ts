import { analysisReadiness } from "./schedule-analysis.js";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import { AssignExperimentRequestSchema, CreateExperimentRequestSchema, ExperimentActionRequestSchema, ExperimentResponseSchema, GenerateSuggestionsRequestSchema, OptimizationSettingsSchema, OptimizationSuggestionResponseSchema, SuggestionActionRequestSchema, UpdateOptimizationSettingsRequestSchema, type ExperimentResponse, type OptimizationSettings, type OptimizationSuggestionResponse } from "@postbot/contracts";
import { OperationsService } from "../operations/operations.service.js";
import { generateOptimization, assignProductionExperiment, compareExperimentArms, observationCohortKey, publishedFeatures, durationCompliance } from "@postbot/optimization";
export { deterministicExperimentArm } from "@postbot/optimization";

const RULE_VERSION = "optimization-rules-v3";
const METRIC_VERSION = "analytics-mapping-v3";
const terminalSuggestion = new Set(["REJECTED", "APPLIED", "EXPIRED"]);
const terminalExperiment = new Set(["COMPLETED", "CANCELLED", "STOPPED", "INCONCLUSIVE"]);
const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const toInputJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;


@Injectable()
export class OptimizationService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly operations: OperationsService) {}

  async analysisStatus(workspaceId: string, channelId: string) {
    await this.channel(workspaceId, channelId);
    const { eligible, ...status } = await analysisReadiness(this.prisma, channelId);
    return { ...status, eligibleCohorts: eligible.length };
  }

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
    const channel = await this.channel(workspaceId, input.channelId);
    const settings = OptimizationSettingsSchema.parse(asRecord(channel.optimizationSettings));
    const suggestion = await generateOptimization(this.prisma, channel, input, settings).catch((error: unknown) => {
      if (error instanceof Error && error.message === "OPTIMIZATION_IDEMPOTENCY_CONFLICT") throw new ConflictException(error.message);
      throw error;
    });
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
    if (input.action === "apply" && suggestion.status === "APPLIED") return this.suggestionResponse(suggestion);
    if (terminalSuggestion.has(suggestion.status)) throw new ConflictException("SUGGESTION_TERMINAL");
    if (suggestion.expiresAt && suggestion.expiresAt < new Date()) return this.suggestionResponse(await this.transitionSuggestion(suggestion.id, suggestion.status, { status: "EXPIRED", decidedAt: new Date() }));
    if (input.action === "reject" || input.action === "expire") {
      const status = input.action === "reject" ? "REJECTED" : "EXPIRED";
      const updated = await this.transitionSuggestion(suggestion.id, suggestion.status, { status, decidedAt: new Date(), risk: { ...asRecord(suggestion.risk), decisionReason: input.reason ?? null } });
      await this.operations.audit(workspaceId, userId, `optimization.suggestion.${input.action}`, "optimization_suggestion", updated.id);
      return this.suggestionResponse(updated);
    }
    if (["approve", "apply"].includes(input.action) && asRecord(suggestion.evidence).platform === "YOUTUBE") throw new ConflictException("YOUTUBE_DERIVED_DATA_RESTRICTED");
    if (input.action === "approve" && suggestion.status === "HELD") throw new ConflictException("INSUFFICIENT_COMPARABLE_EVIDENCE");
    if (input.action === "approve") { const updated = await this.transitionSuggestion(suggestion.id, suggestion.status, { status: "APPROVED", decidedAt: new Date() }); await this.operations.audit(workspaceId, userId, "optimization.suggestion.approve", "optimization_suggestion", updated.id); return this.suggestionResponse(updated); }
    if (suggestion.status !== "APPROVED") throw new ConflictException("SUGGESTION_REQUIRES_APPROVAL");
    if (suggestion.ruleVersion !== RULE_VERSION) throw new ConflictException("LEGACY_EVIDENCE_REQUIRES_NEW_SUGGESTION");
    if (suggestion.metricVersion !== METRIC_VERSION) throw new ConflictException("LEGACY_METRIC_REQUIRES_RESYNC_AND_NEW_SUGGESTION");
    const applied = await this.applyStrategy(suggestion);
    if (applied.applied) await this.operations.audit(workspaceId, userId, "optimization.suggestion.apply", "optimization_suggestion", applied.suggestion.id);
    return this.suggestionResponse(applied.suggestion);
  }

  async createExperiment(workspaceId: string, role: string, raw: unknown): Promise<ExperimentResponse> {
    this.requireOwner(role);
    const input = CreateExperimentRequestSchema.parse(raw);
    await this.channel(workspaceId, input.channelId);
    const profile = await this.prisma.platformOutputProfile.findFirst({ where: { channelId: input.channelId, platform: input.platform, isActive: true }, orderBy: { version: "desc" } });
    const settings = await this.getSettings(workspaceId, input.channelId);
    if (!profile || [input.control.durationSeconds, input.variant.durationSeconds].some((value) => value < profile.minDurationSeconds || value > profile.maxDurationSeconds) || Math.abs(input.variant.durationSeconds / input.control.durationSeconds - 1) > settings.maxChangeRatio) throw new ConflictException("EXPERIMENT_DURATION_OUTSIDE_ALLOWED_RANGE");
    const experiment = await this.prisma.experiment.create({ data: { channelId: input.channelId, name: input.name, hypothesis: input.hypothesis, allocation: toInputJson({ control: input.control, variant: input.variant, platform: input.platform, periodDays: input.periodDays, durationToleranceSeconds: input.durationToleranceSeconds ?? 1 }), successCriteria: toInputJson(input.successCriteria), targetMetric: input.targetMetric, minSampleSize: input.minSampleSize, stopCriteria: input.stopCriteria ? toInputJson(input.stopCriteria) : Prisma.DbNull } });
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
      if (platform === "YOUTUBE") throw new ConflictException("YOUTUBE_DERIVED_DATA_RESTRICTED");
      const now = new Date();
      const plannedEnd = new Date(experiment.startedAt.getTime() + (typeof allocation.periodDays === "number" ? allocation.periodDays : 30) * 86_400_000);
      const end = new Date(Math.min(now.getTime(), plannedEnd.getTime()));
      const assignments = await this.prisma.experimentAssignment.findMany({
        where: { experimentId },
        include: { contentItem: { include: { publishPlans: {
          where: { platform, status: "PUBLISHED" },
          include: {
            sceneVersion: { include: { scriptVersion: true } },
            platformPost: { include: { analyticsSnapshots: {
              where: { mappingVersion: { not: "legacy-ambiguous-v1" }, metric: experiment.targetMetric ?? "", status: "AVAILABLE", value: { not: null }, collectedAt: { gte: experiment.startedAt, lte: now } },
              orderBy: [{ observedAt: "desc" }, { revision: "desc" }]
            } } }
          }
        } } } }
      });
      const records: Array<{ assignment: typeof assignments[number]; snapshot: NonNullable<typeof assignments[number]["contentItem"]["publishPlans"][number]["platformPost"]>["analyticsSnapshots"][number]; features: NonNullable<ReturnType<typeof publishedFeatures>>; cohort: string }> = [];
      for (const assignment of assignments) {
        if (!["control", "variant"].includes(assignment.arm)) continue;
        const target = asRecord(allocation[assignment.arm] as Prisma.JsonValue ?? null).durationSeconds;
        const tolerance = typeof allocation.durationToleranceSeconds === "number" ? allocation.durationToleranceSeconds : 1;
        for (const plan of assignment.contentItem.publishPlans) {
          const post = plan.platformPost; const features = post ? publishedFeatures(post.productionSnapshot) : null;
          const featureExperiment = asRecord(features?.experiment ?? null);
          if (!post?.publishedAt || post.publicationState !== "PUBLISHED" || !features || features.platform !== platform || features.sceneVersionId !== plan.sceneVersionId || featureExperiment.assignmentKey !== assignment.assignmentKey || featureExperiment.compliant !== true || typeof target !== "number" || !durationCompliance(features.actualDurationSeconds, target, tolerance) || post.publishedAt < assignment.assignedAt || post.publishedAt > end) continue;
          for (const snapshot of post.analyticsSnapshots) {
            const cohort = observationCohortKey({ ...snapshot, platform: post.platform, publishedAt: post.publishedAt });
            if (cohort && snapshot.sceneVersionId === features.sceneVersionId && snapshot.scriptVersionId === features.scriptVersionId) records.push({ assignment, snapshot, features, cohort });
          }
        }
      }
      records.sort((left, right) => right.snapshot.observedAt.getTime() - left.snapshot.observedAt.getTime() || right.snapshot.revision - left.snapshot.revision);
      const latest = new Map<string, typeof records[number]>();
      for (const item of records) { const key = `${item.assignment.id}:${item.cohort}`; if (!latest.has(key)) latest.set(key, item); }
      const groups = new Map<string, Array<typeof records[number]>>();
      for (const item of latest.values()) groups.set(item.cohort, [...(groups.get(item.cohort) ?? []), item]);
      const selected = [...groups.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
      const control: number[] = []; const variant: number[] = [];
      const evidence: Array<{ contentItemId: string; arm: string; snapshotId: string; observedAt: string; sceneVersionId: string; scriptVersionId: string; actualDurationSeconds: number }> = [];
      for (const item of selected?.[1] ?? []) {
        if (item.snapshot.value === null) continue;
        const value = item.snapshot.value.toNumber(); if (!Number.isFinite(value)) continue;
        (item.assignment.arm === "control" ? control : variant).push(value);
        evidence.push({ contentItemId: item.assignment.contentItemId, arm: item.assignment.arm, snapshotId: item.snapshot.id, observedAt: item.snapshot.observedAt.toISOString(), sceneVersionId: item.features.sceneVersionId, scriptVersionId: item.features.scriptVersionId, actualDurationSeconds: item.features.actualDurationSeconds });
      }
      const criteria = asRecord(experiment.successCriteria);
      const comparison = compareExperimentArms(control, variant, experiment.minSampleSize, typeof criteria.minRelativeImprovement === "number" ? criteria.minRelativeImprovement : 0.1, criteria.direction === "lower" ? "lower" : "higher");
      if (!comparison.sufficient) throw new ConflictException({ code: "EXPERIMENT_INSUFFICIENT_SAMPLES", message: `각 그룹에 ${experiment.minSampleSize}건의 가용 지표가 필요합니다. 현재 대조 ${control.length}, 변경 ${variant.length}건입니다.` });
      const stop = asRecord(experiment.stopCriteria);
      const capReached = typeof stop.maxAssignments === "number" && assignments.length >= stop.maxAssignments;
      if (now < plannedEnd && !capReached) throw new ConflictException({ code: "EXPERIMENT_NOT_READY_FOR_FINAL_ANALYSIS", message: "Wait for the predefined observation period or assignment cap before final analysis." });
      const coverage = evidence.length / Math.max(1, assignments.length);
      const changed = await this.prisma.experiment.updateMany({ where: { id: experimentId, status: { in: ["RUNNING", "PAUSED"] } }, data: { status: "COMPLETED", endedAt: now, result: toInputJson({ ...comparison, winner: coverage >= 0.8 ? comparison.winner : "inconclusive", assignmentCoverage: coverage, excludedAssignments: assignments.length - evidence.length, observationCohort: selected?.[0] ?? null, cohortSelection: "LARGEST_COUNT_THEN_KEY_WITHOUT_USING_OUTCOME_VALUES", stoppingRule: capReached ? "PREDEFINED_ASSIGNMENT_CAP" : "PREDEFINED_PERIOD_END", analyzedAt: now.toISOString(), metric: experiment.targetMetric, platform, periodStart: experiment.startedAt.toISOString(), periodEnd: end.toISOString(), evidence, metricVersion: METRIC_VERSION }) } });
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
    const platform = asRecord(experiment.allocation).platform;
    const assignment = await this.prisma.$transaction((tx) => assignProductionExperiment(tx, experiment.channelId, content.id, typeof platform === "string" ? platform : undefined));
    if (!assignment) throw new ConflictException("EXPERIMENT_ASSIGNMENT_NOT_ELIGIBLE");
    return { arm: assignment.arm === "control" ? "control" : "variant", assignmentKey: assignment.assignmentKey };
  }

  async rollback(workspaceId: string, role: string, userId: string, channelId: string, version: number): Promise<{ id: string; version: number }> {
    this.requireOwner(role);
    await this.channel(workspaceId, channelId);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const previous = await tx.strategyVersion.findUnique({ where: { channelId_version: { channelId, version } } });
      if (!previous) throw new NotFoundException("STRATEGY_VERSION_NOT_FOUND");
      const latest = await tx.strategyVersion.findFirst({ where: { channelId }, orderBy: { version: "desc" } });
      if (latest && JSON.stringify(latest.strategy) === JSON.stringify(previous.strategy)) return { restored: latest, changed: false };
      const restored = await tx.strategyVersion.create({ data: { channelId, version: (latest?.version ?? 0) + 1, name: `Rollback of ${previous.name}`, strategy: toInputJson(previous.strategy), promptVersion: previous.promptVersion, appliedAt: new Date() } });
      return { restored, changed: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (result.changed) await this.operations.audit(workspaceId, userId, "strategy.rollback", "strategy_version", result.restored.id, { restoredFromVersion: version });
    return { id: result.restored.id, version: result.restored.version };
  }

  private async transitionSuggestion(id: string, status: Prisma.OptimizationSuggestionGetPayload<Record<string, never>>["status"], data: Prisma.OptimizationSuggestionUpdateManyMutationInput) {
    const changed = await this.prisma.optimizationSuggestion.updateMany({ where: { id, status }, data });
    if (changed.count !== 1) throw new ConflictException("SUGGESTION_STATE_CHANGED");
    return this.prisma.optimizationSuggestion.findUniqueOrThrow({ where: { id } });
  }

  private async applyStrategy(suggestion: { id: string; channelId: string; targetStrategy: Prisma.JsonValue | null }) {
    const target = asRecord(suggestion.targetStrategy);
    if (typeof target.durationSeconds !== "number" || !Number.isFinite(target.durationSeconds) || target.durationSeconds <= 0 || Object.keys(target).some((field) => !["durationSeconds", "maxChangeRatio"].includes(field))) throw new ConflictException("UNSAFE_STRATEGY_FIELD");
    const duration = target.durationSeconds;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${suggestion.channelId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM optimization_suggestions WHERE id = ${suggestion.id} FOR UPDATE`;
      const locked = await tx.optimizationSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
      if (locked.status === "APPLIED") return { suggestion: locked, applied: false };
      if (locked.status !== "APPROVED" || locked.expiresAt && locked.expiresAt <= new Date()) throw new ConflictException("SUGGESTION_REQUIRES_CURRENT_APPROVAL");
      if (locked.sampleSize < 4 || locked.ruleVersion !== RULE_VERSION || locked.metricVersion !== METRIC_VERSION || asRecord(locked.evidence).platform === "YOUTUBE") throw new ConflictException("CURRENT_COMPARABLE_EVIDENCE_REQUIRED");
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: suggestion.channelId } });
      const settings = OptimizationSettingsSchema.parse(asRecord(channel.optimizationSettings));
      if (!settings.autoApplyFields.includes("durationSeconds")) throw new ConflictException("STRATEGY_FIELD_NOT_CURRENTLY_ALLOWED");
      const profiles = await tx.platformOutputProfile.findMany({ where: { channelId: channel.id, isActive: true }, orderBy: { version: "desc" } });
      const seen = new Set<string>(); const latestProfiles = profiles.filter((profile) => { if (seen.has(profile.platform)) return false; seen.add(profile.platform); return true; });
      if (!latestProfiles.length || latestProfiles.some((profile) => duration < profile.minDurationSeconds || duration > profile.maxDurationSeconds)) throw new ConflictException("STRATEGY_DURATION_OUTSIDE_CURRENT_PROFILE");
      let current = await tx.strategyVersion.findFirst({ where: { channelId: channel.id }, orderBy: { version: "desc" } });
      const baseline = current ? asRecord(current.strategy).durationSeconds : ((latestProfiles[0]?.minDurationSeconds ?? 0) + (latestProfiles[0]?.maxDurationSeconds ?? 0)) / 2;
      if (typeof baseline !== "number" || baseline <= 0 || Math.abs(duration - baseline) / baseline > settings.maxChangeRatio + 1e-9) throw new ConflictException("STRATEGY_CHANGE_EXCEEDS_CURRENT_LIMIT");
      if (!current) current = await tx.strategyVersion.create({ data: { channelId: channel.id, version: 1, name: "Initial channel settings", strategy: { durationSeconds: baseline }, appliedAt: new Date() } });
      const next = await tx.strategyVersion.create({ data: { channelId: channel.id, version: current.version + 1, name: "Approved optimization", strategy: toInputJson(target), appliedAt: new Date() } });
      const applied = await tx.optimizationSuggestion.update({ where: { id: locked.id }, data: { status: "APPLIED", appliedAt: new Date(), strategyVersionId: next.id, rollbackStrategyVersionId: current.id } });
      return { suggestion: applied, applied: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }


  private async channel(workspaceId: string, channelId: string) { const channel = await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId } }); if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND"); return channel; }
  private requireOwner(role: string): void { if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED"); }
  private suggestionResponse(suggestion: { id: string; channelId: string; status: string; title: string; rationale: string; evidence: Prisma.JsonValue; targetStrategy: Prisma.JsonValue | null; sampleSize: number; confidenceScore: Prisma.Decimal | null; expectedImpact: Prisma.JsonValue | null; risk: Prisma.JsonValue | null; expiresAt: Date | null; createdAt: Date; appliedAt: Date | null }): OptimizationSuggestionResponse { return OptimizationSuggestionResponseSchema.parse({ ...suggestion, confidenceScore: suggestion.confidenceScore ? Number(suggestion.confidenceScore) : null, expiresAt: suggestion.expiresAt?.toISOString() ?? null, createdAt: suggestion.createdAt.toISOString(), appliedAt: suggestion.appliedAt?.toISOString() ?? null }); }
  private experimentResponse(experiment: { id: string; channelId: string; status: string; name: string; hypothesis: string; targetMetric: string | null; minSampleSize: number; allocation: Prisma.JsonValue; successCriteria: Prisma.JsonValue; stopCriteria: Prisma.JsonValue | null; result: Prisma.JsonValue | null; stopReason: string | null; startedAt: Date | null; endedAt: Date | null }): ExperimentResponse { return ExperimentResponseSchema.parse({ ...experiment, startedAt: experiment.startedAt?.toISOString() ?? null, endedAt: experiment.endedAt?.toISOString() ?? null }); }
}
