import { describe, expect, it } from "vitest";
import { scoreStockMatch } from "./stock-matching.js";
const asset = { assetId: "rocket", storageKey: "rocket.png", description: "reusable rocket recovery", tags: ["rocket", "booster"], recentUseCount: 0 };
describe("scene stock matching", () => {
  it("rejects unrelated or undescribed stock and penalizes repeated use", () => {
    expect(scoreStockMatch("ocean sensor network", asset)).toBe(0);
    expect(scoreStockMatch("rocket", { ...asset, tags: [], description: "" })).toBe(0);
    const suitable = scoreStockMatch("reusable rocket booster recovery", asset);
    expect(suitable).toBeGreaterThan(0.25);
    expect(scoreStockMatch("reusable rocket booster recovery", { ...asset, recentUseCount: 5 })).toBeLessThan(suitable);
  });
});
