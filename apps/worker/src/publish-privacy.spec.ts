import { describe, expect, it } from "vitest";
import { publishPrivacy } from "./publish-privacy.js";
describe("reservation visibility snapshots", () => {
  it("preserves the operator ceiling and the reservation's stricter setting", () => {
    expect(publishPrivacy("PUBLIC", "private")).toBe("private");
    expect(publishPrivacy("PRIVATE", "public")).toBe("private");
    expect(publishPrivacy("UNLISTED", "public")).toBe("unlisted");
    expect(publishPrivacy("PUBLIC", "unlisted")).toBe("unlisted");
    expect(publishPrivacy(undefined, "private")).toBe("private");
  });
});
