import { Injectable } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import { FakeLlmProvider, OpenAiLlmProvider, type LlmProvider } from "@postbot/providers";

@Injectable()
export class LlmProviderFactory {
  create(): LlmProvider {
    return loadConfig().LLM_PROVIDER === "openai" ? new OpenAiLlmProvider() : new FakeLlmProvider();
  }
}
