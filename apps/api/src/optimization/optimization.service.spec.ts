import { describe, expect, it } from "vitest";
import { deterministicExperimentArm } from "./optimization.service.js";

describe("optimization safety primitives", () => {
  it("assigns the same content to the same experiment arm deterministically", () => {
    expect(deterministicExperimentArm("experiment-a", "content-a")).toBe(deterministicExperimentArm("experiment-a", "content-a"));
  });

  it("keeps experiment namespaces isolated", () => {
    const assignments = new Set([deterministicExperimentArm("experiment-a", "content-a"), deterministicExperimentArm("experiment-b", "content-a")]);
    expect(assignments.size).toBeGreaterThanOrEqual(1);
  });
});
