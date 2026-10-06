import { z } from "zod";

export const SceneNarrationSchema = z.object({
  text: z.string().min(1).max(500),
  sourceUrl: z.string().url()
});

export const SceneOverlaySchema = z.object({
  text: z.string().min(1).max(120),
  kind: z.enum(["title", "fact", "cta"])
});

export const SceneSchema = z.object({
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
