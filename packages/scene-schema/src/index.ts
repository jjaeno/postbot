import { z } from "zod";

export const SceneNarrationSchema = z.object({
  text: z.string().min(1).max(500),
  sourceUrl: z.string().url()
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

// Use the script's actual spoken text rather than an independently generated paraphrase.
export function alignSceneNarration(document: SceneDocument, text: string): SceneDocument {
  const words = text.trim().split(/\s+/u);
  const scenes = document.scenes.slice(0, Math.min(words.length, document.scenes.length));
  let start = 0;
  return SceneDocumentSchema.parse({ ...document, scenes: scenes.map((scene, index) => {
    const end = Math.round((index + 1) * words.length / scenes.length);
    const startFrame = Math.round(index * document.durationInFrames / scenes.length);
    const endFrame = Math.round((index + 1) * document.durationInFrames / scenes.length);
    const narration = { ...scene.narration, text: words.slice(start, end).join(" ") }; start = end;
    return { ...scene, narration, startFrame, durationInFrames: endFrame - startFrame };
  }) });
}
