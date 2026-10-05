import { describe, expect, it } from "vitest";
import { compareExperimentArms, deterministicExperimentArm } from "./index.js";

describe("limited experiment evidence", () => {
  it("allocates stably and exercises both arms", () => {
    const arms = Array.from({ length: 100 }, (_, index) => deterministicExperimentArm("experiment", `content-${index}`));
    expect(new Set(arms)).toEqual(new Set(["control", "variant"]));
    expect(deterministicExperimentArm("experiment", "content-1")).toBe(deterministicExperimentArm("experiment", "content-1"));
  });
  it("requires the minimum in each arm, not the combined total", () => {
    expect(compareExperimentArms([10, 10, 10, 10], [20], 2, 0.1, "higher")).toMatchObject({ sufficient: false, winner: "inconclusive" });
  });
  it("compares available means with the declared direction without causal claims", () => {
    expect(compareExperimentArms([100, 100], [120, 120], 2, 0.1, "higher")).toMatchObject({ relativeChange: 0.2, winner: "variant", causalClaim: false, hypothesisOnly: true });
    expect(compareExperimentArms([100, 100], [80, 80], 2, 0.1, "lower").winner).toBe("variant");
    expect(compareExperimentArms([100, 100], [102, 102], 2, 0.1, "higher").winner).toBe("inconclusive");
    expect(compareExperimentArms([0, 0], [100, 100], 2, 0.1, "higher")).toMatchObject({ relativeChange: null, winner: "inconclusive" });
  });
});
