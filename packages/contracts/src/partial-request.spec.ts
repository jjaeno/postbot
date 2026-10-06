import { describe, expect, it } from "vitest";
import { GenerateScriptSceneRequestSchema } from "./index.js";
describe("partial generation platform requirement", () => {
  it("requires a selected platform only for voice/subtitle evidence reuse", () => {
    const input = { ideaId: "idea", idempotencyKey: "fixture-key" };
    for (const partial of ["voice", "subtitle"]) {
      expect(GenerateScriptSceneRequestSchema.safeParse({ ...input, partial }).success).toBe(false);
      expect(GenerateScriptSceneRequestSchema.safeParse({ ...input, partial, platform: "YOUTUBE" }).success).toBe(true);
    }
    expect(GenerateScriptSceneRequestSchema.safeParse(input).success).toBe(true);
  });
});
