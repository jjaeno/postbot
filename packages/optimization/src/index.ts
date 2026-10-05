import { createHash } from "node:crypto";
import type { Prisma } from "@postbot/database";

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
  return { experimentId: experiment.id, arm: assignment.arm, assignmentKey: assignment.assignmentKey, strategy: { durationSeconds: strategy.durationSeconds } };
};

export const compareExperimentArms = (control: readonly number[], variant: readonly number[], minimumPerArm: number, minRelativeImprovement: number, direction: "higher" | "lower") => {
  const mean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const controlMean = mean(control); const variantMean = mean(variant);
  const sufficient = control.length >= minimumPerArm && variant.length >= minimumPerArm;
  const relativeChange = controlMean !== null && controlMean !== 0 && variantMean !== null ? (variantMean - controlMean) / Math.abs(controlMean) : null;
  const improvement = relativeChange === null ? null : relativeChange * (direction === "higher" ? 1 : -1);
  const winner = !sufficient || improvement === null ? "inconclusive" : improvement >= minRelativeImprovement ? "variant" : improvement <= -minRelativeImprovement ? "control" : "inconclusive";
  return { control: { sampleSize: control.length, mean: controlMean }, variant: { sampleSize: variant.length, mean: variantMean }, minimumPerArm, relativeChange, direction, minRelativeImprovement, winner, sufficient, hypothesisOnly: true, causalClaim: false };
};
