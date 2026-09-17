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

export type FfprobeResult = { readonly durationSeconds: number; readonly width: number; readonly height: number };

export class FfmpegPostProcessor {
  async postprocess(input: { readonly videoInput: string; readonly output: string; readonly narrationInput?: string; readonly backgroundInput?: string }): Promise<void> {
    await mkdir(dirname(input.output), { recursive: true });
    const args = ["-y", "-i", input.videoInput];
    if (input.narrationInput) args.push("-i", input.narrationInput);
    if (input.backgroundInput) args.push("-i", input.backgroundInput);
    if (input.narrationInput && input.backgroundInput) {
      args.push("-filter_complex", "[1:a][2:a]sidechaincompress=threshold=0.03:ratio=8[bgm];[1:a][bgm]amix=inputs=2:normalize=0[a]", "-map", "0:v:0", "-map", "[a]");
    } else if (input.narrationInput) {
      args.push("-map", "0:v:0", "-map", "1:a:0");
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
      const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", videoInput]);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`ffprobe exited with ${code ?? "unknown"}.`)));
    });
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid ffprobe output.");
    const record = parsed as { format?: { duration?: string }; streams?: Array<{ width?: number; height?: number }> };
    const stream = record.streams?.find((entry) => entry.width && entry.height);
    const durationSeconds = Number(record.format?.duration);
    if (!stream || !Number.isFinite(durationSeconds) || !stream.width || !stream.height) throw new Error("Incomplete ffprobe output.");
    return { durationSeconds, width: stream.width, height: stream.height };
  }
}
