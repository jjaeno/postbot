import { describe, expect, it, vi } from "vitest";
import { ReviewAssetLicenseRequestSchema, type ContentReviewResponse } from "@postbot/contracts";
import { ReviewService } from "./review.service.js";
import type { ReviewRepository } from "./review.repository.js";

describe("manual rights evidence", () => {
  const input = { assetId: "asset-1", status: "VERIFIED", proofUrl: "https://example.com/license", licenseName: "Reviewed license", commercialUseAllowed: true, derivativeAllowed: true };
  it("requires both commercial and derivative rights and an HTTPS proof URL", () => {
    expect(ReviewAssetLicenseRequestSchema.safeParse({ ...input, derivativeAllowed: false }).success).toBe(false);
    expect(ReviewAssetLicenseRequestSchema.safeParse({ ...input, proofUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(ReviewAssetLicenseRequestSchema.safeParse(input).success).toBe(true);
  });
  it("requires the workspace owner before recording evidence", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const result = { id: "content-1" } as ContentReviewResponse;
    const service = new ReviewService({ reviewAssetLicense: save, get: () => Promise.resolve(result) } as unknown as ReviewRepository);
    await expect(service.reviewAssetLicense("workspace-1", "MEMBER", "user-1", "content-1", input)).rejects.toThrow("OWNER_ROLE_REQUIRED");
    expect(save).not.toHaveBeenCalled();
    await expect(service.reviewAssetLicense("workspace-1", "OWNER", "user-1", "content-1", input)).resolves.toEqual(result);
    expect(save).toHaveBeenCalledWith("workspace-1", "user-1", "content-1", input);
  });
});
