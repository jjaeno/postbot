import { Composition } from "remotion";
import { SceneDocumentSchema } from "@postbot/scene-schema";
import type { ReactElement } from "react";
import { SampleComposition } from "./sample-composition";

const sampleScene = SceneDocumentSchema.parse({
  schemaVersion: "1.0.0",
  title: "Postbot Renderer Health",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 450
});

export const RemotionRoot = (): ReactElement => (
  <Composition
    id="PostbotHealth"
    component={SampleComposition}
    durationInFrames={sampleScene.durationInFrames}
    fps={sampleScene.fps}
    width={sampleScene.width}
    height={sampleScene.height}
    defaultProps={{
      title: sampleScene.title
    }}
  />
);
