import type { ContentReviewResponse, PolicyVerdict } from "@postbot/contracts";

export const REVIEW_REPOSITORY = Symbol("REVIEW_REPOSITORY");

export type PolicyRuleRecord = {
  id: string; platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"; region: string; version: number; effectiveAt: Date; checkedAt: Date;
  durationRule: Record<string, unknown>; originalityRule: Record<string, unknown>; aiDisclosureRule: Record<string, unknown>; rightsRule: Record<string, unknown>; restrictedTopics: Record<string, unknown>;
};

export type ReviewRepository = {
  get(workspaceId: string, contentItemId: string): Promise<ContentReviewResponse | null>;
  getRule(platform: PolicyRuleRecord["platform"], region: string, at: Date): Promise<PolicyRuleRecord | null>;
  saveCheck(workspaceId: string, contentItemId: string, rule: PolicyRuleRecord, status: PolicyVerdict, findings: readonly { code: string; severity: PolicyVerdict; message: string }[]): Promise<ContentReviewResponse | null>;
  act(workspaceId: string, contentItemId: string, action: "approve" | "hold" | "discard" | "schedule"): Promise<ContentReviewResponse | "POLICY_GATE" | "INVALID_TRANSITION" | null>;
};
