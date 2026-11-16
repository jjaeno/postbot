process.on("uncaughtException", (error) => { console.error(error.message); process.exit(1); });
import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderStill, renderMedia, selectComposition } from "@remotion/renderer";
import { SceneDocumentSchema } from "@postbot/scene-schema";
import { FfmpegPostProcessor, inspectTechnicalQuality } from "../dist/index.js";

const output = process.env.TEMPLATE_SMOKE_OUTPUT ?? fileURLToPath(new URL("../../../.artifacts/templates-2026-11-17/", import.meta.url));
await mkdir(output, { recursive: true });
const roles = ["HOOK", "COMPARISON", "PROCESS", "METRIC", "REVEAL"];
const facts = [["핵심 결과를 첫 프레임에 표시합니다."], ["이전: 20 km", "이후: 100 km"], ["원문을 확인합니다.", "수치를 비교합니다.", "결론을 검토합니다."], ["관측 20 km", "관측 100 km"], ["결론과 출처를 함께 확인하세요."]];
const document = SceneDocumentSchema.parse({ schemaVersion: "1.0.0", platform: "TIKTOK", title: "역할별 장면 검증", width: 1080, height: 1920, fps: 30, durationInFrames: 60,
  scenes: roles.map((role, index) => ({ id: role, role, visualMode: "IMAGE", startFrame: index * 12, durationInFrames: 12, visualPrompt: "synthetic geometry", narration: { text: "검증", sourceUrl: "https://example.org/fixture" }, overlays: [{ kind: "title", text: ["무엇이 달라졌을까요?", "전후 비교", "세 단계 과정", "같은 단위로 비교", "확인된 결과"][index] }, ...facts[index].map((text) => ({ kind: "fact", text })), ...(role === "REVEAL" ? [{ kind: "cta", text: "원문 확인 후 공유하세요." }] : [])] })) });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#184e77"/><stop offset="1" stop-color="#168aad"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="900" cy="250" r="240" fill="#52b69a"/></svg>';
const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const props = { sceneDocument: document, captions: [{ text: "검증", startSeconds: 0, endSeconds: 2 }], sceneAssets: Object.fromEntries(roles.map((role) => [role, image])) };
assert.equal(inspectTechnicalQuality(document, props.captions, props.sceneAssets).pass, true);
const draft = join(output, "templates-draft.mp4");
const resume = process.env.TEMPLATE_SMOKE_RESUME === "1";
if (!resume) {
const serveUrl = await bundle({ entryPoint: fileURLToPath(new URL("../dist/remotion-entry.js", import.meta.url)) });
const composition = await selectComposition({ serveUrl, id: "PostbotShort", inputProps: props });
for (const [index, role] of roles.entries()) {
  const frame = index * 12 + (role === "METRIC" ? 8 : 0);
  await renderStill({ serveUrl, composition, inputProps: props, frame, output: join(output, `${role}.png`), imageFormat: "png" });
  console.log(JSON.stringify({ frame, role }));
}
for (const [name, title, text] of [["long-ko", "긴 한국어 제목과 첫 장면의 핵심 정보를 잘리지 않게 표시하고 실제 안전 영역을 확인합니다.", "긴 한국어 자막을 줄바꿈과 글자 크기 조정으로 보존합니다. ".repeat(6)], ["long-en", "A long English headline with meaningful information that must wrap without clipping", "Long English captions preserve every character and stay synchronized with narration. ".repeat(5)]]) {
  const long = SceneDocumentSchema.parse({ ...document, durationInFrames: 600, scenes: [{ ...document.scenes[0], durationInFrames: 600, overlays: [{ kind: "title", text: title }, { kind: "fact", text: "자막과 화면을 함께 검토합니다." }] }] });
  const inputProps = { sceneDocument: long, captions: [{ text, startSeconds: 0, endSeconds: 20 }], sceneAssets: { HOOK: image } };
  const qa = inspectTechnicalQuality(long, inputProps.captions, inputProps.sceneAssets); assert.equal(qa.pass, true, JSON.stringify(qa));
  const selected = await selectComposition({ serveUrl, id: "PostbotShort", inputProps });
  for (const frame of [0, 180]) await renderStill({ serveUrl, composition: selected, inputProps, frame, output: join(output, `${name}-${frame}.png`), imageFormat: "png" });
}
await renderMedia({ serveUrl, composition, inputProps: props, codec: "h264", outputLocation: draft, concurrency: 1 });
} else {
  for (const name of [...roles.map((role) => `${role}.png`), "long-ko-0.png", "long-ko-180.png", "long-en-0.png", "long-en-180.png", "templates-draft.mp4"]) await access(join(output, name));
}
const audio = join(output, "narration.wav");
const audioResult = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audio]);
assert.equal(audioResult.status, 0, audioResult.stderr?.toString());
const media = new FfmpegPostProcessor(); const video = join(output, "templates-smoke.mp4");
await media.postprocess({ videoInput: draft, narrationInput: audio, output: video });
const qaImage = process.env.TEMPLATE_SMOKE_QA_IMAGE;
let qa;
if (qaImage) {
  const code = "import {FfmpegPostProcessor} from '@postbot/renderer'; console.log(JSON.stringify(await new FfmpegPostProcessor().probe('/qa/templates-smoke.mp4')));";
  const result = spawnSync("docker", ["run", "-i", "--rm", "--network", "none", "--read-only", "--entrypoint", "node", "-v", `${output}:/qa:ro`, qaImage, "--input-type=module"], { input: code, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  qa = JSON.parse(result.stdout.trim());
} else qa = await media.probe(video);
assert.equal(qa.width, 1080); assert.equal(qa.height, 1920); assert.equal(qa.hasAudio, true); assert.ok(Math.abs(qa.durationSeconds - 2) < 0.15); assert.ok(qa.meanVolumeDb > -60); assert.ok(qa.blackFrameRatio < 0.98);
await writeFile(join(output, "result.json"), JSON.stringify({ output, representativeFrames: 9, resumedExistingFrames: resume, qaEnvironment: qaImage ?? "local", qa }, null, 2));
console.log(JSON.stringify({ output, qa }));
