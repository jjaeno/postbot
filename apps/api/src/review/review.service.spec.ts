import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { ContentReviewResponse } from "@postbot/contracts";
import { ReviewService } from "./review.service.js";
import type { PolicyRuleRecord, ReviewRepository } from "./review.repository.js";

const rule: PolicyRuleRecord = { id: "rule-1", platform: "YOUTUBE", region: "GLOBAL", version: 1, effectiveAt: new Date("2026-01-01"), checkedAt: new Date("2026-01-01"), durationRule: { maxDurationSeconds: 60 }, originalityRule: {}, aiDisclosureRule: { required: true }, rightsRule: { requireVerifiedAssets: true }, restrictedTopics: { terms: [] } };
const content = (): ContentReviewResponse => ({ id: "content-1", channelId: "channel-1", status: "REVIEW_REQUIRED", title: "Review", description: "AI generated summary", durationSeconds: 30, sources: [{ title: "Source", url: "https://example.com", sourceName: "Example" }], assets: [{ id: "asset-1", licenseStatus: "VERIFIED", purpose: "image" }], policy: null, ideaId: "idea-1", outputs: [] });

class FakeReviewRepository implements ReviewRepository {
  current = content();
  get = (): Promise<ContentReviewResponse> => Promise.resolve(this.current);
  getRule = (): Promise<PolicyRuleRecord> => Promise.resolve(rule);
  getEvidence = () => Promise.resolve({ factsHaveSources: true, sourceCount: 1, minimumSourceReliability: 0.9, conflictingSources: false, assetsVerified: true, commercialUseVerified: true, duplicateRisk: false, originalityScore: 1, sensitiveTopic: false, forcedReview: false, platformRuleViolations: [] });
  updateMetadata = (): Promise<ContentReviewResponse> => Promise.resolve(this.current);
  getPreviewKey = (): Promise<string | null> => Promise.resolve(null);
  saveCheck = (_workspaceId: string, _contentId: string, _rule: PolicyRuleRecord, status: "pass" | "warning" | "review" | "block", _findings: readonly { code: string; severity: "pass" | "warning" | "review" | "block"; message: string }[]): Promise<ContentReviewResponse> => {
    void _findings;
    this.current = { ...this.current, policy: { status, findings: [], snapshotId: "snapshot-1" } };
    return Promise.resolve(this.current);
  };
  act = (_workspaceId: string, _contentId: string, action: "approve" | "hold" | "discard" | "schedule"): Promise<ContentReviewResponse | "POLICY_GATE"> => {
    if (action === "approve" && this.current.policy?.status !== "pass") return Promise.resolve("POLICY_GATE");
    this.current = { ...this.current, status: action === "approve" ? "APPROVED" : action === "schedule" ? "SCHEDULED" : "HELD" };
    return Promise.resolve(this.current);
  };
}

describe("ReviewService", () => {
  it("persists a passing check and permits the approval transition", async () => {
    const repository = new FakeReviewRepository();
    const service = new ReviewService(repository);
    await expect(service.check("workspace-1", "content-1", { platform: "YOUTUBE" })).resolves.toMatchObject({ policy: { status: "pass" } });
    await expect(service.action("workspace-1", "content-1", { action: "approve" })).resolves.toMatchObject({ status: "APPROVED" });
  });
  it("blocks approval without a passing policy result", async () => {
    const service = new ReviewService(new FakeReviewRepository());
    await expect(service.action("workspace-1", "content-1", { action: "approve" })).rejects.toBeInstanceOf(ConflictException);
  });
});
