import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { VideoStyleSchema, type SceneDocument } from "@postbot/scene-schema";
import type { ReactElement } from "react";
import { SAFE_AREA, captionAtFrame, sceneAtFrame, toFrameCaptions, type CaptionTiming } from "./scene-math.js";

export interface ShortCompositionProps extends Record<string, unknown> {
  readonly sceneDocument: SceneDocument;
  readonly captions: readonly CaptionTiming[];
  readonly sceneAssets?: Readonly<Record<string, string>>;
  readonly brandLogo?: string;
}

export const ShortComposition = ({ sceneDocument, captions, sceneAssets = {}, brandLogo }: ShortCompositionProps): ReactElement => {
  const frame = useCurrentFrame();
  const style = VideoStyleSchema.parse(sceneDocument.style ?? {});
  const scene = sceneAtFrame(sceneDocument, frame);
  const caption = captionAtFrame(toFrameCaptions(captions, sceneDocument.fps), frame);
  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const sceneAsset = scene ? sceneAssets[scene.id] : undefined;
  const sceneProgress = scene ? Math.max(0, frame - scene.startFrame) : 0;
  const imageOpacity = interpolate(sceneProgress, [0, Math.min(12, Math.max(1, (scene?.durationInFrames ?? 1) / 4))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const imageScale = interpolate(sceneProgress, [0, scene?.durationInFrames ?? 1], [1.02, 1.1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        backgroundColor: style.backgroundColor,
        color: "#0f172a",
        display: "flex",
        fontFamily: style.fontFamily,
        justifyContent: "center",
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.right}px ${SAFE_AREA.bottom}px`
      }}
    >
      {sceneAsset ? <Img src={sceneAsset} style={{ height: "100%", left: 0, objectFit: "cover", opacity: imageOpacity, position: "absolute", top: 0, transform: `scale(${imageScale})`, width: "100%" }} /> : null}
      <AbsoluteFill style={{ background: sceneAsset ? "linear-gradient(180deg, rgba(15,23,42,.2), rgba(15,23,42,.78))" : "transparent" }} />
      <div style={{ color: sceneAsset ? "white" : "#0f172a", opacity, position: "relative", textAlign: "center", textShadow: sceneAsset ? "0 2px 16px rgba(0,0,0,.65)" : "none" }}>
        {brandLogo ? <Img src={brandLogo} style={{ height: 96, width: 192, objectFit: "contain" }} /> : null}
        <p style={{ color: style.brandColor, fontSize: 40, margin: 0 }}>{style.watermark}</p>
        <h1 style={{ fontSize: 78, lineHeight: 1.1, margin: "24px 0 0", maxHeight: 258, overflow: "hidden", overflowWrap: "anywhere" }}>{sceneDocument.title}</h1>
        <p style={{ fontSize: 42, lineHeight: 1.25, marginTop: 72, maxHeight: 158, overflow: "hidden" }}>{scene?.overlays[0]?.text ?? ""}</p>
        {caption ? <p style={{ backgroundColor: style.captionBackground, borderRadius: 12, color: style.captionColor, fontSize: style.captionFontSize, fontWeight: 700, marginTop: 96, padding: "12px 24px", overflowWrap: "anywhere" }}>{caption.text}</p> : null}
      </div>
    </AbsoluteFill>
  );
};
