import { describe, expect, it } from "vitest";
import { alignSceneNarration, retimeNarration, SceneDocumentSchema, type SceneDocument } from "./index.js";

const document: SceneDocument = { schemaVersion: "1.0.0", title: "음성", width: 1080, height: 1920, fps: 30, durationInFrames: 900, scenes: [
  { id: "a", startFrame: 0, durationInFrames: 450, visualPrompt: "image", narration: { text: "첫 문장", sourceUrl: "https://example.com" }, overlays: [{ kind: "title", text: "title" }] },
  { id: "b", startFrame: 450, durationInFrames: 450, visualPrompt: "image", narration: { text: "다음 문장", sourceUrl: "https://example.com" }, overlays: [{ kind: "cta", text: "end" }] }
] };
describe("spoken Korean timeline", () => {
  it.each([4, 50])("retimes a %s second voice without losing words", (duration) => {
    const result = retimeNarration(document, [{ text: "첫 문장", startSeconds: 0, endSeconds: duration / 2 }, { text: "다음 문장", startSeconds: duration / 2, endSeconds: duration }], duration, { min: 1, max: 60 });
    expect(result.durationInFrames).toBe(duration * 30);
    expect(result.scenes[1]?.startFrame).toBe(duration * 15);
    expect(result.scenes.map((scene) => scene.narration.text)).toEqual(["첫 문장", "다음 문장"]);
  });
  it("holds duration overflow, text mismatch and overlapping captions", () => {
    expect(() => retimeNarration(document, [], 61, { min: 1, max: 60 })).toThrow("SHORTEN_SCRIPT");
    expect(() => retimeNarration(document, [{ text: "다른 발화", startSeconds: 0, endSeconds: 4 }], 4, { min: 1, max: 60 })).toThrow("TEXT_MISMATCH");
    expect(() => retimeNarration(document, [{ text: "첫 문장", startSeconds: 0, endSeconds: 3 }, { text: "다음 문장", startSeconds: 2, endSeconds: 4 }], 4, { min: 1, max: 60 })).toThrow("TIMING_INVALID");
  });
  it("rejects duplicate scene IDs, gaps and overlaps", () => {
    for (const patch of [{ id: "a" }, { startFrame: 451 }, { startFrame: 449 }]) expect(SceneDocumentSchema.safeParse({ ...document, scenes: [document.scenes[0], { ...document.scenes[1], ...patch }] }).success).toBe(false);
  });
  it("aligns generated scene narration with the actual complete script", () => {
    const result = alignSceneNarration(document, "수정한 한국어 대본 전체를 읽습니다");
    expect(result.scenes.map((scene) => scene.narration.text).join(" ")).toBe("수정한 한국어 대본 전체를 읽습니다");
  });
});
