import { evaluateBudget, shouldAutoPublish } from "./automation-safety.js";

export type SimulationInput = {
  minimumInventory: number;
  inventory: { generating: number; review: number; approved: number; scheduled: number };
  estimatedCosts: number[];
  hardLimit: number;
  policyPassed: boolean;
  rightsVerified: boolean;
  connectedAccount: boolean;
  scheduledSlot: boolean;
  providerFailures: number;
};

export type SimulationResult = { generated: number; reserved: number; published: boolean; paused: boolean; heldReason: string | null };

export const simulateAutomationRun = (input: SimulationInput): SimulationResult => {
  const available = input.inventory.generating + input.inventory.approved + input.inventory.scheduled;
  const generated = Math.max(0, input.minimumInventory - available);
  let reserved = 0;
  for (const estimate of input.estimatedCosts) {
    if (evaluateBudget({ spent: 0, reserved, softLimit: null, hardLimit: input.hardLimit }, estimate) === "HOLD") {
      return { generated: 0, reserved, published: false, paused: false, heldReason: "BUDGET_HARD_LIMIT" };
    }
    reserved += estimate;
  }
  if (input.providerFailures >= 3) return { generated: 0, reserved, published: false, paused: true, heldReason: "CIRCUIT_BREAKER" };
  const published = generated > 0 && shouldAutoPublish({ mode: "FULL_AUTO", policyPassed: input.policyPassed, rightsVerified: input.rightsVerified, connectedAccount: input.connectedAccount, scheduledSlot: input.scheduledSlot, ambiguousPublish: false });
  return { generated, reserved, published, paused: false, heldReason: published || generated === 0 ? null : "PUBLISH_GATE" };
};
