import { z } from "zod";

export const SceneDocumentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  title: z.string().min(1),
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.number().int().positive(),
  durationInFrames: z.number().int().positive()
});

export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
