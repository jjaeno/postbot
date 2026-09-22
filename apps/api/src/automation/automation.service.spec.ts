import { describe, expect, it } from "vitest";
import { inventoryDeficit } from "./automation.service.js";

describe("automation inventory", () => {
  it("creates only the missing inventory and never double counts scheduled content", () => {
    expect(inventoryDeficit(5, 1, 1, 1, 1)).toBe(1);
    expect(inventoryDeficit(5, 1, 1, 1, 2)).toBe(0);
  });

  it("does not create work when the minimum inventory is already met", () => {
    expect(inventoryDeficit(3, 0, 1, 1, 1)).toBe(0);
  });
});
