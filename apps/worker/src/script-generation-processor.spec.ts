import { Prisma, type PrismaClient } from "@postbot/database";
import type { SceneDocument } from "@postbot/scene-schema";
import { describe, expect, it } from "vitest";
import { ScriptGenerationProcessor } from "./script-generation-processor.js";

const scene = (title: string): SceneDocument => ({
  schemaVersion: "1.0.0", title, width: 1080, height: 1920, fps: 30, durationInFrames: 30,
  scenes: [{ id: "scene-1", startFrame: 0, durationInFrames: 30, visualPrompt: title, narration: { text: title, sourceUrl: "https://example.org/source" }, overlays: [{ kind: "title", text: title }] }]
});

const generated = {
  planning: { title: "new", summary: "new summary", metadata: { description: "new metadata", hashtags: ["new"] } },
  script: { hook: "new hook", body: "new body", callToAction: "new cta", language: "en", durationSeconds: 30 },
  facts: [{ claim: "new fact", sourceUrl: "https://example.org/source" }],
  sceneDocument: scene("new scene")
};

describe("ScriptGenerationProcessor", () => {
  it("keeps every unselected field during partial regeneration", () => {
    const processor = new ScriptGenerationProcessor({} as PrismaClient);
    const previousScene = scene("previous scene");
    const merged = processor.merge("hook", generated, {
      hook: "previous hook", body: "previous body", callToAction: "previous cta", language: "ko",
      durationSeconds: new Prisma.Decimal(45), qualitySnapshot: { metadata: { description: "previous metadata", hashtags: ["previous"] }, facts: [{ claim: "previous fact", sourceUrl: "https://example.org/source" }] }
    }, { sceneDocument: previousScene });

    expect(merged.script).toMatchObject({ hook: "new hook", body: "previous body", callToAction: "previous cta", language: "ko", durationSeconds: 45 });
    expect(merged.metadata).toEqual({ description: "previous metadata", hashtags: ["previous"] });
    expect(merged.facts).toEqual([{ claim: "previous fact", sourceUrl: "https://example.org/source" }]);
    expect(merged.sceneDocument.scenes[0]?.visualPrompt).toBe(previousScene.scenes[0]?.visualPrompt);
    expect(merged.sceneDocument.scenes[0]?.narration.text).toBe("new hook");
    expect(merged.sceneDocument.durationInFrames).toBe(previousScene.durationInFrames);
  });

  it("changes scene visuals but preserves narration, timing and facts for scene-only regeneration", () => {
    const processor = new ScriptGenerationProcessor({} as PrismaClient);
    const merged = processor.merge("scene", generated, {
      hook: "previous hook", body: "previous body", callToAction: "previous cta", language: "en",
      durationSeconds: new Prisma.Decimal(45), qualitySnapshot: { metadata: { description: "previous metadata", hashtags: ["previous"] }, facts: [{ claim: "previous fact", sourceUrl: "https://example.org/source" }] }
    }, { sceneDocument: scene("previous scene") });

    expect(merged.sceneDocument.scenes[0]?.visualPrompt).toBe("new scene");
    expect(merged.sceneDocument.scenes[0]?.narration.text).toBe("previous scene");
    expect(merged.sceneDocument.durationInFrames).toBe(30);
    expect(merged.script.body).toBe("previous body");
    expect(merged.facts).toEqual([{ claim: "previous fact", sourceUrl: "https://example.org/source" }]);
  });
});
