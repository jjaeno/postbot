import { describe, expect, it } from "vitest";
import { evaluatePolicy, type PolicyRule } from "./index.js";

const rule: PolicyRule = { platform: "youtube", region: "GLOBAL", version: "1", effectiveAt: "2026-01-01T00:00:00.000Z", checkedAt: "2026-01-01T00:00:00.000Z", maxDurationSeconds: 60, requiredDisclosure: true, restrictedTerms: ["medical advice"], requireVerifiedAssets: true };

describe("evaluatePolicy", () => {
  it("blocks unsupported facts and restricted topics", () => {
    const result = evaluatePolicy(rule, { durationSeconds: 20, description: "medical advice", factsHaveSources: false, hasAiDisclosure: true, assetsVerified: true, duplicateRisk: false });
    expect(result.status).toBe("block");
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["MISSING_SOURCE", "RESTRICTED_TOPIC"]));
  });

  it("requires review for missing disclosure or asset verification", () => {
    expect(evaluatePolicy(rule, { durationSeconds: 20, description: "science", factsHaveSources: true, hasAiDisclosure: false, assetsVerified: false, duplicateRisk: false }).status).toBe("review");
  });

  it("blocks conflicting sources and unverified commercial rights", () => {
    const result = evaluatePolicy({ ...rule, requireCommercialUse: true }, { durationSeconds: 20, description: "AI generated science", factsHaveSources: true, sourceCount: 2, minimumSourceReliability: 0.9, conflictingSources: true, hasAiDisclosure: true, assetsVerified: true, commercialUseVerified: false, duplicateRisk: false });
    expect(result.status).toBe("block");
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["CONFLICTING_SOURCES", "COMMERCIAL_USE_NOT_VERIFIED"]));
  });

  it("forces manual review for sensitive or low-originality content", () => {
    const result = evaluatePolicy({ ...rule, minimumOriginalityScore: 0.7 }, { durationSeconds: 20, description: "AI generated science", factsHaveSources: true, hasAiDisclosure: true, assetsVerified: true, duplicateRisk: false, originalityScore: 0.3, sensitiveTopic: true });
    expect(result.status).toBe("review");
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["DUPLICATE_RISK", "SENSITIVE_TOPIC_REVIEW"]));
  });
});
