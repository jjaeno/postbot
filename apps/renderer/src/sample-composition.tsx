import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { SceneDocument } from "@postbot/scene-schema";
import type { ReactElement } from "react";
import { SAFE_AREA, captionAtFrame, sceneAtFrame, toFrameCaptions, type CaptionTiming } from "./scene-math.js";

export interface ShortCompositionProps extends Record<string, unknown> {
  readonly sceneDocument: SceneDocument;
  readonly captions: readonly CaptionTiming[];
}

export const ShortComposition = ({ sceneDocument, captions }: ShortCompositionProps): ReactElement => {
  const frame = useCurrentFrame();
  const scene = sceneAtFrame(sceneDocument, frame);
  const caption = captionAtFrame(toFrameCaptions(captions, sceneDocument.fps), frame);
  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        backgroundColor: "#f8fafc",
        color: "#0f172a",
        display: "flex",
        fontFamily: "Arial, sans-serif",
        justifyContent: "center",
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.right}px ${SAFE_AREA.bottom}px`
      }}
    >
      <div style={{ opacity, textAlign: "center" }}>
        <p style={{ color: "#0f766e", fontSize: 40, margin: 0 }}>Postbot</p>
        <h1 style={{ fontSize: 78, lineHeight: 1.1, margin: "24px 0 0" }}>{sceneDocument.title}</h1>
        <p style={{ fontSize: 42, lineHeight: 1.25, marginTop: 72 }}>{scene?.overlays[0]?.text ?? ""}</p>
        {caption ? <p style={{ fontSize: 52, fontWeight: 700, marginTop: 96 }}>{caption.text}</p> : null}
      </div>
    </AbsoluteFill>
  );
};
