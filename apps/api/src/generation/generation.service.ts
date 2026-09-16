import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import {
  FactSourceLinkSchema,
  GenerateScriptSceneRequestSchema,
  GeneratedMetadataSchema,
  GeneratedScriptSchema,
  type GenerateScriptSceneRequest,
  type ScriptSceneGenerationResponse
} from "@postbot/contracts";
import type { LlmGenerationResult, LlmProvider } from "@postbot/providers";
import { SceneDocumentSchema } from "@postbot/scene-schema";
import { z } from "zod";
import { GENERATION_REPOSITORY, type GenerationIdea, type GenerationRepository } from "./generation.repository.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";

const promptVersion = "script-scene-v1";
const maxAttempts = 2;

const StructuredGenerationSchema = z.object({
  planning: z.object({
    title: z.string().min(1).max(255),
    summary: z.string().min(1).max(2000),
    metadata: GeneratedMetadataSchema
  }),
  script: GeneratedScriptSchema,
  facts: z.array(FactSourceLinkSchema).min(1),
  sceneDocument: SceneDocumentSchema
});

type StructuredGeneration = z.infer<typeof StructuredGenerationSchema>;

@Injectable()
export class GenerationService {
  constructor(
    @Inject(GENERATION_REPOSITORY) private readonly repository: GenerationRepository,
    private readonly llmProviderFactory: LlmProviderFactory
  ) {}

  async generate(workspaceId: string, rawInput: unknown): Promise<ScriptSceneGenerationResponse> {
    const input = this.parseInput(rawInput);
    const duplicate = await this.repository.findByIdempotencyKey(input.idempotencyKey);
    if (duplicate) {
      return duplicate;
    }
    const idea = await this.repository.findIdea(workspaceId, input.ideaId);
    if (!idea) {
      throw new NotFoundException({ code: "IDEA_NOT_FOUND", message: "Idea was not found." });
    }
    const config = loadConfig();
    const provider = this.llmProviderFactory.create();
    const llmResult = await this.generateWithRetry(provider, idea, input, config.LLM_MODEL);
    const structured = this.parseStructuredOutput(llmResult.structuredOutput, idea);

    return this.repository.save({
      idempotencyKey: input.idempotencyKey,
      idea,
      platform: input.platform,
      promptVersion,
      model: llmResult.model,
      metadata: structured.planning.metadata,
      script: structured.script,
      facts: structured.facts,
      sceneDocument: structured.sceneDocument,
      usage: {
        ...llmResult.usage,
        estimatedCostUsd: llmResult.estimatedCostUsd
      }
    });
  }

  private async generateWithRetry(
    provider: LlmProvider,
    idea: GenerationIdea,
    input: GenerateScriptSceneRequest,
    model: string
  ): Promise<LlmGenerationResult> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await provider.generateScriptAndScene({
          model,
          promptVersion,
          idempotencyKey: `${input.idempotencyKey}:attempt:${attempt}`,
          title: idea.title,
          summary: idea.summary,
          topic: idea.topic,
          platform: input.platform,
          partial: input.partial,
          sources: [
            {
              title: idea.title,
              url: idea.canonicalUrl,
              summary: idea.summary
            }
          ]
        });
        this.parseStructuredOutput(result.structuredOutput, idea);
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof BadRequestException) {
      throw lastError;
    }
    throw new BadRequestException({ code: "LLM_GENERATION_FAILED", message: "LLM generation failed validation." });
  }

  private parseStructuredOutput(output: unknown, idea: GenerationIdea): StructuredGeneration {
    const parsed = StructuredGenerationSchema.safeParse(output);
    if (!parsed.success) {
      throw new BadRequestException({ code: "INVALID_LLM_OUTPUT", message: "LLM output did not match the structured schema." });
    }
    const allowedSources = new Set([idea.canonicalUrl]);
    const missingFactSource = parsed.data.facts.some((fact) => !allowedSources.has(fact.sourceUrl));
    const missingSceneSource = parsed.data.sceneDocument.scenes.some((scene) => !allowedSources.has(scene.narration.sourceUrl));
    if (missingFactSource || missingSceneSource) {
      throw new BadRequestException({ code: "MISSING_SOURCE_LINK", message: "Generated facts must reference provided sources." });
    }
    return parsed.data;
  }

  private parseInput(rawInput: unknown): GenerateScriptSceneRequest {
    try {
      return GenerateScriptSceneRequestSchema.parse(rawInput);
    } catch {
      throw new BadRequestException({ code: "INVALID_GENERATION_INPUT", message: "Invalid generation request." });
    }
  }
}
