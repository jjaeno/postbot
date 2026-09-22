import type { AutomationStage } from "@postbot/contracts";

export type BudgetWindow = { softLimit: number | null; hardLimit: number | null; spent: number; reserved: number };
export type BudgetDecision = "ALLOW" | "SOFT_LIMIT" | "HOLD";

export const evaluateBudget = (window: BudgetWindow, estimate: number | null): BudgetDecision => {
  if (estimate === null || estimate < 0 || !Number.isFinite(estimate)) return "HOLD";
  const total = window.spent + window.reserved + estimate;
  if (window.hardLimit !== null && total > window.hardLimit) return "HOLD";
  if (window.softLimit !== null && total > window.softLimit) return "SOFT_LIMIT";
  return "ALLOW";
};

export const isCostStage = (stage: AutomationStage): boolean => ["SCRIPT", "ASSET", "TTS", "RENDER"].includes(stage);

export const shouldAutoPublish = (input: { mode: "APPROVAL" | "FULL_AUTO"; policyPassed: boolean; rightsVerified: boolean; connectedAccount: boolean; scheduledSlot: boolean; ambiguousPublish: boolean }): boolean =>
  input.mode === "FULL_AUTO" && input.policyPassed && input.rightsVerified && input.connectedAccount && input.scheduledSlot && !input.ambiguousPublish;

export const shouldPauseForFailures = (failureCount: number, threshold = 3): boolean => failureCount >= threshold;
