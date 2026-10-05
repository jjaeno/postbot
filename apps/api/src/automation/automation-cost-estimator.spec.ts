import { randomBytes } from "node:crypto";
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
    const config = loadConfig({ APP_ENV: "production", LLM_PROVIDER: "openai", OPENAI_API_KEY: "configured-elsewhere",
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
      OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex") });
    expect(estimateAutomationStageCost(config, "SCRIPT", {})).toBeNull();
  });
  it("does not require AI pricing when a scene snapshot uses only licensed stock", () => {
    const config = loadConfig({ APP_ENV: "test", IMAGE_PROVIDER: "google" });
    expect(estimateAutomationStageCost(config, "ASSET", { imageCount: 0 })).toMatchObject({ provider: "licensed-stock", amountUsd: 0 });
    expect(estimateAutomationStageCost(config, "ASSET", {})).toBeNull();
    expect(estimateAutomationStageCost(config, "ASSET", { imageCount: 2 })).toBeNull();
  });
});
