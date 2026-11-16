import type { Prisma } from "@postbot/database";

export const jsonRecord = (value: Prisma.JsonValue | null | undefined): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function publishedFeatures(value: Prisma.JsonValue | null): (Prisma.JsonObject & { sceneVersionId: string; scriptVersionId: string; actualDurationSeconds: number }) | null {
  const data = jsonRecord(value);
  return data.version === "published-features-v1" && typeof data.sceneVersionId === "string" && typeof data.scriptVersionId === "string" && typeof data.actualDurationSeconds === "number" && Number.isFinite(data.actualDurationSeconds) && data.actualDurationSeconds > 0 ? { ...data, sceneVersionId: data.sceneVersionId, scriptVersionId: data.scriptVersionId, actualDurationSeconds: data.actualDurationSeconds } : null;
}

export function observationCohortKey(snapshot: { platform: string; metric: string; mappingVersion: string; unit: string | null; aggregation: string | null; observationKind: string; periodStart: Date | null; periodEnd: Date | null; collectedAt: Date; publishedAt: Date; rawSnapshot: Prisma.JsonValue }): string | null {
  if (jsonRecord(snapshot.rawSnapshot).collectionPending === true) return null;
  const definition = `${snapshot.platform}:${snapshot.metric}:${snapshot.mappingVersion}:${snapshot.unit}:${snapshot.aggregation}`;
  if (snapshot.observationKind === "PERIOD_TOTAL" && snapshot.periodStart && snapshot.periodEnd && snapshot.periodEnd > snapshot.periodStart) return `${definition}:period:${snapshot.periodStart.toISOString()}:${snapshot.periodEnd.toISOString()}`;
  if (snapshot.observationKind === "LIFETIME_SNAPSHOT") {
    const age = (snapshot.collectedAt.getTime() - snapshot.publishedAt.getTime()) / 1000;
    const hour = Math.round(age / 3600);
    // This is a measured age bucket, never the sync's requested historical age.
    if (hour >= 1 && Math.abs(age - hour * 3600) <= 300) return `${definition}:lifetime-at-age:${hour}h:tolerance=300s`;
  }
  return null;
}

export const durationCompliance = (actual: number, target: number, tolerance: number): boolean => Number.isFinite(actual) && Number.isFinite(target) && actual > 0 && target > 0 && Number.isFinite(tolerance) && tolerance >= 0 && Math.abs(actual - target) <= tolerance;
