import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { ReactElement } from "react";

export interface SampleCompositionProps {
  readonly title?: string;
}

export const SampleComposition = ({ title = "Postbot Renderer Health" }: SampleCompositionProps): ReactElement => {
  const frame = useCurrentFrame();
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
        padding: 96
      }}
    >
      <div style={{ opacity, textAlign: "center" }}>
        <p style={{ color: "#0f766e", fontSize: 40, margin: 0 }}>Postbot</p>
        <h1 style={{ fontSize: 78, lineHeight: 1.1, margin: "24px 0 0" }}>{title}</h1>
      </div>
    </AbsoluteFill>
  );
};
