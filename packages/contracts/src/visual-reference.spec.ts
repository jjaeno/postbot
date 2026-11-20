import { describe, expect, it } from "vitest";
import { hasHttpsVisualReference } from "./collection-profile.js";

describe("visual reference metadata", () => {
  it("preserves both supported reference formats", () => {
    expect(hasHttpsVisualReference({ visualReferences: { references: ["https://example.org/image.png"] } })).toBe(true);
    expect(hasHttpsVisualReference({ reliability: { media: { references: [{ url: "https://example.org/image.png" }] } } })).toBe(true);
  });
  it("rejects missing, invalid and non-HTTPS references", () => {
    for (const value of [null, {}, { visualReferences: { references: ["javascript:alert(1)", "http://example.org/image.png", "https:"] } }]) expect(hasHttpsVisualReference(value)).toBe(false);
  });
});
