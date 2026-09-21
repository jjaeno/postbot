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
};

export type PolicyInput = {
  readonly durationSeconds: number | null;
  readonly description: string;
  readonly factsHaveSources: boolean;
  readonly hasAiDisclosure: boolean;
  readonly assetsVerified: boolean;
  readonly duplicateRisk: boolean;
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
  if (input.durationSeconds === null || input.durationSeconds > rule.maxDurationSeconds) {
    findings.push({ code: "DURATION_EXCEEDED", severity: "block", message: "Content exceeds the platform duration limit." });
  }
  if (rule.requiredDisclosure && !input.hasAiDisclosure) {
    findings.push({ code: "AI_DISCLOSURE_REQUIRED", severity: "review", message: "AI disclosure requires manual confirmation." });
  }
  if (rule.requireVerifiedAssets && !input.assetsVerified) {
    findings.push({ code: "ASSET_LICENSE_UNVERIFIED", severity: "review", message: "One or more asset licenses are not verified." });
  }
  if (input.duplicateRisk) findings.push({ code: "DUPLICATE_RISK", severity: "warning", message: "Content may be repetitive or low-value." });
  const restricted = rule.restrictedTerms.find((term) => input.description.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  if (restricted) findings.push({ code: "RESTRICTED_TOPIC", severity: "block", message: `Restricted topic detected: ${restricted}.` });
  const status = findings.reduce<PolicySeverity>((current, finding) => severityRank[finding.severity] > severityRank[current] ? finding.severity : current, "pass");
  return { status, findings };
};
