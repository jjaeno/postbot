import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { SceneDocument } from "@postbot/scene-schema";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type { CaptionTiming } from "./scene-math.js";
import { assertRenderableDocument } from "./scene-math.js";

export const RENDERER_VERSION = "1.0.0";

export type RenderInput = {
  readonly sceneDocument: SceneDocument;
  readonly captions: readonly CaptionTiming[];
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
  async render(input: RenderInput): Promise<RenderedMedia> {
    assertRenderableDocument(input.sceneDocument);
    await mkdir(dirname(input.outputLocation), { recursive: true });
    const entryPoint = new URL("./remotion-entry.js", import.meta.url).pathname;
    const serveUrl = await bundle({ entryPoint });
    const inputProps = { sceneDocument: input.sceneDocument, captions: input.captions };
    const composition = await selectComposition({ serveUrl, id: "PostbotShort", inputProps });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: input.outputLocation,
      inputProps
    });
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
  async postprocess(input: { readonly videoInput: string; readonly output: string; readonly narrationInput?: string; readonly backgroundInput?: string }): Promise<void> {
    await mkdir(dirname(input.output), { recursive: true });
    const args = ["-y", "-i", input.videoInput];
    if (input.narrationInput) args.push("-i", input.narrationInput);
    if (input.backgroundInput) args.push("-i", input.backgroundInput);
    if (input.narrationInput && input.backgroundInput) {
      args.push("-filter_complex", "[2:a]volume=0.20[bg];[1:a][bg]amix=inputs=2:duration=longest:normalize=0,apad[a]", "-map", "0:v:0", "-map", "[a]");
    } else if (input.narrationInput) {
      args.push("-filter_complex", "[1:a]apad[a]", "-map", "0:v:0", "-map", "[a]");
    } else if (input.backgroundInput) {
      args.push("-filter_complex", "[1:a]volume=0.20,apad[a]", "-map", "0:v:0", "-map", "[a]");
    } else {
      args.push("-map", "0:v:0");
    }
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
    if (!stream || !Number.isFinite(durationSeconds) || !stream.width || !stream.height) throw new Error("Incomplete ffprobe output.");
    const hasAudio = record.streams?.some((entry) => entry.codec_type === "audio") ?? false;
    const [volumeOutput, blackOutput] = await Promise.all([
      hasAudio ? captureError("ffmpeg", ["-i", videoInput, "-af", "volumedetect", "-f", "null", "-"]) : Promise.resolve(""),
      captureError("ffmpeg", ["-i", videoInput, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-"])
    ]);
    const volume = /mean_volume:\s*(-?[\d.]+)\s*dB/i.exec(volumeOutput)?.[1];
    const blackDuration = [...blackOutput.matchAll(/black_duration:([\d.]+)/g)].reduce((total, match) => total + Number(match[1] ?? 0), 0);
    return { durationSeconds, width: stream.width, height: stream.height, hasAudio, meanVolumeDb: volume ? Number(volume) : null, blackFrameRatio: Math.min(1, blackDuration / durationSeconds) };
  }
}

const captureError = async (command: string, args: readonly string[]): Promise<string> => new Promise((resolve, reject) => {
  let stderr = "";
  const child = spawn(command, [...args]);
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve(stderr) : reject(new Error(`${command} exited with ${code ?? "unknown"}.`)));
});
