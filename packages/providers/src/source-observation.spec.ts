import { describe, expect, it } from "vitest";
import { sourceObservation } from "./source-observation.js";
const input = { url: "https://www.loc.gov/item/rome", title: "Rome", summary: "history", sourceName: "LOC", sourceKind: "OFFICIAL", snapshot: { body: "Rome fell because institutions weakened.", contentScope: "FULL_TEXT", evidence: [], visualReferences: null } };
describe("immutable source observation identity", () => {
  it("ignores mutable selection and observation times but distinguishes source, body and evidence changes", () => {
    const first = sourceObservation(input);
    expect(sourceObservation({ ...input, snapshot: { ...input.snapshot, collectedAt: "2026-11-21T00:00:00Z", reservationRunId: "run", evaluation: { score: 1 } } }).id).toBe(first.id);
    expect(sourceObservation({ ...input, url: "https://other.test/rome" }).id).not.toBe(first.id);
    expect(sourceObservation({ ...input, snapshot: { ...input.snapshot, body: "Another source statement." } }).id).not.toBe(first.id);
    expect(sourceObservation({ ...input, snapshot: { ...input.snapshot, visualReferences: { references: ["https://www.loc.gov/image.jpg"] } } }).id).not.toBe(first.id);
  });
  it("marks failed or mismatching full text as summary and keeps conflicts distinct", () => {
    expect(sourceObservation({ ...input, snapshot: { ...input.snapshot, reliability: { fingerprint: "invalid" } } }).snapshot.contentScope).toBe("SUMMARY");
    expect(sourceObservation({ ...input, snapshot: { ...input.snapshot, reliability: { evidenceFailure: "ORIGINAL_UNAVAILABLE" } } }).snapshot.contentScope).toBe("SUMMARY");
    expect(sourceObservation({ ...input, snapshot: { ...input.snapshot, reliability: { researchState: "CONFLICTING_EVIDENCE" } } }).id).not.toBe(sourceObservation(input).id);
  });
});
