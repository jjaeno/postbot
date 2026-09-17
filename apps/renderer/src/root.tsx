import { Composition } from "remotion";
import { SceneDocumentSchema } from "@postbot/scene-schema";
import type { ReactElement } from "react";
import { z } from "zod";
import { ShortComposition, type ShortCompositionProps } from "./sample-composition.js";
import type { CaptionTiming } from "./scene-math.js";

const sampleScene = SceneDocumentSchema.parse({
  schemaVersion: "1.0.0",
  title: "Postbot Renderer Health",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 450,
  scenes: [{
    id: "health",
    startFrame: 0,
    durationInFrames: 450,
    visualPrompt: "Postbot renderer health screen",
    narration: { text: "Postbot renderer health", sourceUrl: "https://postbot.local/health" },
    overlays: [{ kind: "title", text: "Postbot Renderer Health" }]
  }]
});

const ShortCompositionPropsSchema = z.object({
  sceneDocument: z.custom<typeof sampleScene>(),
  captions: z.array(z.object({ text: z.string(), startSeconds: z.number(), endSeconds: z.number() }))
});

export const RemotionRoot = (): ReactElement => (
  <Composition<typeof ShortCompositionPropsSchema, ShortCompositionProps>
    id="PostbotShort"
    component={ShortComposition}
    schema={ShortCompositionPropsSchema}
    durationInFrames={sampleScene.durationInFrames}
    fps={sampleScene.fps}
    width={sampleScene.width}
    height={sampleScene.height}
    defaultProps={{
      sceneDocument: sampleScene,
      captions: [] as CaptionTiming[]
    }}
    calculateMetadata={({ props }) => {
      const document = props.sceneDocument;
      return {
        durationInFrames: document.durationInFrames,
        fps: document.fps,
        width: document.width,
        height: document.height
      };
    }}
  />
);
