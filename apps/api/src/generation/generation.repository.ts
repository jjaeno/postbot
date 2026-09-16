import type { ScriptSceneGenerationResponse } from "@postbot/contracts";
import type { SceneDocument } from "@postbot/scene-schema";

export const GENERATION_REPOSITORY = Symbol("GENERATION_REPOSITORY");

export type GenerationIdea = {
  id: string;
  channelId: string;
  title: string;
  summary: string;
  canonicalUrl: string;
  sourceName: string;
  sourceKind: "NEWS" | "OFFICIAL" | "PAPER" | "RSS" | "PUBLIC_DATA" | "MANUAL";
  publishedAt: string | null;
  topic: string;
  language: string;
};

export type SaveGenerationInput = {
  idempotencyKey: string;
  idea: GenerationIdea;
  platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | null;
  promptVersion: string;
  model: string;
  metadata: {
    description: string;
    hashtags: string[];
  };
  script: {
    hook: string;
    body: string;
    callToAction: string;
    language: string;
    durationSeconds: number;
  };
  facts: Array<{
    claim: string;
    sourceUrl: string;
  }>;
  sceneDocument: SceneDocument;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: string;
  };
};

export type GenerationRepository = {
  findIdea(workspaceId: string, ideaId: string): Promise<GenerationIdea | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<ScriptSceneGenerationResponse | null>;
  save(input: SaveGenerationInput): Promise<ScriptSceneGenerationResponse>;
};
