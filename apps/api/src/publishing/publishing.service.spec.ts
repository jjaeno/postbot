import { describe, expect, it } from "vitest";
import { nextAvailableSlot } from "./publishing.service.js";
describe("nextAvailableSlot", () => {
  it("returns the first unoccupied future slot", () => {
    const first = new Date("2026-10-01T09:00:00.000Z"); const second = new Date("2026-10-01T18:00:00.000Z");
    expect(nextAvailableSlot([second, first], [first], new Date("2026-10-01T08:00:00.000Z"))).toEqual(second);
  });
  it("returns null when no future slot is available", () => expect(nextAvailableSlot([], [], new Date())).toBeNull());
});
