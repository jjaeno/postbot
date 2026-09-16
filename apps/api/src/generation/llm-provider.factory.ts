import { Injectable } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import { FakeLlmProvider, OpenAiLlmProvider, type LlmProvider } from "@postbot/providers";

@Injectable()
export class LlmProviderFactory {
  create(): LlmProvider {
    const config = loadConfig();
    return config.LLM_PROVIDER === "openai"
      ? new OpenAiLlmProvider({
          apiKey: config.OPENAI_API_KEY,
          baseUrl: config.OPENAI_BASE_URL,
          timeoutMs: config.LLM_TIMEOUT_MS
        })
      : new FakeLlmProvider();
  }
}
