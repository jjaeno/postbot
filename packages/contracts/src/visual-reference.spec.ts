import { describe, expect, it } from "vitest";
import { hasHttpsVisualReference } from "./collection-profile.js";

describe("visual reference metadata", () => {
  it("accepts stored NASA image previews but not HTML detail or API links", () => {
    expect(hasHttpsVisualReference({ visualReferences: { references: [{ href: "https://images-assets.nasa.gov/image/PIA/PIA~thumb.jpg", rel: "preview", render: "image" }], rights: "ITEM_REVIEW_REQUIRED" } })).toBe(true);
    for (const reference of [{ href: "https://images.nasa.gov/details/PIA", rel: "preview", render: "html" }, { url: "https://images-api.nasa.gov/asset/PIA" }, { url: "https://example.org/detail" }, { href: "https://user:password@example.org/a.jpg", render: "image" }]) expect(hasHttpsVisualReference({ visualReferences: { references: [reference] } })).toBe(false);
  });
  it("preserves both supported reference formats", () => {
    expect(hasHttpsVisualReference({ visualReferences: { references: ["https://example.org/image.png"] } })).toBe(true);
    expect(hasHttpsVisualReference({ reliability: { media: { references: [{ url: "https://example.org/image.png" }] } } })).toBe(true);
  });
  it("rejects missing, invalid and non-HTTPS references", () => {
    for (const value of [null, {}, { visualReferences: { references: ["javascript:alert(1)", "http://example.org/image.png", "https:"] } }]) expect(hasHttpsVisualReference(value)).toBe(false);
  });
});
