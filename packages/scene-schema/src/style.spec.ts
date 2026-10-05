import { describe, expect, it } from "vitest";
import { aiSceneCount, VideoStyleSchema } from "./index.js";

describe("render settings", () => {
  it("bounds font sizes and rejects executable or invalid colors", () => {
    expect(VideoStyleSchema.safeParse({ brandColor: "url(https://invalid)" }).success).toBe(false);
    expect(VideoStyleSchema.safeParse({ captionFontSize: 200 }).success).toBe(false);
    expect(VideoStyleSchema.parse({ brandColor: "#ff00ff", watermark: "My brand", fontFamily: "serif" })).toMatchObject({ brandColor: "#ff00ff", watermark: "My brand", fontFamily: "serif" });
  });
  it("rounds the ratio to actual scene counts", () => {
    expect(aiSceneCount(4, 0.5)).toBe(2);
    expect(aiSceneCount(3, 0.5)).toBe(2);
    expect(aiSceneCount(4, 0)).toBe(0);
    expect(aiSceneCount(4, 1)).toBe(4);
  });
});
