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

export const SceneDocumentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  title: z.string().min(1),
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.number().int().positive(),
  durationInFrames: z.number().int().positive(),
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
