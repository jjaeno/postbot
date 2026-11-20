import { describe, expect, it } from "vitest";
import { simulateAutomationRun } from "./automation-simulator.js";

const input = { minimumInventory: 3, inventory: { generating: 0, review: 1, approved: 1, scheduled: 0 }, estimatedCosts: [1, 2], hardLimit: 10, policyPassed: true, rightsVerified: true, connectedAccount: true, scheduledSlot: true, providerFailures: 0 };

describe("fake automation operation", () => {
  it("creates only inventory deficit and permits an eligible full-auto publish", () => {
    expect(simulateAutomationRun(input)).toEqual({ generated: 2, reserved: 3, published: true, paused: false, heldReason: null });
  });
  it("holds before generation when the hard limit would be exceeded", () => {
    expect(simulateAutomationRun({ ...input, hardLimit: 2 })).toMatchObject({ generated: 0, published: false, heldReason: "BUDGET_HARD_LIMIT" });
  });
  it("keeps policy and rights failures out of publishing", () => {
    expect(simulateAutomationRun({ ...input, policyPassed: false })).toMatchObject({ published: false, heldReason: "PUBLISH_GATE" });
    expect(simulateAutomationRun({ ...input, rightsVerified: false })).toMatchObject({ published: false, heldReason: "PUBLISH_GATE" });
  });
  it("opens a circuit breaker after repeated provider failures", () => {
    expect(simulateAutomationRun({ ...input, providerFailures: 3 })).toMatchObject({ paused: true, heldReason: "CIRCUIT_BREAKER" });
  });
});
