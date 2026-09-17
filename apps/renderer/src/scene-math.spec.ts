import { describe, expect, it } from "vitest";
import type { SceneDocument } from "@postbot/scene-schema";
import { captionAtFrame, sceneAtFrame, sceneFrames, toFrameCaptions } from "./scene-math.js";

const fixture = (seconds: number): SceneDocument => ({
  schemaVersion: "1.0.0",
  title: `${seconds} second fixture`,
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: seconds * 30,
  scenes: [
    { id: "first", startFrame: 0, durationInFrames: seconds * 15, visualPrompt: "first", narration: { text: "first", sourceUrl: "https://example.com/first" }, overlays: [{ kind: "title", text: "First" }] },
    { id: "second", startFrame: seconds * 15, durationInFrames: seconds * 15, visualPrompt: "second", narration: { text: "second", sourceUrl: "https://example.com/second" }, overlays: [{ kind: "fact", text: "Second" }] }
  ]
});

describe("scene frame calculation", () => {
  it.each([15, 60])("keeps the %i-second fixture within its frame budget", (seconds) => {
    const document = fixture(seconds);
    expect(sceneFrames(document)).toEqual([seconds * 15, seconds * 30]);
    expect(sceneAtFrame(document, seconds * 15 - 1)?.id).toBe("first");
    expect(sceneAtFrame(document, seconds * 15)?.id).toBe("second");
  });

  it("maps TTS timing to inclusive frame ranges", () => {
    const captions = toFrameCaptions([{ text: "caption", startSeconds: 0.1, endSeconds: 0.2 }], 30);
    expect(captions).toEqual([{ text: "caption", startSeconds: 0.1, endSeconds: 0.2, startFrame: 3, endFrame: 6 }]);
    expect(captionAtFrame(captions, 3)?.text).toBe("caption");
    expect(captionAtFrame(captions, 6)).toBeNull();
  });
});
