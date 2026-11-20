import { describe, expect, it } from "vitest";
import { evaluateBusinessProgress } from "./business-progress.js";
const now = new Date("2026-11-20T12:00:00Z");
const input = { now, createdAt: new Date(now.getTime() - 86400000), active: true, configured: true, cadenceMinutes: 60, lastAttemptAt: null, lastSuccessAt: null };
describe("cadence-aware business progress", () => {
  it("detects absent work and reports expected time and elapsed delay", () => {
    expect(evaluateBusinessProgress(input)).toMatchObject({ state: "STALLED", lastAttemptAt: null, lastSuccessAt: null, delayMinutes: 1380, expectedAt: "2026-11-19T13:00:00.000Z" });
  });
  it("distinguishes initial grace, no candidates, deliberate pause, inventory, active work and holds", () => {
    expect(evaluateBusinessProgress({ ...input, createdAt: new Date(now.getTime() - 60 * 60000) }).state).toBe("INITIAL_GRACE");
    expect(evaluateBusinessProgress({ ...input, zeroCandidates: true }).state).toBe("NO_CANDIDATES");
    expect(evaluateBusinessProgress({ ...input, active: false }).state).toBe("INTENTIONALLY_PAUSED");
    expect(evaluateBusinessProgress({ ...input, inventorySatisfied: true }).state).toBe("INVENTORY_SATISFIED");
    expect(evaluateBusinessProgress({ ...input, inProgress: true }).state).toBe("IN_PROGRESS");
    for (const blocker of ["REVIEW_HOLD", "ACCOUNT_HOLD", "BUDGET_HOLD", "SOURCE_BUDGET_HOLD"]) expect(evaluateBusinessProgress({ ...input, blocker }).state).toBe(blocker);
    expect(evaluateBusinessProgress({ ...input, configured: false }).state).toBe("NOT_CONFIGURED");
    expect(evaluateBusinessProgress({ ...input, lastSuccessAt: now }).state).toBe("AWAITING_NEXT_CYCLE");
  });
});
