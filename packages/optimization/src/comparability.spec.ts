import { describe, expect, it } from "vitest";
import { observationCohortKey, durationCompliance, publishedFeatures } from "./comparability.js";
import { compareExperimentArms } from "./index.js";
const input = { platform: "YOUTUBE", metric: "views", mappingVersion: "v3", unit: "count", aggregation: "sum", observationKind: "PERIOD_TOTAL", periodStart: new Date("2026-11-01T08:00:00Z"), periodEnd: new Date("2026-11-02T08:00:00Z"), collectedAt: new Date("2026-11-05T08:00:00Z"), publishedAt: new Date("2026-11-01T08:00:00Z"), rawSnapshot: {} };
describe("comparable observations and frozen features", () => {
  it("compares complete relative calendar days across dates and DST without calling them exact 24 hours", () => {
    const rawSnapshot = { reportingTimezone: "America/Los_Angeles", coverageVerified: true };
    const first = { ...input, publishedAt: new Date("2026-10-31T19:00:00Z"), periodStart: new Date("2026-11-01T07:00:00Z"), periodEnd: new Date("2026-11-02T08:00:00Z"), rawSnapshot };
    const later = { ...input, publishedAt: new Date("2026-11-05T19:00:00Z"), periodStart: new Date("2026-11-06T08:00:00Z"), periodEnd: new Date("2026-11-07T08:00:00Z"), rawSnapshot };
    expect(observationCohortKey(first)).toBe(observationCohortKey(later));
    expect(observationCohortKey(first, "CALENDAR_PERIOD")).not.toBe(observationCohortKey(later, "CALENDAR_PERIOD"));
    expect(observationCohortKey({ ...first, periodStart: first.publishedAt })).toBeNull();
    expect(observationCohortKey({ ...first, rawSnapshot: { ...rawSnapshot, coverageVerified: false } })).toBeNull();
  });
  it("never mixes platforms, metric definitions or represented periods", () => {
    const key = observationCohortKey(input);
    expect(observationCohortKey({ ...input, platform: "INSTAGRAM" })).not.toBe(key);
    expect(observationCohortKey({ ...input, mappingVersion: "v2" })).not.toBe(key);
    expect(observationCohortKey({ ...input, periodEnd: new Date("2026-11-03T08:00:00Z") })).not.toBe(key);
    expect(observationCohortKey({ ...input, observationKind: "LEGACY_UNKNOWN" })).toBeNull();
    expect(observationCohortKey({ ...input, rawSnapshot: { collectionPending: true } })).toBeNull();
  });
  it("labels late cumulative values by actual age, not the requested 24-hour snapshot", () => {
    const lifetime = { ...input, observationKind: "LIFETIME_SNAPSHOT", rawSnapshot: { requestedAgeHours: 24 } };
    expect(observationCohortKey(lifetime)).toContain("96h");
    expect(observationCohortKey({ ...lifetime, collectedAt: new Date(input.publishedAt.getTime() + 24 * 3_600_000) })).toContain("24h");
    expect(observationCohortKey({ ...lifetime, collectedAt: new Date(input.publishedAt.getTime() + 24.5 * 3_600_000) })).toBeNull();
  });
  it("requires real published version and final-duration evidence", () => {
    expect(publishedFeatures(null)).toBeNull();
    expect(publishedFeatures({ version: "legacy-publication-unknown" })).toBeNull();
    expect(durationCompliance(30, 33, 1)).toBe(false);
    expect(durationCompliance(32.5, 33, 1)).toBe(true);
  });
  it("does not declare winners from variance, imbalance or outliers", () => {
    expect(compareExperimentArms([10, 1000], [100, 1100], 2, 0.1, "higher").winner).toBe("inconclusive");
    expect(compareExperimentArms([100, 100], [200, 200, 200, 200, 200], 2, 0.1, "higher")).toMatchObject({ winner: "inconclusive", balanced: false });
    expect(compareExperimentArms([100, 100, 100, 100], [100, 100, 100, 100000], 2, 0.1, "higher")).toMatchObject({ winner: "inconclusive", variant: { outliers: 1 }, uncertainty: { calibratedConfidenceLevel: null } });
  });
});
