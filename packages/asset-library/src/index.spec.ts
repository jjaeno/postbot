import { describe, expect, it } from "vitest";
import { assetNeedsReview, checksumSha256, isLicenseAllowedForGeneration } from "./index.js";

describe("asset library rules", () => {
  it("produces a stable SHA-256 checksum for deduplication", () => {
    expect(checksumSha256(new TextEncoder().encode("asset"))).toBe(checksumSha256(new TextEncoder().encode("asset")));
  });

  it("allows only commercially usable verified derivative licenses", () => {
    expect(isLicenseAllowedForGeneration({ status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null })).toBe(true);
    expect(assetNeedsReview({ status: "unknown", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null })).toBe(true);
  });
});
