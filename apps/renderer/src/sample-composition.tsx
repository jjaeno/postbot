import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { VideoStyleSchema, type SceneDocument } from "@postbot/scene-schema";
import { useLayoutEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { captionAtFrame, sceneAtFrame, toFrameCaptions, type CaptionTiming } from "./scene-math.js";
import { fittedFontSize, splitDisplayCaptions } from "./text-layout.js";
import { platformSafeArea } from "./technical-quality.js";

export interface ShortCompositionProps extends Record<string, unknown> {
  readonly sceneDocument: SceneDocument;
  readonly captions: readonly CaptionTiming[];
  readonly sceneAssets?: Readonly<Record<string, string>>;
  readonly brandLogo?: string;
}
const textStyle = (text: string, width: number, height: number, preferred: number, minimum = 30): CSSProperties => ({ fontSize: fittedFontSize(text, width, height, preferred, minimum) ?? minimum, lineHeight: 1.22, margin: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap", wordBreak: "normal" });

export const ShortComposition = ({ sceneDocument, captions, sceneAssets = {}, brandLogo }: ShortCompositionProps): ReactElement => {
  const frame = useCurrentFrame(); const style = VideoStyleSchema.parse(sceneDocument.style ?? {});
  const safeElement = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = safeElement.current;
    if (!container) return;
    const boundary = container.getBoundingClientRect();
    // Remotion mounts a zero-size offscreen tree while resolving metadata.
    if (boundary.width === 0 || boundary.height === 0) return;
    const boxes = [...container.querySelectorAll<HTMLElement>("[data-layout-text]")].map((element) => ({ element, rect: element.getBoundingClientRect() }));
    if (boxes.some(({ element, rect }) => element.scrollWidth > element.clientWidth + 2 || rect.left < boundary.left - 2 || rect.right > boundary.right + 2 || rect.top < boundary.top - 2 || rect.bottom > boundary.bottom + 2) || boxes.some((left, index) => boxes.slice(index + 1).some((right) => Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left) > 2 && Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top) > 2))) throw new Error(`RENDER_TEXT_OVERFLOW_REVIEW_REQUIRED:${JSON.stringify({ boundary: { left: boundary.left, top: boundary.top, right: boundary.right, bottom: boundary.bottom }, boxes: boxes.map(({ element, rect }) => ({ kind: element.dataset.layoutText, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })) })}`);
  });
  const scene = sceneAtFrame(sceneDocument, frame); const first = scene?.id === sceneDocument.scenes[0]?.id;
  const role = scene?.role ?? (first ? "HOOK" : "REVEAL");
  const safe = platformSafeArea(sceneDocument.platform); const width = sceneDocument.width - safe.left - safe.right;
  const caption = captionAtFrame(toFrameCaptions(splitDisplayCaptions(captions), sceneDocument.fps), frame);
  const sceneProgress = scene ? Math.max(0, frame - scene.startFrame) : 0;
  const progress = scene ? Math.min(1, sceneProgress / scene.durationInFrames) : 0;
  const sceneAsset = scene ? sceneAssets[scene.id] : undefined;
  const imageOpacity = first ? 1 : interpolate(sceneProgress, [0, 6], [0.5, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titles = scene?.overlays.filter((overlay) => overlay.kind === "title").map((overlay) => overlay.text) ?? [];
  const facts = scene?.overlays.filter((overlay) => overlay.kind === "fact") ?? [];
  const calls = scene?.overlays.filter((overlay) => overlay.kind === "cta") ?? [];
  const headlines = titles.length ? titles : first ? [sceneDocument.title] : [];
  const visibleHeadlines = role !== "HOOK" || sceneProgress < sceneDocument.fps * 2.5;
  const card: CSSProperties = { background: sceneAsset ? "rgba(15,23,42,.76)" : "#ffffff", border: `3px solid ${style.brandColor}`, borderRadius: 28, padding: 24, boxShadow: "0 12px 36px rgba(0,0,0,.12)" };
  const numbers = facts.map((overlay) => Number(/\d+(?:,\d{3})*(?:\.\d+)?/.exec(overlay.text)?.[0]?.replaceAll(",", "") ?? 0));
  const maximum = Math.max(1, ...numbers);
  return <AbsoluteFill style={{ backgroundColor: style.backgroundColor, fontFamily: style.fontFamily }}>
    {sceneAsset ? <Img src={sceneAsset} style={{ height: "100%", left: 0, objectFit: "cover", opacity: imageOpacity, position: "absolute", top: 0, transform: `scale(${1.02 + progress * 0.08})`, width: "100%" }} /> : null}
    <AbsoluteFill style={{ background: sceneAsset ? "linear-gradient(180deg, rgba(15,23,42,.35), rgba(15,23,42,.7))" : "transparent" }} />
    <div ref={safeElement} data-safe-area="true" style={{ position: "absolute", top: safe.top, left: safe.left, right: safe.right, bottom: safe.bottom, color: sceneAsset ? "white" : "#0f172a", display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, minHeight: 64 }}>{brandLogo ? <Img src={brandLogo} style={{ height: 64, width: 128, objectFit: "contain" }} /> : null}<span style={{ color: sceneAsset ? "#ffffff" : style.brandColor, ...textStyle(style.watermark, width - 150, 96, 28, 22) }}>{style.watermark}</span></div>
      <div style={{ minHeight: 220, display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>{visibleHeadlines ? headlines.map((title, index) => <h1 data-layout-text="title" key={index} style={{ ...textStyle(title, width, 280 / Math.max(1, headlines.length), role === "HOOK" ? 78 : 64, 36), fontWeight: 850, textShadow: sceneAsset ? "0 2px 18px rgba(0,0,0,.8)" : "none" }}>{title}</h1>) : null}</div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24 }}>
        {role === "COMPARISON" ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>{facts.map((fact, index) => <div key={index} style={{ ...card, alignSelf: index === 0 ? "start" : "end", borderColor: index === 0 ? style.brandColor : "#f59e0b" }}><p data-layout-text="fact" style={textStyle(fact.text, (width - 32) / 2 - 48, 210, 48)}>{fact.text}</p></div>)}</div>
          : role === "PROCESS" ? facts.map((fact, index) => <div key={index} style={{ ...card, display: "flex", alignItems: "center", gap: 24, opacity: index <= Math.floor(progress * facts.length) ? 1 : 0.55 }}><span style={{ fontSize: 46, fontWeight: 800, color: style.brandColor }}>{String(index + 1).padStart(2, "0")}</span><p data-layout-text="fact" style={textStyle(fact.text, width - 150, 180, 46)}>{fact.text}</p></div>)
          : role === "METRIC" ? facts.map((fact, index) => <div key={index} style={card}><p data-layout-text="fact" style={textStyle(fact.text, width - 64, 180, 58)}>{fact.text}</p><div style={{ height: 30, marginTop: 24, borderRadius: 15, background: "#cbd5e1" }}><div style={{ height: "100%", width: `${Math.max(0, (numbers[index] ?? 0) / maximum) * Math.min(1, (sceneProgress + 1) / Math.max(1, Math.min(18, (scene?.durationInFrames ?? 1) / 2))) * 100}%`, borderRadius: 15, background: style.brandColor }} /></div></div>)
          : facts.map((fact, index) => <div key={index} style={{ ...card, borderLeftWidth: role === "REVEAL" ? 12 : 3, transform: `translateY(${role === "REVEAL" ? Math.max(0, 12 - sceneProgress) : 0}px)` }}><p data-layout-text="fact" style={textStyle(fact.text, width - 64, 210, role === "REVEAL" ? 56 : 50)}>{fact.text}</p></div>)}
      </div>
      {calls.map((call, index) => <p data-layout-text="cta" key={index} style={{ ...textStyle(call.text, width - 64, 180, 40), padding: "16px 24px", background: style.brandColor, color: "white", borderRadius: 20 }}>{call.text}</p>)}
      <div style={{ minHeight: 280, display: "flex", alignItems: "end" }}>{caption ? <p data-layout-text="caption" style={{ ...textStyle(caption.text, width - 48, 280, style.captionFontSize, 32), width: "100%", background: style.captionBackground, borderRadius: 16, color: style.captionColor, fontWeight: 700, padding: "16px 24px", boxSizing: "border-box" }}>{caption.text}</p> : null}</div>
    </div>
  </AbsoluteFill>;
};
