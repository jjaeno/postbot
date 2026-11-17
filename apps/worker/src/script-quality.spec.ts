import { describe, expect, it } from "vitest";
import { evaluateScriptQuality } from "./script-quality.js";
describe("bounded editorial script checks", () => {
  it("retains a small evaluated hook set and labels heuristic duration honestly", () => {
    const result = evaluateScriptQuality({ hook: "Why did Rome build roads?", body: "Rome built roads to move supplies.", title: "Roman roads", callToAction: "Read the source.", language: "en", maxSeconds: 40 });
    expect(result.hookCandidates.length).toBeLessThanOrEqual(3);
    expect(result.hookCandidates[0]?.accepted).toBe(true);
    expect(result.durationMethod).toContain("ACTUAL_TTS_REQUIRED");
  });
  it("rejects exaggerated hooks and excessive Korean or mixed speech before assets", () => {
    expect(() => evaluateScriptQuality({ hook: "Guaranteed income", body: "Income claim", title: "Income", callToAction: "Read", language: "en", maxSeconds: 30 })).toThrow("EXAGGERATION");
    for (const language of ["ko", "en"]) expect(() => evaluateScriptQuality({ hook: "NASA 과학", body: "과학 NASA 2026년 ".repeat(100), title: "NASA 과학", callToAction: "출처", language, maxSeconds: 30 })).toThrow("NARRATION_BUDGET_EXCEEDED");
  });
});
