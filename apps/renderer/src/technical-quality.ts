import type { SceneDocument } from "@postbot/scene-schema";
import type { CaptionTiming } from "./scene-math.js";
import { fittedFontSize, splitDisplayCaptions, textUnits } from "./text-layout.js";

export const platformSafeArea = (platform: SceneDocument["platform"]) => platform === "TIKTOK" ? { top: 180, right: 190, bottom: 380, left: 72 } : platform === "INSTAGRAM" ? { top: 220, right: 120, bottom: 380, left: 72 } : { top: 180, right: 120, bottom: 320, left: 72 };
export type TechnicalFinding = { code: string; sceneId?: string; message: string };
export class RenderQualityReviewError extends Error {
  constructor(readonly findings: readonly TechnicalFinding[]) { super("RENDER_TECHNICAL_REVIEW_REQUIRED"); }
}
export function inspectTechnicalQuality(document: SceneDocument, captions: readonly CaptionTiming[], assets: Readonly<Record<string, string>>) {
  const findings: TechnicalFinding[] = [];
  const area = platformSafeArea(document.platform); const width = document.width - area.left - area.right;
  if (!document.scenes[0]?.overlays.some((overlay) => overlay.kind === "title") && fittedFontSize(document.title, width, 280, 78, 36) === null) findings.push({ code: "TITLE_OVERFLOW", message: "Shorten the title or split it across scenes." });
  for (const scene of document.scenes) {
    if ((scene.visualMode === "IMAGE" || (scene.visualMode !== "GRAPHIC" && Object.keys(assets).length > 0)) && !assets[scene.id]) findings.push({ code: "SCENE_ASSET_MISSING", sceneId: scene.id, message: "Prepare the scene image or explicitly choose a graphic template." });
    const facts = scene.overlays.filter((overlay) => overlay.kind === "fact");
    if (scene.role === "COMPARISON" && facts.length !== 2) findings.push({ code: "COMPARISON_REQUIRES_TWO_FACTS", sceneId: scene.id, message: "Provide two comparison values." });
    if (scene.role === "METRIC" && !facts.some((overlay) => /\d/u.test(overlay.text))) findings.push({ code: "METRIC_VALUE_REQUIRED", sceneId: scene.id, message: "A numeric metric must come from the scene content." });
    if (scene.role === "METRIC") {
      const units = facts.map((fact) => /\d+(?:,\d{3})*(?:\.\d+)?\s*([\p{L}%]+)/u.exec(fact.text)?.[1] ?? "");
      if (new Set(units).size > 1 || facts.some((fact) => /-\d|\d[eE][+-]?\d/u.test(fact.text))) findings.push({ code: "METRIC_SCALE_UNSUPPORTED", sceneId: scene.id, message: "Use nonnegative values with a common explicit unit." });
    }
    const staticSeconds = scene.durationInFrames / document.fps / (scene.role === "PROCESS" ? Math.max(1, facts.length) : 1) - (scene.role === "METRIC" ? 0.6 : 0);
    if (scene.visualMode === "GRAPHIC" && staticSeconds > 12) findings.push({ code: "LONG_STATIC_INTERVAL", sceneId: scene.id, message: "Split the long static scene or add meaningful visual changes." });
    const heights: number[] = [];
    for (const overlay of scene.overlays) {
      const overlayWidth = scene.role === "COMPARISON" && overlay.kind === "fact" ? (width - 32) / 2 - 48 : scene.role === "PROCESS" && overlay.kind === "fact" ? width - 150 : width - 64;
      const fontSize = fittedFontSize(overlay.text, overlayWidth, overlay.kind === "title" ? 280 : scene.role === "PROCESS" ? 180 : 210, overlay.kind === "title" ? 72 : 48, 30);
      if (fontSize === null) findings.push({ code: "OVERLAY_OVERFLOW", sceneId: scene.id, message: "Split this overlay across scenes." });
      heights.push(Math.ceil(textUnits(overlay.text) * (fontSize ?? 30) / overlayWidth) * (fontSize ?? 30) * 1.22 + (overlay.kind === "fact" ? 54 + (scene.role === "METRIC" ? 54 : 0) : overlay.kind === "cta" ? 32 : 0));
    }
    const factHeights = heights.filter((_, index) => scene.overlays[index]?.kind === "fact");
    const titleHeight = heights.reduce((sum, height, index) => sum + (scene.overlays[index]?.kind === "title" ? height + 12 : 0), 0);
    const ctaHeight = heights.reduce((sum, height, index) => sum + (scene.overlays[index]?.kind === "cta" ? height + 28 : 0), 0);
    const bodyHeight = scene.role === "COMPARISON" ? Math.max(0, ...factHeights) : factHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, factHeights.length - 1) * 24;
    if (64 + Math.max(220, titleHeight) + bodyHeight + ctaHeight + 280 + 4 * 28 > document.height - area.top - area.bottom) findings.push({ code: "LAYOUT_DENSITY", sceneId: scene.id, message: "Split this scene into fewer text blocks." });
  }
  for (const caption of splitDisplayCaptions(captions)) {
    const duration = caption.endSeconds - caption.startSeconds;
    if (duration <= 0 || caption.startSeconds < 0 || caption.endSeconds > document.durationInFrames / document.fps + 0.1 || duration < 0.3 - 0.001 || textUnits(caption.text) / duration > 30) findings.push({ code: "CAPTION_DENSITY_OR_TIMING", message: "Regenerate caption timing or shorten the narration; text cannot be hidden." });
    if (fittedFontSize(caption.text, width - 48, 300, document.style?.captionFontSize ?? 52, 32) === null) findings.push({ code: "CAPTION_OVERFLOW", message: "Split the caption into readable timed segments." });
  }
  return { version: "technical-layout-v1", findings, pass: findings.length === 0, performancePrediction: false };
}
