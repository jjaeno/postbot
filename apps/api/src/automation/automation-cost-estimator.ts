import type { AppConfig } from "@postbot/config";
import type { AutomationStage } from "@postbot/contracts";

export type AutomationCostUsage = {
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  characters?: number;
  durationSeconds?: number;
};

export type AutomationCostEstimate = {
  stage: Extract<AutomationStage, "SCRIPT" | "ASSET" | "TTS" | "RENDER">;
  provider: string;
  model: string;
  amountUsd: number;
  usage: AutomationCostUsage;
  pricing: Record<string, number>;
};

const rounded = (value: number): number => Number(value.toFixed(6));

export const estimateAutomationStageCost = (
  config: AppConfig,
  stage: AutomationCostEstimate["stage"],
  usage: AutomationCostUsage
): AutomationCostEstimate | null => {
  if (stage === "SCRIPT") {
    const inputTokens = usage.inputTokens ?? config.AUTOMATION_EXPECTED_INPUT_TOKENS;
    const outputTokens = usage.outputTokens ?? config.AUTOMATION_EXPECTED_OUTPUT_TOKENS;
    const inputRate = config.LLM_PROVIDER === "fake" ? 1 : config.LLM_INPUT_USD_PER_MILLION_TOKENS;
    const outputRate = config.LLM_PROVIDER === "fake" ? 1 : config.LLM_OUTPUT_USD_PER_MILLION_TOKENS;
    if (inputRate <= 0 || outputRate <= 0) return null;
    return { stage, provider: config.LLM_PROVIDER, model: config.LLM_MODEL, amountUsd: rounded((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000), usage: { inputTokens, outputTokens }, pricing: { inputUsdPerMillionTokens: inputRate, outputUsdPerMillionTokens: outputRate } };
  }
  if (stage === "ASSET") {
    const imageCount = usage.imageCount ?? 0;
    const rate = config.IMAGE_PROVIDER === "fake" ? 0.001 : config.IMAGE_USD_PER_OUTPUT;
    if (imageCount <= 0 || rate <= 0) return null;
    return { stage, provider: config.IMAGE_PROVIDER, model: config.IMAGE_MODEL, amountUsd: rounded(imageCount * rate), usage: { imageCount }, pricing: { usdPerOutput: rate } };
  }
  if (stage === "TTS") {
    const characters = usage.characters ?? 0;
    const rate = config.TTS_PROVIDER === "fake" ? 0.01 : config.TTS_USD_PER_THOUSAND_CHARACTERS;
    if (characters <= 0 || rate <= 0) return null;
    return { stage, provider: config.TTS_PROVIDER, model: config.TTS_MODEL, amountUsd: rounded(characters / 1_000 * rate), usage: { characters }, pricing: { usdPerThousandCharacters: rate } };
  }
  const durationSeconds = usage.durationSeconds ?? 0;
  const rate = config.APP_ENV === "local" || config.APP_ENV === "test" ? 0.01 : config.RENDER_USD_PER_MINUTE;
  if (durationSeconds <= 0 || rate <= 0) return null;
  return { stage, provider: "renderer", model: "remotion-ffmpeg", amountUsd: rounded(durationSeconds / 60 * rate), usage: { durationSeconds }, pricing: { usdPerMinute: rate } };
};
