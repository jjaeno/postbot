import { loadConfig } from "@postbot/config";
import { describe, expect, it } from "vitest";
import { estimateAutomationStageCost } from "./automation-cost-estimator.js";

describe("automation cost estimator", () => {
  it("estimates fake stages without request-supplied prices", () => {
    const config = loadConfig({ APP_ENV: "test", LLM_PROVIDER: "fake", IMAGE_PROVIDER: "fake", TTS_PROVIDER: "fake" });
    expect(estimateAutomationStageCost(config, "SCRIPT", {})?.amountUsd).toBeGreaterThan(0);
    expect(estimateAutomationStageCost(config, "ASSET", { imageCount: 2 })?.amountUsd).toBe(0.002);
    expect(estimateAutomationStageCost(config, "TTS", { characters: 500 })?.amountUsd).toBe(0.005);
    expect(estimateAutomationStageCost(config, "RENDER", { durationSeconds: 30 })?.amountUsd).toBe(0.005);
  });

  it("fails closed when a real provider price is not configured", () => {
    const config = loadConfig({ APP_ENV: "production", LLM_PROVIDER: "openai", OPENAI_API_KEY: "configured-elsewhere" });
    expect(estimateAutomationStageCost(config, "SCRIPT", {})).toBeNull();
  });
});
