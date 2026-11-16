import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeTtsProvider } from "@postbot/providers";
import { alignSceneNarration, retimeNarration } from "@postbot/scene-schema";
import { FfmpegPostProcessor, RemotionVideoRenderer } from "@postbot/renderer";

const directory = await mkdtemp(join(tmpdir(), "postbot-mvp-media-"));
try {
  const media = new FfmpegPostProcessor();
  for (const repetitions of [1, 3]) {
    const text = Array.from({ length: repetitions }, () => "한국어 첫 장면을 확인합니다 다음 장면과 자막을 함께 확인합니다").join(" ");
    const speech = await new FakeTtsProvider().synthesize({ model: "local-fixture", voice: "fixture", text, idempotencyKey: `local-${repetitions}` });
    const audio = join(directory, `voice-${repetitions}.wav`); await writeFile(audio, speech.bytes);
    const probe = await media.probe(audio);
    assert.equal(probe.hasAudio, true);
    const base = { schemaVersion: "1.0.0", title: "로컬 음성·자막 검증", width: 1080, height: 1920, fps: 30, durationInFrames: 900,
      scenes: [0, 1].map((index) => ({ id: `scene-${index}`, startFrame: index * 450, durationInFrames: 450, visualPrompt: "fixture", narration: { text: "placeholder", sourceUrl: "https://example.com/fixture" }, overlays: [{ kind: "title", text: "한국어 자막 검증" }] })) };
    const document = retimeNarration(alignSceneNarration(base, text), speech.timings, probe.durationSeconds, { min: 1, max: 60 });
    const draft = join(directory, `draft-${repetitions}.mp4`); const output = join(directory, `output-${repetitions}.mp4`);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#306090"/></svg>';
    await new RemotionVideoRenderer(1).render({ sceneDocument: document, captions: speech.timings, sceneAssets: Object.fromEntries(document.scenes.map((scene) => [scene.id, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`])), outputLocation: draft });
    await media.postprocess({ videoInput: draft, narrationInput: audio, output });
    const qa = await media.probe(output);
    assert.equal(qa.width, 1080); assert.equal(qa.height, 1920); assert.equal(qa.hasAudio, true);
    assert.ok(Math.abs(qa.durationSeconds - probe.durationSeconds) < 0.15);
    assert.ok(qa.meanVolumeDb > -60); assert.ok(qa.blackFrameRatio < 0.98);
    console.log(JSON.stringify({ repetitions, spokenText: text, captions: speech.timings.length, audioSeconds: probe.durationSeconds, sceneStarts: document.scenes.map((scene) => scene.startFrame), qa }));
  }
} finally { await rm(directory, { recursive: true, force: true }); }
