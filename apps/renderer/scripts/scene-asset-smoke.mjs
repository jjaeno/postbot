import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const output = process.env.RENDER_ASSET_SMOKE_OUTPUT ?? join(tmpdir(), "postbot-scene-asset-smoke.png");
const sceneDocument = {
  schemaVersion: "1.0.0", title: "Scene asset smoke", width: 1080, height: 1920, fps: 30, durationInFrames: 90,
  scenes: [{ id: "visible-image", startFrame: 0, durationInFrames: 90, visualPrompt: "magenta test image", narration: { text: "Scene image is visible", sourceUrl: "https://postbot.local/renderer-smoke" }, overlays: [{ kind: "title", text: "장면 이미지 렌더 검증" }] }]
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="g"><stop stop-color="#ff00ff"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="180" cy="180" r="100" fill="#fef08a"/></svg>`;
const inputProps = { sceneDocument, captions: [], sceneAssets: { "visible-image": `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` } };
const serveUrl = await bundle({ entryPoint: fileURLToPath(new URL("../dist/remotion-entry.js", import.meta.url)) });
const composition = await selectComposition({ serveUrl, id: "PostbotShort", inputProps });
await renderStill({ composition, serveUrl, inputProps, frame: 30, output, imageFormat: "png" });
console.log(JSON.stringify({ output, width: composition.width, height: composition.height, frame: 30, sceneAssetId: "visible-image" }));
