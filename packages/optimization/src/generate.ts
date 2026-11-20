import { Prisma, type PrismaClient } from "@postbot/database";
import { createHash } from "node:crypto";
import { observationCohortKey, publishedFeatures } from "./comparability.js";
const MIN_SAMPLE_SIZE = 4;
const RULE_VERSION = "optimization-rules-v3";
const METRIC_VERSION = "analytics-mapping-v3";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const toInputJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const isProtected = (content: { title: string; topicKey: string }, settings: AnalysisSettings): boolean => [...settings.protectedTopics, ...settings.protectedBrandPhrases, ...settings.prohibitedPatterns].some((entry) => `${content.title} ${content.topicKey}`.toLocaleLowerCase().includes(entry.toLocaleLowerCase()));
export type AnalysisSettings = { protectedTopics: string[]; protectedBrandPhrases: string[]; prohibitedPatterns: string[]; autoApplyFields: string[]; maxChangeRatio: number };
export type AnalysisInput = { channelId: string; platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"; metric: string; periodStart: string; periodEnd: string; idempotencyKey: string; comparisonPurpose?: "RELATIVE_AGE" | "CALENDAR_PERIOD" };
export async function generateOptimization(prisma: PrismaClient, channel: { id: string }, input: AnalysisInput, settings: AnalysisSettings) {
  const requestHash = hash(JSON.stringify([input.channelId, input.platform, input.metric, input.periodStart, input.periodEnd, input.comparisonPurpose ?? "RELATIVE_AGE"]));
  const existing = await prisma.optimizationSuggestion.findUnique({ where: { suggestionKey: hash(input.idempotencyKey) } });
  if (existing) { if (existing.channelId !== channel.id || !existing.inputSnapshot || typeof existing.inputSnapshot !== "object" || Array.isArray(existing.inputSnapshot) || existing.inputSnapshot.requestHash !== requestHash) throw new Error("OPTIMIZATION_IDEMPOTENCY_CONFLICT"); return existing; }
    const snapshots = await prisma.analyticsMetricSnapshot.findMany({
      where: { metric: input.metric, status: "AVAILABLE", value: { not: null }, collectedAt: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, platformPost: { platform: input.platform, publishPlan: { contentItem: { channelId: channel.id } } } },
      include: { platformPost: { include: { publishPlan: { include: { contentItem: true } } } } },
      orderBy: [{ observedAt: "desc" }, { revision: "desc" }]
    });
    const usable = snapshots.flatMap((snapshot) => {
      const post = snapshot.platformPost; const features = publishedFeatures(post.productionSnapshot);
      if (!post.publishedAt || post.publicationState !== "PUBLISHED") return [];
      const cohort = observationCohortKey({ ...snapshot, platform: post.platform, publishedAt: post.publishedAt }, input.comparisonPurpose);
      if (!features || !cohort || features.sceneVersionId !== snapshot.sceneVersionId || features.scriptVersionId !== snapshot.scriptVersionId || isProtected(post.publishPlan.contentItem, settings)) return [];
      return [{ snapshot, features, cohort }];
    });
    const latest = new Map<string, typeof usable[number]>();
    for (const item of usable) { const key = `${item.snapshot.platformPostId}:${item.cohort}`; if (!latest.has(key)) latest.set(key, item); }
    const cohorts = new Map<string, typeof usable>();
    for (const item of latest.values()) cohorts.set(item.cohort, [...(cohorts.get(item.cohort) ?? []), item]);
    const selectedCohort = [...cohorts.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
    const comparable = selectedCohort?.[1] ?? [];
    const policyRestricted = input.platform === "YOUTUBE";
    const analysisData = policyRestricted ? [] : comparable;
    const values = analysisData.map((item) => Number(item.snapshot.value));
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const standardDeviation = values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : 0;
    const sorted = [...analysisData].sort((left, right) => Number(right.snapshot.value) - Number(left.snapshot.value) || left.snapshot.platformPostId.localeCompare(right.snapshot.platformPostId));
    const split = Math.max(1, Math.floor(sorted.length / 2)); const top = sorted.slice(0, split); const bottom = sorted.slice(-split);
    const averageDuration = (items: typeof sorted): number => items.length ? items.reduce((sum, item) => sum + item.features.actualDurationSeconds, 0) / items.length : 0;
    const topDuration = averageDuration(top); const bottomDuration = averageDuration(bottom);
    const sufficient = sorted.length >= MIN_SAMPLE_SIZE && standardDeviation > 0 && Math.abs(topDuration - bottomDuration) >= 0.1;
    const targetDuration = bottomDuration ? Math.round(bottomDuration * (1 + Math.max(-settings.maxChangeRatio, Math.min(settings.maxChangeRatio, (topDuration - bottomDuration) / bottomDuration)))) : 0;
    const featureAnalysis = ["topic", "hookType", "sceneTemplates", "transitionsPerMinute", "subtitles", "voice"].map((field) => {
      const groups = new Map<string, number[]>();
      for (const item of analysisData) { const value = item.features[field]; if (value === undefined || value === null) continue; const key = JSON.stringify(value); groups.set(key, [...(groups.get(key) ?? []), Number(item.snapshot.value)]); }
      return { field, status: groups.size >= 2 && [...groups.values()].every((values) => values.length >= MIN_SAMPLE_SIZE) ? "DESCRIPTIVE_HYPOTHESIS" : "HELD_INSUFFICIENT_COMPARABLE_SAMPLES", groups: [...groups.entries()].map(([featureValue, values]) => ({ featureValue, sampleSize: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length })), causalClaim: false };
    });
    const contentIds = [...new Set(comparable.map((item) => item.snapshot.platformPost.publishPlan.contentItemId))];
    const usages = await prisma.providerUsage.findMany({ where: { contentItemId: { in: contentIds } }, select: { id: true, contentItemId: true, provider: true, operation: true, estimatedCost: true, actualCost: true, billingState: true } });
    const productionEvidence = comparable.map((item) => ({ platformPostId: item.snapshot.platformPostId, frozenFeatures: item.features, costs: usages.filter((usage) => usage.contentItemId === item.snapshot.platformPost.publishPlan.contentItemId).map((usage) => ({ usageId: usage.id, provider: usage.provider, operation: usage.operation, estimatedCost: usage.estimatedCost?.toString(), actualCost: usage.actualCost?.toString(), billingState: usage.billingState })), origin: "POSTBOT_PRODUCTION_RECORDS_NOT_YOUTUBE_METRICS" }));
    const evidence = { productionEvidence, policyStatus: policyRestricted ? "YOUTUBE_DERIVED_DATA_RESTRICTED" : "DESCRIPTIVE_ONLY", comparisonPurpose: input.comparisonPurpose ?? "RELATIVE_AGE", nativeObservations: comparable.map(({ snapshot }) => ({ snapshotId: snapshot.id, platformPostId: snapshot.platformPostId, value: snapshot.value?.toString(), unit: snapshot.unit, periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd })), nextAnalysisCondition: "AT_LEAST_4_DISTINCT_COMPARABLE_POSTS_WITH_FRESH_VALID_DATA", nextCheckAt: new Date(Date.now() + 24 * 3600000).toISOString(), platform: input.platform, metric: input.metric, collectionPeriod: { start: input.periodStart, end: input.periodEnd }, observationCohort: selectedCohort?.[0] ?? null, cohortSelection: "LARGEST_COUNT_THEN_KEY_WITHOUT_USING_OUTCOME_VALUES", baseline: policyRestricted ? null : { mean, standardDeviation, bottomDuration, topDuration }, sampleSize: comparable.length, excludedUnknownOrUnbound: snapshots.length - usable.length, excludedOtherObservationCohorts: latest.size - comparable.length, featureAnalysis: policyRestricted ? [] : featureAnalysis, denominator: input.metric === "engagement_rate" ? input.platform === "INSTAGRAM" ? "provider_interactions_per_reached_account" : "provider_interactions_per_view" : input.metric === "average_view_ratio" ? "provider_average_watch_fraction_not_completion_probability" : "provider_metric_definition", completeness: { total: snapshots.length, comparable: comparable.length }, limitations: ["CORRELATION_NOT_CAUSATION", "NO_CALIBRATED_CONFIDENCE_LEVEL", "NO_AUTOMATIC_BROAD_STRATEGY_APPLICATION"], conclusion: policyRestricted ? "YOUTUBE_DERIVED_DATA_RESTRICTED" : sufficient ? "descriptive_hypothesis" : "insufficient_comparable_sample_or_variation" };
    const suggestion = await prisma.optimizationSuggestion.upsert({ where: { suggestionKey: hash(input.idempotencyKey) }, update: {}, create: { channelId: channel.id, suggestionKey: hash(input.idempotencyKey), status: sufficient ? "PENDING" : "HELD", title: sufficient ? "Test a bounded duration adjustment" : "Collect more comparable performance data", rationale: sufficient ? "A descriptive association using immutable published features. Run a bounded experiment before applying a strategy." : "Comparable observations, published features or metric variation are insufficient.", evidence: toInputJson(evidence), sampleSize: comparable.length, confidenceScore: null, expectedImpact: policyRestricted ? Prisma.DbNull : { metric: input.metric, direction: topDuration >= bottomDuration ? "increase" : "decrease", hypothesisOnly: true }, targetStrategy: sufficient && settings.autoApplyFields.includes("durationSeconds") ? toInputJson({ durationSeconds: targetDuration, maxChangeRatio: settings.maxChangeRatio }) : Prisma.DbNull, risk: { requiresExperiment: true, rollback: "restore previous StrategyVersion" }, inputSnapshot: { requestHash, snapshotIds: comparable.map((item) => item.snapshot.id), metricVersion: METRIC_VERSION, ruleVersion: RULE_VERSION }, metricVersion: METRIC_VERSION, ruleVersion: RULE_VERSION, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });

  return suggestion;
}
