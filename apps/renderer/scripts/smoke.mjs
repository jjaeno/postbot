import { rm } from "node:fs/promises";
import { FfmpegPostProcessor, RemotionVideoRenderer } from "../dist/index.js";

const durations = (process.env.RENDER_SMOKE_DURATIONS ?? "15,60").split(",").map(Number);
for (const durationSeconds of durations) {
  const outputLocation = `/tmp/postbot-renderer-smoke-${durationSeconds}.mp4`;
  const durationInFrames = durationSeconds * 30;
  const sceneDocument = {
    schemaVersion: "1.0.0", title: `Postbot ${durationSeconds}s renderer smoke`, width: 1080, height: 1920, fps: 30, durationInFrames,
    scenes: [{ id: "smoke", startFrame: 0, durationInFrames, visualPrompt: "Postbot renderer smoke", narration: { text: "Postbot renderer smoke", sourceUrl: "https://postbot.local/renderer-smoke" }, overlays: [{ kind: "title", text: "Postbot renderer smoke" }] }]
  };
  try {
    await new RemotionVideoRenderer().render({ sceneDocument, captions: [], outputLocation });
    const result = await new FfmpegPostProcessor().probe(outputLocation);
    if (result.width !== 1080 || result.height !== 1920 || Math.abs(result.durationSeconds - durationSeconds) > 0.2 || (result.blackFrameRatio ?? 0) > 0.98) {
      throw new Error(`Unexpected renderer smoke result: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify({ fixtureSeconds: durationSeconds, ...result }));
  } finally {
    await rm(outputLocation, { force: true });
  }
}
