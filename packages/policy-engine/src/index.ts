import type { SupportedPlatform } from "@postbot/publishers";

export type PolicySeverity = "pass" | "warning" | "block" | "unknown";

export interface PolicyRuleIdentity {
  readonly platform: SupportedPlatform;
  readonly region: string;
  readonly version: string;
  readonly checkedAt: string;
}
