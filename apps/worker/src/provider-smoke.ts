import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "@postbot/config";
import { ElevenLabsTtsProvider, GoogleImageProvider, OpenAiLlmProvider, resolveTtsVoice } from "@postbot/providers";
import { GeneratedScriptSchema } from "@postbot/contracts";
import { SceneDocumentSchema } from "@postbot/scene-schema";

const config = loadConfig();
const provider = process.argv.find((value) => ["llm", "image", "tts"].includes(value));
if (!provider) throw new Error("Usage: provider-smoke.js <llm|image|tts> [--execute-paid]");
if (!process.argv.includes("--execute-paid")) {
  process.stdout.write(JSON.stringify({ status: "NOT_RUN", provider, reason: "Paid execution requires explicit --execute-paid after approval; one call, no SNS posting" }) + "\n");
} else {
  if (config.APP_ENV !== "staging" || config.STAGING_FAKE_CANARY) throw new Error("REAL_SMOKE_REQUIRES_STAGING_WITHOUT_FAKE_CANARY");
  const key = `provider-smoke-${randomUUID()}`;
  const directory = resolve(".artifacts", key);
  await mkdir(directory, { recursive: true });
  try {
    if (provider === "llm") {
      if (config.LLM_PROVIDER !== "openai") throw new Error("REAL_PROVIDER_REQUIRED");
      const result = await new OpenAiLlmProvider({ apiKey: config.OPENAI_API_KEY, baseUrl: config.OPENAI_BASE_URL, timeoutMs: config.LLM_TIMEOUT_MS, inputUsdPerMillionTokens: config.LLM_INPUT_USD_PER_MILLION_TOKENS, outputUsdPerMillionTokens: config.LLM_OUTPUT_USD_PER_MILLION_TOKENS }).generateScriptAndScene({ model: config.LLM_MODEL, promptVersion: "smoke-v1", idempotencyKey: key, title: "Postbot test", summary: "This is a staging software verification, not a news claim.", topic: "software testing", platform: "YOUTUBE", partial: "full", sources: [{ title: "Project", summary: "Postbot staging verification", url: "https://github.com/jjaeno/postbot" }], channelContext: { language: "ko-KR", targetAudience: "운영자", tone: "차분함", hookStyle: null, callToActionStyle: null, minDurationSeconds: 15, maxDurationSeconds: 15, captionStyle: null, strategy: null } });
      const output = result.structuredOutput;
      if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("INVALID_STRUCTURED_OUTPUT");
      GeneratedScriptSchema.parse("script" in output ? output.script : undefined);
      SceneDocumentSchema.parse("sceneDocument" in output ? output.sceneDocument : undefined);
      await writeFile(resolve(directory, "script-scene.json"), JSON.stringify(output));
      process.stdout.write(JSON.stringify({ status: "PASS", evidence: "REAL_PROVIDER_ONLY", provider, usage: result.usage, usageBasedCostUsd: result.estimatedCostUsd, directory }) + "\n");
    } else if (provider === "image") {
      if (config.IMAGE_PROVIDER !== "google") throw new Error("REAL_PROVIDER_REQUIRED");
      const result = await new GoogleImageProvider({ apiKey: config.GOOGLE_API_KEY, timeoutMs: config.IMAGE_TIMEOUT_MS, usdPerOutput: config.IMAGE_USD_PER_OUTPUT }).generate({ model: config.IMAGE_MODEL, prompt: "A simple vertical abstract blue landscape, no text, no people", width: 1080, height: 1920, idempotencyKey: key });
      await writeFile(resolve(directory, `image.${result.mimeType.split("/")[1]}`), result.bytes);
      process.stdout.write(JSON.stringify({ status: "PASS", evidence: "REAL_PROVIDER_ONLY", provider, width: result.width, height: result.height, usageBasedCostUsd: result.estimatedCostUsd, directory }) + "\n");
    } else {
      if (config.TTS_PROVIDER !== "elevenlabs") throw new Error("REAL_PROVIDER_REQUIRED");
      const text = "포스트봇 운영 검증입니다. 한국어 음성과 자막 시간을 확인합니다.";
      const result = await new ElevenLabsTtsProvider({ apiKey: config.ELEVENLABS_API_KEY, timeoutMs: config.TTS_TIMEOUT_MS, usdPerThousandCharacters: config.TTS_USD_PER_THOUSAND_CHARACTERS }).synthesize({ model: config.TTS_MODEL, voice: resolveTtsVoice("elevenlabs", "neutral-ko", config.ELEVENLABS_VOICE_ID), text, idempotencyKey: key });
      const path = resolve(directory, "speech.mp3");
      await writeFile(path, result.bytes);
      await promisify(execFile)("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], { timeout: 30_000 });
      await writeFile(resolve(directory, "timings.json"), JSON.stringify(result.timings));
      process.stdout.write(JSON.stringify({ status: "PASS", evidence: "REAL_PROVIDER_ONLY", provider, characters: text.length, durationSeconds: result.durationSeconds, usageBasedCostUsd: result.estimatedCostUsd, directory }) + "\n");
    }
  } catch { process.stdout.write(JSON.stringify({ status: "FAIL", provider, reason: "Check credentials/model/pricing/media contract; do not automatically repeat a paid call", directory }) + "\n"); process.exitCode = 1; }
}
