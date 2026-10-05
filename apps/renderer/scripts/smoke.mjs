import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { FfmpegPostProcessor, RemotionVideoRenderer } from "../dist/index.js";

const durations = (process.env.RENDER_SMOKE_DURATIONS ?? "15,60").split(",").map(Number);
for (const durationSeconds of durations) {
  const outputLocation = `/tmp/postbot-renderer-smoke-${durationSeconds}.mp4`;
  const draftLocation = `/tmp/postbot-renderer-smoke-${durationSeconds}-draft.mp4`;
  const narrationLocation = `/tmp/postbot-renderer-smoke-${durationSeconds}.wav`;
  const durationInFrames = durationSeconds * 30;
  const sceneDocument = {
    schemaVersion: "1.0.0", title: `Postbot ${durationSeconds}s renderer smoke`, width: 1080, height: 1920, fps: 30, durationInFrames,
    scenes: [{ id: "smoke", startFrame: 0, durationInFrames, visualPrompt: "Postbot renderer smoke", narration: { text: "Postbot renderer smoke", sourceUrl: "https://postbot.local/renderer-smoke" }, overlays: [{ kind: "title", text: "Postbot renderer smoke" }] }]
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#ff00ff"/></svg>`;
  const sceneAssets = { smoke: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
  try {
    await new RemotionVideoRenderer().render({ sceneDocument, captions: [], sceneAssets, outputLocation: draftLocation });
    const audio = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=880:duration=${durationSeconds}`, "-c:a", "pcm_s16le", narrationLocation]);
    if (audio.status !== 0) throw new Error(`Could not create smoke narration: ${audio.stderr.toString("utf8")}`);
    const processor = new FfmpegPostProcessor();
    await processor.postprocess({ videoInput: draftLocation, narrationInput: narrationLocation, output: outputLocation });
    const result = await processor.probe(outputLocation);
    if (result.width !== 1080 || result.height !== 1920 || Math.abs(result.durationSeconds - durationSeconds) > 0.2 || !result.hasAudio || result.meanVolumeDb === null || (result.blackFrameRatio ?? 0) > 0.98) {
      throw new Error(`Unexpected renderer smoke result: ${JSON.stringify(result)}`);
    }
    const pixel = spawnSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", outputLocation, "-vf", "crop=2:2:100:100", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: null });
    if (pixel.status !== 0 || pixel.stdout.length < 3 || pixel.stdout[0] < pixel.stdout[1] + 50 || pixel.stdout[2] < pixel.stdout[1] + 50) {
      throw new Error(`Scene asset was not visible in the rendered frame: rgb=${[...pixel.stdout.subarray(0, 3)].join(",")} ffmpeg=${pixel.stderr.toString("utf8")}`);
    }
    console.log(JSON.stringify({ fixtureSeconds: durationSeconds, sceneAssetPixelRgb: [...pixel.stdout.subarray(0, 3)], ...result }));
  } finally {
    await Promise.all([rm(outputLocation, { force: true }), rm(draftLocation, { force: true }), rm(narrationLocation, { force: true })]);
  }
}
