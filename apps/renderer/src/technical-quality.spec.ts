import { describe, expect, it } from "vitest";
import { SceneDocumentSchema } from "@postbot/scene-schema";
import { inspectTechnicalQuality } from "./technical-quality.js";
import { fittedFontSize, splitDisplayCaptions } from "./text-layout.js";
const fixture = () => SceneDocumentSchema.parse({ schemaVersion: "1.0.0", title: "Why this result matters", width: 1080, height: 1920, fps: 30, durationInFrames: 240, scenes: [{ id: "one", role: "HOOK", visualMode: "IMAGE", startFrame: 0, durationInFrames: 240, visualPrompt: "rocket", narration: { text: "rocket", sourceUrl: "https://example.org" }, overlays: [{ kind: "title", text: "Immediate result" }, { kind: "fact", text: "The source reports 100 km." }] }] });
describe("technical layout checks, without performance predictions", () => {
  it("groups word alignments into readable phrases while preserving original number suffix spacing", () => {
    const phrases = splitDisplayCaptions([{ text: "NASA", startSeconds: 0, endSeconds: 0.4 }, { text: "2026", joiner: " ", startSeconds: 0.4, endSeconds: 1 }, { text: "년", joiner: "", startSeconds: 1, endSeconds: 1.2 }, { text: "관측", joiner: " ", startSeconds: 1.2, endSeconds: 1.8 }]);
    expect(phrases).toEqual([{ text: "NASA 2026년 관측", startSeconds: 0, endSeconds: 1.8 }]);
  });
  it("preserves long Korean and English captions and the full TTS interval", () => {
    const text = "긴 한국어 자막과 English captions must retain every character. ".repeat(5);
    const chunks = splitDisplayCaptions([{ text, startSeconds: 1, endSeconds: 20 }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(chunks[0]?.startSeconds).toBe(1); expect(chunks.at(-1)?.endSeconds).toBe(20);
    expect(fittedFontSize("긴 한국어 제목을 크기에 맞게 표시합니다.", 800, 280, 78, 36)).not.toBeNull();
  });
  it("requires missing media and unsupported structures to be reviewed", () => {
    const document = fixture();
    expect(inspectTechnicalQuality(document, [], {}).findings).toMatchObject([{ code: "SCENE_ASSET_MISSING" }]);
    document.scenes[0]!.role = "COMPARISON";
    expect(inspectTechnicalQuality(document, [], { one: "image" }).findings.some((finding) => finding.code === "COMPARISON_REQUIRES_TWO_FACTS")).toBe(true);
    document.scenes[0]!.overlays = [{ kind: "title", text: "x".repeat(120) }, { kind: "fact", text: "가".repeat(120) }, { kind: "fact", text: "나".repeat(120) }];
    expect(inspectTechnicalQuality(document, [], { one: "image" }).pass).toBe(false);
  });
  it("detects static intervals, unsafe density and incompatible metric scales", () => {
    const document = fixture(); document.scenes[0]!.visualMode = "GRAPHIC"; document.durationInFrames = 600; document.scenes[0]!.durationInFrames = 600;
    expect(inspectTechnicalQuality(document, [], {}).findings.some((finding) => finding.code === "LONG_STATIC_INTERVAL")).toBe(true);
    expect(inspectTechnicalQuality(fixture(), [{ text: "긴 문장 ".repeat(100), startSeconds: 0, endSeconds: 0.1 }], { one: "image" }).findings.some((finding) => finding.code === "CAPTION_DENSITY_OR_TIMING")).toBe(true);
    document.scenes[0]!.role = "METRIC"; document.scenes[0]!.overlays = [{ kind: "fact", text: "100 km" }, { kind: "fact", text: "200 m" }];
    expect(inspectTechnicalQuality(document, [], {}).findings.some((finding) => finding.code === "METRIC_SCALE_UNSUPPORTED")).toBe(true);
  });
  it("keeps legacy scenes compatible and rejects unsupported overlays", () => {
    const document = fixture(); delete document.scenes[0]!.role;
    expect(SceneDocumentSchema.parse(document).schemaVersion).toBe("1.0.0");
    expect(() => SceneDocumentSchema.parse({ ...document, scenes: [{ ...document.scenes[0], overlays: [{ kind: "chart", text: "Unsupported" }] }] })).toThrow();
    expect(inspectTechnicalQuality(document, [], { one: "image" })).toMatchObject({ pass: true, performancePrediction: false });
  });
});
