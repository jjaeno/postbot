import { describe, expect, it } from "vitest";
import { evaluateBudget, shouldAutoPublish, shouldPauseForFailures } from "./automation-safety.js";
import { AutomationBudgetRequestSchema } from "@postbot/contracts";

describe("automation safety gates", () => {
  it("holds unknown cost and hard-limit races", () => {
    expect(evaluateBudget({ spent: 4, reserved: 5, softLimit: 10, hardLimit: 10 }, null)).toBe("HOLD");
    expect(evaluateBudget({ spent: 4, reserved: 5, softLimit: 10, hardLimit: 10 }, 2)).toBe("HOLD");
  });
  it("marks soft-limit usage without permitting a hard-limit overrun", () => {
    expect(evaluateBudget({ spent: 7, reserved: 0, softLimit: 8, hardLimit: 10 }, 2)).toBe("SOFT_LIMIT");
  });
  it("never auto-publishes a review, rights, connection, slot, or ambiguous result", () => {
    const allowed = { mode: "FULL_AUTO" as const, policyPassed: true, rightsVerified: true, connectedAccount: true, scheduledSlot: true, ambiguousPublish: false };
    expect(shouldAutoPublish(allowed)).toBe(true);
    expect(shouldAutoPublish({ ...allowed, ambiguousPublish: true })).toBe(false);
    expect(shouldAutoPublish({ ...allowed, mode: "APPROVAL" })).toBe(false);
    expect(shouldPauseForFailures(3)).toBe(true);
  });
  it("rejects invalid budget bounds", () => {
    expect(() => AutomationBudgetRequestSchema.parse({ dailySoftLimit: 11, dailyHardLimit: 10 })).toThrow();
  });
});
