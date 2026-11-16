import { createHash } from "node:crypto";
import type { Prisma } from "@postbot/database";
export { observationCohortKey, publishedFeatures, durationCompliance } from "./comparability.js";

export const deterministicExperimentArm = (experimentId: string, contentItemId: string): "control" | "variant" =>
  Number.parseInt(createHash("sha256").update(`${experimentId}:${contentItemId}`).digest("hex").slice(0, 8), 16) % 2 === 0 ? "control" : "variant";

const object = (value: Prisma.JsonValue | null): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const assignProductionExperiment = async (tx: Prisma.TransactionClient, channelId: string, contentItemId: string, platform: string | undefined) => {
  await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
  const experiment = await tx.experiment.findFirst({ where: { channelId, status: "RUNNING" }, orderBy: { startedAt: "desc" } });
  if (!experiment?.startedAt) return null;
  const allocation = object(experiment.allocation);
  const channel = await tx.channel.findUniqueOrThrow({ where: { id: channelId } });
  const content = await tx.contentItem.findUniqueOrThrow({ where: { id: contentItemId } });
  const settings = object(channel.optimizationSettings);
  const protectedTerms = [settings.protectedTopics, settings.protectedBrandPhrases, settings.prohibitedPatterns].flatMap((values) => Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  if (protectedTerms.some((term) => `${content.title} ${content.topicKey}`.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return null;
  const periodDays = typeof allocation.periodDays === "number" ? allocation.periodDays : 30;
  if (allocation.platform !== platform || Date.now() >= experiment.startedAt.getTime() + periodDays * 86_400_000) return null;
  const arm = deterministicExperimentArm(experiment.id, contentItemId);
  const existing = await tx.experimentAssignment.findUnique({ where: { experimentId_contentItemId: { experimentId: experiment.id, contentItemId } } });
  const stop = object(experiment.stopCriteria);
  if (!existing && typeof stop.maxAssignments === "number" && await tx.experimentAssignment.count({ where: { experimentId: experiment.id } }) >= stop.maxAssignments) return null;
  const key = createHash("sha256").update(`${experiment.id}:${contentItemId}`).digest("hex");
  const assignment = await tx.experimentAssignment.upsert({ where: { experimentId_contentItemId: { experimentId: experiment.id, contentItemId } }, create: { experimentId: experiment.id, contentItemId, arm, assignmentKey: key }, update: {} });
  const strategy = object(allocation[assignment.arm] ?? null);
  if (typeof strategy.durationSeconds !== "number") throw new Error("INVALID_EXPERIMENT_STRATEGY");
  const profile = await tx.platformOutputProfile.findFirst({ where: { channelId, platform: platform === "YOUTUBE" || platform === "INSTAGRAM" || platform === "TIKTOK" ? platform : undefined, isActive: true }, orderBy: { version: "desc" } });
  const control = object(allocation.control ?? null);
  if (!profile || strategy.durationSeconds < profile.minDurationSeconds || strategy.durationSeconds > profile.maxDurationSeconds || typeof control.durationSeconds !== "number" || Math.abs(strategy.durationSeconds / control.durationSeconds - 1) > (typeof settings.maxChangeRatio === "number" ? settings.maxChangeRatio : 0.2)) throw new Error("EXPERIMENT_DURATION_OUTSIDE_ALLOWED_RANGE");
  return { experimentId: experiment.id, arm: assignment.arm, assignmentKey: assignment.assignmentKey, durationToleranceSeconds: typeof allocation.durationToleranceSeconds === "number" ? allocation.durationToleranceSeconds : 1, strategy: { durationSeconds: strategy.durationSeconds } };
};

export const compareExperimentArms = (control: readonly number[], variant: readonly number[], minimumPerArm: number, minRelativeImprovement: number, direction: "higher" | "lower") => {
  const summarize = (input: readonly number[]) => {
    const values = input.filter(Number.isFinite); const ordered = [...values].sort((a, b) => a - b);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const variance = mean !== null && values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : null;
    const quantile = (fraction: number): number | null => {
      if (!ordered.length) return null;
      const position = (ordered.length - 1) * fraction; const low = Math.floor(position); const high = Math.ceil(position);
      return ordered[low]! + (ordered[high]! - ordered[low]!) * (position - low);
    };
    const q1 = quantile(0.25); const q3 = quantile(0.75);
    const outliers = q1 !== null && q3 !== null ? values.filter((value) => value < q1 - 1.5 * (q3 - q1) || value > q3 + 1.5 * (q3 - q1)).length : 0;
    return { sampleSize: values.length, mean, variance, standardDeviation: variance === null ? null : Math.sqrt(variance), median: quantile(0.5), outliers, invalidValues: input.length - values.length };
  };
  const c = summarize(control); const v = summarize(variant);
  const sufficient = c.sampleSize >= minimumPerArm && v.sampleSize >= minimumPerArm;
  const relativeChange = c.mean !== null && c.mean !== 0 && v.mean !== null ? (v.mean - c.mean) / Math.abs(c.mean) : null;
  const standardError = c.variance !== null && v.variance !== null ? Math.sqrt(c.variance / c.sampleSize + v.variance / v.sampleSize) : null;
  const difference = c.mean !== null && v.mean !== null ? (v.mean - c.mean) * (direction === "higher" ? 1 : -1) : null;
  const range = difference !== null && standardError !== null ? [difference - 2 * standardError, difference + 2 * standardError] : null;
  const balanced = Math.max(c.sampleSize, v.sampleSize) <= Math.max(1, Math.min(c.sampleSize, v.sampleSize)) * 2;
  const quality = balanced && c.outliers + v.outliers === 0 && c.invalidValues + v.invalidValues === 0;
  const threshold = c.mean === null ? null : Math.abs(c.mean) * minRelativeImprovement;
  const winner = !sufficient || !quality || relativeChange === null || !range || threshold === null ? "inconclusive" : range[0]! >= threshold ? "variant" : range[1]! <= -threshold ? "control" : "inconclusive";
  return { control: c, variant: v, minimumPerArm, relativeChange, direction, minRelativeImprovement, winner, sufficient, balanced, uncertainty: { method: "TWO_STANDARD_ERROR_DESCRIPTIVE", standardError, directionalMeanDifference: difference, range, calibratedConfidenceLevel: null }, decisionLimitations: ["OBSERVATIONAL_ASSOCIATION_NOT_CAUSATION", ...(!balanced ? ["ALLOCATION_IMBALANCE"] : []), ...(c.outliers + v.outliers ? ["OUTLIERS_PRESENT"] : [])], hypothesisOnly: true, causalClaim: false };
};
