import { describe, expect, it } from "vitest";
import { automationStages, evaluateAutomationBranches, inventoryDeficit, isAbandonedAutomationClaim } from "./automation.service.js";

describe("automation inventory", () => {
  it("keeps review inventory separate from the ready buffer", () => {
    expect(inventoryDeficit(5, 1, 1, 1, 1)).toBe(2);
    expect(inventoryDeficit(5, 1, 1, 1, 2)).toBe(1);
  });

  it("does not create work when the minimum inventory is already met", () => {
    expect(inventoryDeficit(3, 0, 1, 2, 1)).toBe(0);
  });

  it("reclaims only stale queue claims after a worker/API restart", () => {
    const now = Date.parse("2026-09-29T00:02:00.000Z");
    expect(isAbandonedAutomationClaim(new Date("2026-09-29T00:00:59.000Z"), now)).toBe(true);
    expect(isAbandonedAutomationClaim(new Date("2026-09-29T00:01:30.000Z"), now)).toBe(false);
  });
});

describe("automation platform branches", () => {
  const platforms = ["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const;
  const steps = () => [
    { stage: "COLLECT", platform: null, status: "SUCCEEDED" },
    ...platforms.flatMap((platform) => automationStages.slice(1).map((stage) => ({ stage, platform, status: "PENDING" })))
  ];

  it("fans out only the first runnable stage for every platform", () => {
    expect(evaluateAutomationBranches(steps())).toEqual({
      status: "RUNNING",
      runnable: platforms.map((platform) => ({ stage: "SCRIPT", platform }))
    });
  });

  it("keeps healthy branches moving when one platform fails", () => {
    const state = steps();
    for (const step of state) {
      if (step.platform === "INSTAGRAM" && step.stage === "SCRIPT") step.status = "FAILED";
      if (step.platform !== "INSTAGRAM" && step.stage === "SCRIPT") step.status = "SUCCEEDED";
    }
    expect(evaluateAutomationBranches(state)).toEqual({
      status: "RUNNING",
      runnable: [
        { stage: "ASSET", platform: "YOUTUBE" },
        { stage: "ASSET", platform: "TIKTOK" }
      ]
    });
  });

  it("fails only after every healthy branch is terminal and succeeds after isolated retry", () => {
    const state = steps();
    for (const step of state) step.status = step.platform === "INSTAGRAM" && step.stage === "PUBLISH" ? "FAILED" : "SUCCEEDED";
    expect(evaluateAutomationBranches(state)).toEqual({ status: "FAILED", runnable: [] });

    const failed = state.find((step) => step.platform === "INSTAGRAM" && step.stage === "PUBLISH");
    if (!failed) throw new Error("fixture missing");
    failed.status = "PENDING";
    expect(evaluateAutomationBranches(state)).toEqual({
      status: "RUNNING",
      runnable: [{ stage: "PUBLISH", platform: "INSTAGRAM" }]
    });
    failed.status = "SUCCEEDED";
    expect(evaluateAutomationBranches(state)).toEqual({ status: "SUCCEEDED", runnable: [] });
  });

  it("does not enqueue duplicate work while a branch job is queued", () => {
    const state = steps();
    for (const step of state) {
      if (step.platform === "YOUTUBE" && step.stage === "SCRIPT") step.status = "QUEUED";
      if (step.platform !== "YOUTUBE" && step.stage === "SCRIPT") step.status = "SUCCEEDED";
    }
    expect(evaluateAutomationBranches(state)).toEqual({
      status: "RUNNING",
      runnable: [
        { stage: "ASSET", platform: "INSTAGRAM" },
        { stage: "ASSET", platform: "TIKTOK" }
      ]
    });
  });

  it("revisits stale queued and running branches without reclaiming fresh claims", () => {
    const now = Date.now();
    const state = steps().map((step) => ({ ...step, updatedAt: new Date(now - 120_000) }));
    for (const step of state) {
      if (step.stage === "SCRIPT") step.status = step.platform === "TIKTOK" ? "RUNNING" : "QUEUED";
      if (step.stage === "SCRIPT" && step.platform === "INSTAGRAM") step.updatedAt = new Date(now);
    }
    expect(evaluateAutomationBranches(state)).toEqual({
      status: "RUNNING", runnable: [{ stage: "SCRIPT", platform: "YOUTUBE" }, { stage: "SCRIPT", platform: "TIKTOK" }]
    });
    state[0]!.status = "QUEUED";
    expect(evaluateAutomationBranches(state)).toEqual({ status: "RUNNING", runnable: [{ stage: "COLLECT", platform: null }] });
  });

  it("blocks only the platform whose policy is held while other branches continue", () => {
    const state = steps();
    for (const step of state) {
      if (step.platform === "INSTAGRAM" && step.stage === "SCRIPT") step.status = "SUCCEEDED";
      if (step.platform === "INSTAGRAM" && step.stage === "ASSET") step.status = "SUCCEEDED";
      if (step.platform === "INSTAGRAM" && step.stage === "TTS") step.status = "SUCCEEDED";
      if (step.platform === "INSTAGRAM" && step.stage === "RENDER") step.status = "SUCCEEDED";
      if (step.platform === "INSTAGRAM" && step.stage === "POLICY") step.status = "HELD";
      if (step.platform !== "INSTAGRAM" && step.stage === "SCRIPT") step.status = "SUCCEEDED";
    }
    expect(evaluateAutomationBranches(state)).toEqual({
      status: "RUNNING",
      runnable: [
        { stage: "ASSET", platform: "YOUTUBE" },
        { stage: "ASSET", platform: "TIKTOK" }
      ]
    });
    expect(state.find((step) => step.platform === "INSTAGRAM" && step.stage === "PUBLISH")?.status).toBe("PENDING");
  });
});
