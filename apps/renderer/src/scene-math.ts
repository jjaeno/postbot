import type { Scene, SceneDocument } from "@postbot/scene-schema";

export const SHORTS_WIDTH = 1080;
export const SHORTS_HEIGHT = 1920;
export const SAFE_AREA = { top: 180, right: 72, bottom: 240, left: 72 } as const;

export type CaptionTiming = {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
};

export type FrameCaption = CaptionTiming & {
  readonly startFrame: number;
  readonly endFrame: number;
};

export const sceneEndFrame = (scene: Scene): number => scene.startFrame + scene.durationInFrames;

export const sceneFrames = (document: SceneDocument): readonly number[] =>
  document.scenes.map(sceneEndFrame);

export const toFrameCaptions = (captions: readonly CaptionTiming[], fps: number): readonly FrameCaption[] =>
  captions.map((caption) => ({
    ...caption,
    startFrame: Math.max(0, Math.floor(caption.startSeconds * fps)),
    endFrame: Math.max(1, Math.ceil(caption.endSeconds * fps))
  }));

export const captionAtFrame = (captions: readonly FrameCaption[], frame: number): FrameCaption | null =>
  captions.find((caption) => frame >= caption.startFrame && frame < caption.endFrame) ?? null;

export const sceneAtFrame = (document: SceneDocument, frame: number): Scene | null =>
  document.scenes.find((scene) => frame >= scene.startFrame && frame < sceneEndFrame(scene)) ?? null;

export const assertRenderableDocument = (document: SceneDocument): void => {
  if (document.width !== SHORTS_WIDTH || document.height !== SHORTS_HEIGHT) {
    throw new Error("Only 1080x1920 SceneDocuments are renderable.");
  }
  if (sceneFrames(document).some((endFrame) => endFrame > document.durationInFrames)) {
    throw new Error("Scene timing exceeds the document duration.");
  }
};
