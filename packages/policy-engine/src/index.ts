import type { SupportedPlatform } from "@postbot/publishers";

export type PolicySeverity = "pass" | "warning" | "review" | "block";

export interface PolicyRuleIdentity {
  readonly platform: SupportedPlatform;
  readonly region: string;
  readonly version: string;
  readonly checkedAt: string;
}

export type PolicyRule = PolicyRuleIdentity & {
  readonly effectiveAt: string;
  readonly maxDurationSeconds: number;
  readonly requiredDisclosure: boolean;
  readonly restrictedTerms: readonly string[];
  readonly requireVerifiedAssets: boolean;
  readonly requireCommercialUse?: boolean;
  readonly minimumSourceCount?: number;
  readonly minimumSourceReliability?: number;
  readonly minimumOriginalityScore?: number;
};

export type PolicyInput = {
  readonly durationSeconds: number | null;
  readonly description: string;
  readonly factsHaveSources: boolean;
  readonly hasAiDisclosure: boolean;
  readonly assetsVerified: boolean;
  readonly duplicateRisk: boolean;
  readonly sourceCount?: number;
  readonly minimumSourceReliability?: number | null;
  readonly conflictingSources?: boolean;
  readonly commercialUseVerified?: boolean;
  readonly originalityScore?: number | null;
  readonly sensitiveTopic?: boolean;
  readonly forcedReview?: boolean;
  readonly platformRuleViolations?: readonly string[];
};

export type PolicyFinding = {
  readonly code: string;
  readonly severity: PolicySeverity;
  readonly message: string;
};

export type PolicyEvaluation = {
  readonly status: PolicySeverity;
  readonly findings: readonly PolicyFinding[];
};

const severityRank: Record<PolicySeverity, number> = { pass: 0, warning: 1, review: 2, block: 3 };

export const evaluatePolicy = (rule: PolicyRule, input: PolicyInput): PolicyEvaluation => {
  const findings: PolicyFinding[] = [];
  if (!input.factsHaveSources) findings.push({ code: "MISSING_SOURCE", severity: "block", message: "Every factual claim must have a source." });
  if ((input.sourceCount ?? (input.factsHaveSources ? 1 : 0)) < (rule.minimumSourceCount ?? 1)) findings.push({ code: "INSUFFICIENT_SOURCES", severity: "review", message: "The required number of independent sources is not available." });
  if (input.minimumSourceReliability !== undefined && input.minimumSourceReliability !== null && input.minimumSourceReliability < (rule.minimumSourceReliability ?? 0.6)) findings.push({ code: "LOW_RELIABILITY_SOURCE", severity: "review", message: "Source reliability is below the configured threshold." });
  if (input.conflictingSources) findings.push({ code: "CONFLICTING_SOURCES", severity: "block", message: "Sources contain unresolved conflicting claims." });
  if (input.durationSeconds === null || input.durationSeconds > rule.maxDurationSeconds) {
    findings.push({ code: "DURATION_EXCEEDED", severity: "block", message: "Content exceeds the platform duration limit." });
  }
  if (rule.requiredDisclosure && !input.hasAiDisclosure) {
    findings.push({ code: "AI_DISCLOSURE_REQUIRED", severity: "review", message: "AI disclosure requires manual confirmation." });
  }
  if (rule.requireVerifiedAssets && !input.assetsVerified) {
    findings.push({ code: "ASSET_LICENSE_UNVERIFIED", severity: "review", message: "One or more asset licenses are not verified." });
  }
  if (rule.requireCommercialUse && input.commercialUseVerified === false) findings.push({ code: "COMMERCIAL_USE_NOT_VERIFIED", severity: "block", message: "Commercial-use rights are not verified." });
  if (input.duplicateRisk || (input.originalityScore !== undefined && input.originalityScore !== null && input.originalityScore < (rule.minimumOriginalityScore ?? 0.55))) findings.push({ code: "DUPLICATE_RISK", severity: "review", message: "Content may be repetitive or insufficiently original." });
  if (input.sensitiveTopic) findings.push({ code: "SENSITIVE_TOPIC_REVIEW", severity: "review", message: "Sensitive content requires manual review." });
  if (input.forcedReview) findings.push({ code: "FORCED_REVIEW", severity: "review", message: "Channel or content risk settings require manual review." });
  for (const violation of input.platformRuleViolations ?? []) findings.push({ code: "PLATFORM_RULE_VIOLATION", severity: "block", message: violation });
  const restricted = rule.restrictedTerms.find((term) => input.description.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  if (restricted) findings.push({ code: "RESTRICTED_TOPIC", severity: "block", message: `Restricted topic detected: ${restricted}.` });
  const status = findings.reduce<PolicySeverity>((current, finding) => severityRank[finding.severity] > severityRank[current] ? finding.severity : current, "pass");
  return { status, findings };
};
