import { z } from "zod";

export const SceneNarrationSchema = z.object({
  text: z.string().min(1).max(500),
  sourceUrl: z.string().url(),
  scriptRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).refine((range) => range.end > range.start, { message: "SCRIPT_RANGE_INVALID" }).optional()
});

export const SceneOverlaySchema = z.object({
  text: z.string().min(1).max(500),
  kind: z.enum(["title", "fact", "cta"])
}).strict();

export const SceneSchema = z.object({
  role: z.enum(["HOOK", "COMPARISON", "PROCESS", "METRIC", "REVEAL"]).optional(),
  visualMode: z.enum(["IMAGE", "GRAPHIC"]).optional(),
  id: z.string().min(1).max(80),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  visualPrompt: z.string().min(1).max(500),
  narration: SceneNarrationSchema,
  overlays: z.array(SceneOverlaySchema).min(1).max(4)
});

export const VideoStyleSchema = z.object({
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#0f766e"),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#f8fafc"),
  fontFamily: z.enum(["Arial", "sans-serif", "serif"]).default("Arial"),
  watermark: z.string().max(60).default("Postbot"),
  logoAssetId: z.string().min(1).max(80).optional(),
  captionColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#ffffff"),
  captionBackground: z.string().regex(/^#[0-9a-f]{6}$/i).default("#0f172a"),
  captionFontSize: z.number().int().min(32).max(64).default(52)
});
export type VideoStyle = z.infer<typeof VideoStyleSchema>;
export const AudioStyleSchema = z.object({ bgmAssetId: z.string().min(1).max(80).optional(), sfxAssetId: z.string().min(1).max(80).optional(), bgmVolume: z.number().min(0).max(1).default(0.2), sfxVolume: z.number().min(0).max(1).default(0.2) });

export const aiSceneCount = (sceneCount: number, aiStockRatio: number): number => Math.round(sceneCount * Math.max(0, Math.min(1, aiStockRatio)));

export const SceneDocumentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  platform: z.enum(["YOUTUBE", "INSTAGRAM", "TIKTOK"]).optional(),
  title: z.string().min(1),
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.number().int().positive(),
  durationInFrames: z.number().int().positive(),
  style: VideoStyleSchema.optional(),
  audio: AudioStyleSchema.optional(),
  aiStockRatio: z.number().min(0).max(1).optional(),
  scenes: z.array(SceneSchema).min(1).max(12)
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  let frame = 0;
  for (const scene of value.scenes) {
    if (ids.has(scene.id) || scene.startFrame !== frame) ctx.addIssue({ code: "custom", path: ["scenes"], message: "Scenes require unique IDs and contiguous ordered timing." });
    ids.add(scene.id); frame = scene.startFrame + scene.durationInFrames;
  }
  if (frame !== value.durationInFrames) ctx.addIssue({ code: "custom", path: ["scenes"], message: "Scenes must cover the entire document." });
  const lastFrame = Math.max(...value.scenes.map((scene) => scene.startFrame + scene.durationInFrames));
  if (lastFrame > value.durationInFrames) {
    ctx.addIssue({
      code: "custom",
      path: ["scenes"],
      message: "Scene timing exceeds document duration."
    });
  }
});

export const SceneDocumentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Postbot SceneDocument",
  type: "object",
  required: ["schemaVersion", "title", "width", "height", "fps", "durationInFrames", "scenes"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    title: { type: "string", minLength: 1 },
    width: { const: 1080 },
    height: { const: 1920 },
    fps: { type: "integer", minimum: 1 },
    durationInFrames: { type: "integer", minimum: 1 },
    scenes: {
      type: "array",
      minItems: 1,
      maxItems: 12
    }
  }
} as const;

export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
export type Scene = z.infer<typeof SceneSchema>;

export type NarrationTiming = { text: string; startSeconds: number; endSeconds: number };
const spoken = (text: string): string => text.replace(/\s+/gu, "");

export function retimeNarration(document: SceneDocument, timings: readonly NarrationTiming[], durationSeconds: number, bounds: { min: number; max: number }): SceneDocument {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > bounds.max) throw new Error("NARRATION_DURATION_EXCEEDED_SHORTEN_SCRIPT_AND_REGENERATE_VOICE");
  let last = 0;
  for (const timing of timings) {
    if (!spoken(timing.text) || !Number.isFinite(timing.startSeconds) || !Number.isFinite(timing.endSeconds) || timing.startSeconds < last || timing.endSeconds <= timing.startSeconds || timing.endSeconds > durationSeconds + 0.1) throw new Error("NARRATION_TIMING_INVALID");
    last = timing.endSeconds;
  }
  if (!timings.length || spoken(timings.map((entry) => entry.text).join("")) !== spoken(document.scenes.map((scene) => scene.narration.text).join(""))) throw new Error("NARRATION_TEXT_MISMATCH_REGENERATE_VOICE");
  const durationInFrames = Math.ceil(Math.max(bounds.min, durationSeconds) * document.fps);
  let character = 0; let frame = 0;
  const boundary = (offset: number): number => {
    let count = 0;
    for (const timing of timings) {
      const length = spoken(timing.text).length;
      if (offset <= count + length) return timing.startSeconds + (timing.endSeconds - timing.startSeconds) * (offset - count) / length;
      count += length;
    }
    return durationSeconds;
  };
  return SceneDocumentSchema.parse({ ...document, durationInFrames, scenes: document.scenes.map((scene, index) => {
    character += spoken(scene.narration.text).length;
    const end = index === document.scenes.length - 1 ? durationInFrames : Math.round(boundary(character) * document.fps);
    const result = { ...scene, startFrame: frame, durationInFrames: end - frame }; frame = end; return result;
  }) });
}

// Keep exact ordered narration anchors. Only a single changed scene between
// anchors can absorb an edit; ambiguous multi-scene edits require a new plan.
// Offsets refer to the whitespace-normalized script passed to TTS.
export function alignSceneNarration(document: SceneDocument, text: string): SceneDocument {
  const script = text.trim().replace(/\s+/gu, " ");
  if (!script) throw new Error("SCENE_NARRATION_EMPTY");
  if (document.scenes.length === 1) return SceneDocumentSchema.parse({ ...document, scenes: [{ ...document.scenes[0], narration: { ...document.scenes[0]!.narration, text: script, scriptRange: { start: 0, end: script.length } } }] });
  const anchors: Array<{ index: number; start: number; end: number }> = [];
  let cursor = 0;
  for (const [index, scene] of document.scenes.entries()) {
    const narration = scene.narration.text.trim().replace(/\s+/gu, " ");
    const start = script.indexOf(narration, cursor);
    if (start >= 0 && (start === 0 || script[start - 1] === " ") && (start + narration.length === script.length || script[start + narration.length] === " ")) {
      anchors.push({ index, start, end: start + narration.length }); cursor = start + narration.length;
    }
  }
  const ranges = new Map<number, { start: number; end: number }>();
  let index = -1; let end = 0;
  for (const anchor of [...anchors, { index: document.scenes.length, start: script.length, end: script.length }]) {
    let gapStart = end; while (script[gapStart] === " ") gapStart++;
    let gapEnd = anchor.start; while (gapEnd > gapStart && script[gapEnd - 1] === " ") gapEnd--;
    const missing = anchor.index - index - 1;
    if (missing === 1 && gapEnd > gapStart) ranges.set(index + 1, { start: gapStart, end: gapEnd });
    else if (missing !== 0 || gapEnd > gapStart) throw new Error("SCENE_NARRATION_SEMANTIC_ALIGNMENT_REQUIRED");
    if (anchor.index < document.scenes.length) ranges.set(anchor.index, { start: anchor.start, end: anchor.end });
    index = anchor.index; end = anchor.end;
  }
  const result = SceneDocumentSchema.parse({ ...document, scenes: document.scenes.map((scene, index) => {
    const range = ranges.get(index); if (!range) throw new Error("SCENE_NARRATION_SEMANTIC_ALIGNMENT_REQUIRED");
    return { ...scene, narration: { ...scene.narration, text: script.slice(range.start, range.end), scriptRange: range } };
  }) });
  if (result.scenes.map((scene) => scene.narration.text).join(" ") !== script) throw new Error("SCENE_NARRATION_COVERAGE_MISMATCH");
  return result;
}

export const sceneReuseDecision = (before: Scene, after: Scene): { reusable: boolean; reason: string } => {
  const reusable = before.narration.text === after.narration.text && before.narration.sourceUrl === after.narration.sourceUrl &&
    before.visualPrompt === after.visualPrompt && before.visualMode === after.visualMode && before.role === after.role && JSON.stringify(before.overlays) === JSON.stringify(after.overlays);
  return { reusable, reason: reusable ? "SCENE_MEANING_AND_VISUAL_INPUT_UNCHANGED" : "SCENE_INPUT_CHANGED_REGENERATE_VISUAL" };
};
