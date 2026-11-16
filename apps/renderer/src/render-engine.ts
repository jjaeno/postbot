import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { SceneDocument } from "@postbot/scene-schema";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CaptionTiming } from "./scene-math.js";
import { assertRenderableDocument } from "./scene-math.js";
import { inspectTechnicalQuality, RenderQualityReviewError } from "./technical-quality.js";

export const RENDERER_VERSION = "1.2.0";

export type RenderInput = {
  readonly sceneDocument: SceneDocument;
  readonly captions: readonly CaptionTiming[];
  readonly sceneAssets?: Readonly<Record<string, string>>;
  readonly brandLogo?: string;
  readonly outputLocation: string;
};

export type RenderedMedia = {
  readonly outputLocation: string;
  readonly rendererVersion: string;
};

export interface VideoRenderer {
  render(input: RenderInput): Promise<RenderedMedia>;
}

export class RemotionVideoRenderer implements VideoRenderer {
  constructor(private readonly concurrency = 2) {}
  async render(input: RenderInput): Promise<RenderedMedia> {
    assertRenderableDocument(input.sceneDocument);
    const quality = inspectTechnicalQuality(input.sceneDocument, input.captions, input.sceneAssets ?? {});
    if (!quality.pass) throw new RenderQualityReviewError(quality.findings);
    await mkdir(dirname(input.outputLocation), { recursive: true });
    const entryPoint = fileURLToPath(new URL("./remotion-entry.js", import.meta.url));
    const serveUrl = await bundle({ entryPoint });
    const inputProps = { sceneDocument: input.sceneDocument, captions: input.captions, sceneAssets: input.sceneAssets ?? {}, brandLogo: input.brandLogo };
    try {
    const composition = await selectComposition({ serveUrl, id: "PostbotShort", inputProps });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      concurrency: this.concurrency,
      outputLocation: input.outputLocation,
      inputProps
    }); } catch (error) {
      if (error instanceof Error && error.message.includes("RENDER_TEXT_OVERFLOW_REVIEW_REQUIRED")) throw new RenderQualityReviewError([{ code: "MEASURED_TEXT_OVERFLOW", message: "Browser-measured text overflow or overlap requires layout review." }]);
      throw error;
    }
    return { outputLocation: input.outputLocation, rendererVersion: RENDERER_VERSION };
  }
}

const run = async (command: string, args: readonly string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? "unknown"}.`)));
  });
};

export type FfprobeResult = { readonly durationSeconds: number; readonly width: number; readonly height: number; readonly hasAudio?: boolean; readonly meanVolumeDb?: number | null; readonly blackFrameRatio?: number };

export class FfmpegPostProcessor {
  async postprocess(input: { readonly videoInput: string; readonly output: string; readonly narrationInput?: string; readonly backgroundInput?: string; readonly effectsInput?: string; readonly backgroundVolume?: number; readonly effectsVolume?: number }): Promise<void> {
    await mkdir(dirname(input.output), { recursive: true });
    const args = ["-y", "-i", input.videoInput];
    const tracks: Array<{ path: string; volume: number; loop: boolean }> = [];
    if (input.narrationInput) tracks.push({ path: input.narrationInput, volume: 1, loop: false });
    if (input.backgroundInput) tracks.push({ path: input.backgroundInput, volume: input.backgroundVolume ?? 0.2, loop: true });
    if (input.effectsInput) tracks.push({ path: input.effectsInput, volume: input.effectsVolume ?? 0.2, loop: false });
    if (tracks.some((track) => !Number.isFinite(track.volume) || track.volume < 0 || track.volume > 1)) throw new Error("AUDIO_VOLUME_INVALID");
    for (const track of tracks) { if (track.loop) args.push("-stream_loop", "-1"); args.push("-i", track.path); }
    if (tracks.length) {
      const filters = tracks.map((track, index) => `[${index + 1}:a]volume=${track.volume}[track${index}]`);
      filters.push(`${tracks.map((_, index) => `[track${index}]`).join("")}amix=inputs=${tracks.length}:duration=longest:normalize=0,apad[a]`);
      args.push("-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[a]");
    } else args.push("-map", "0:v:0");
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", input.output);
    await run("ffmpeg", args);
  }

  async thumbnail(videoInput: string, output: string): Promise<void> {
    await run("ffmpeg", ["-y", "-ss", "0.5", "-i", videoInput, "-frames:v", "1", "-q:v", "2", output]);
  }

  async probe(videoInput: string): Promise<FfprobeResult> {
    const output = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", videoInput]);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`ffprobe exited with ${code ?? "unknown"}.`)));
    });
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid ffprobe output.");
    const record = parsed as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
    const stream = record.streams?.find((entry) => entry.width && entry.height);
    const durationSeconds = Number(record.format?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Incomplete ffprobe output.");
    const hasAudio = record.streams?.some((entry) => entry.codec_type === "audio") ?? false;
    if (!stream) {
      if (!hasAudio) throw new Error("Incomplete ffprobe output.");
      return { durationSeconds, width: 0, height: 0, hasAudio };
    }
    const [volumeOutput, blackOutput] = await Promise.all([
      hasAudio ? captureError("ffmpeg", ["-i", videoInput, "-af", "volumedetect", "-f", "null", "-"]) : Promise.resolve(""),
      captureError("ffmpeg", ["-i", videoInput, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-"])
    ]);
    const volume = /mean_volume:\s*(-?[\d.]+)\s*dB/i.exec(volumeOutput)?.[1];
    const blackDuration = [...blackOutput.matchAll(/black_duration:([\d.]+)/g)].reduce((total, match) => total + Number(match[1] ?? 0), 0);
    return { durationSeconds, width: stream.width ?? 0, height: stream.height ?? 0, hasAudio, meanVolumeDb: volume ? Number(volume) : null, blackFrameRatio: Math.min(1, blackDuration / durationSeconds) };
  }
}

const captureError = async (command: string, args: readonly string[]): Promise<string> => new Promise((resolve, reject) => {
  let stderr = "";
  const child = spawn(command, [...args]);
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve(stderr) : reject(new Error(`${command} exited with ${code ?? "unknown"}.`)));
});
