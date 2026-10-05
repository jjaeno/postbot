import { describe, expect, it } from "vitest";
import { assetNeedsReview, checksumSha256, isLicenseAllowedForGeneration, sceneAssetUsageKey, readAssetUsagePurpose } from "./index.js";

describe("asset library rules", () => {
  it("keeps scene-scoped retries stable without overwriting older scene usages", () => {
    const purpose = `scene-image:INSTAGRAM:${"a".repeat(80)}`;
    expect(sceneAssetUsageKey(purpose, "scene-1")).toBe(sceneAssetUsageKey(purpose, "scene-1"));
    expect(sceneAssetUsageKey(purpose, "scene-1")).not.toBe(sceneAssetUsageKey(purpose, "scene-2"));
    expect(sceneAssetUsageKey(purpose, "scene-1").length).toBeLessThanOrEqual(120);
    expect(readAssetUsagePurpose({ purpose: sceneAssetUsageKey(purpose, "scene-1"), usageSnapshot: { originalPurpose: purpose } })).toBe(purpose);
    expect(readAssetUsagePurpose({ purpose: "tts-narration", usageSnapshot: null })).toBe("tts-narration");
  });
  it("produces a stable SHA-256 checksum for deduplication", () => {
    expect(checksumSha256(new TextEncoder().encode("asset"))).toBe(checksumSha256(new TextEncoder().encode("asset")));
  });

  it("allows only commercially usable verified derivative licenses", () => {
    expect(isLicenseAllowedForGeneration({ status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null })).toBe(true);
    expect(assetNeedsReview({ status: "unknown", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null })).toBe(true);
  });
});
