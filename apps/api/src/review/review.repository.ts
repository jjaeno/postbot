import type { ContentReviewResponse, PolicyVerdict, UpdateReviewMetadataRequest, ReviewAssetLicenseRequest } from "@postbot/contracts";

export const REVIEW_REPOSITORY = Symbol("REVIEW_REPOSITORY");

export type PolicyRuleRecord = {
  id: string; platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"; region: string; version: number; effectiveAt: Date; checkedAt: Date;
  durationRule: unknown; originalityRule: unknown; aiDisclosureRule: unknown; rightsRule: unknown; restrictedTopics: unknown;
};

export type PolicyEvidence = {
  factsHaveSources: boolean; sourceCount: number; minimumSourceReliability: number | null; conflictingSources: boolean;
  assetsVerified: boolean; commercialUseVerified: boolean; duplicateRisk: boolean; originalityScore: number | null;
  sensitiveTopic: boolean; forcedReview: boolean; platformRuleViolations: string[];
};

export type ReviewRepository = {
  reviewAssetLicense?(workspaceId: string, userId: string, contentItemId: string, input: ReviewAssetLicenseRequest): Promise<boolean>;
  get(workspaceId: string, contentItemId: string): Promise<ContentReviewResponse | null>;
  getRule(platform: PolicyRuleRecord["platform"], region: string, at: Date): Promise<PolicyRuleRecord | null>;
  getEvidence(workspaceId: string, contentItemId: string, platform: PolicyRuleRecord["platform"], restrictedTerms: readonly string[], minDurationSeconds: number): Promise<PolicyEvidence | null>;
  updateMetadata(workspaceId: string, contentItemId: string, input: UpdateReviewMetadataRequest): Promise<ContentReviewResponse | null>;
  getPreviewKey(workspaceId: string, contentItemId: string, platform: PolicyRuleRecord["platform"] | null): Promise<string | null>;
  saveCheck(workspaceId: string, contentItemId: string, rule: PolicyRuleRecord, status: PolicyVerdict, findings: readonly { code: string; severity: PolicyVerdict; message: string }[]): Promise<ContentReviewResponse | null>;
  act(workspaceId: string, contentItemId: string, action: "approve" | "hold" | "discard" | "schedule", platform?: PolicyRuleRecord["platform"]): Promise<ContentReviewResponse | "POLICY_GATE" | "INVALID_TRANSITION" | null>;
};
