import { BadRequestException } from "@nestjs/common";
import type { ScriptSceneGenerationResponse } from "@postbot/contracts";
import type { LlmGenerationRequest, LlmGenerationResult, LlmProvider } from "@postbot/providers";
import type { SceneDocument } from "@postbot/scene-schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationIdea, GenerationRepository, SaveGenerationInput } from "./generation.repository.js";
import { GenerationService } from "./generation.service.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";
import type { JobsService } from "../jobs/jobs.service.js";

const sceneDocument = (sourceUrl: string): SceneDocument => ({
  schemaVersion: "1.0.0",
  title: "Reusable rocket test",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 1350,
  scenes: [
    {
      id: "scene-1",
      startFrame: 0,
      durationInFrames: 1350,
      visualPrompt: "Vertical short about reusable rocket recovery.",
      narration: {
        text: "Reusable rocket recovery improved.",
        sourceUrl
      },
      overlays: [
        { kind: "title", text: "Reusable rocket test" },
        { kind: "fact", text: "Source checked" }
      ]
    }
  ]
});

const structuredOutput = (sourceUrl: string): unknown => ({
  planning: {
    title: "Reusable rocket test",
    summary: "Reusable rocket recovery improved.",
    metadata: {
      description: `Source: ${sourceUrl}`,
      hashtags: ["rocket", "science"]
    }
  },
  script: {
    hook: "What changed in reusable rockets?",
    body: "A verified source reports reusable rocket recovery improved.",
    callToAction: "Check the source before sharing.",
    language: "en",
    durationSeconds: 45
  },
  facts: [
    {
      claim: "Reusable rocket recovery improved.",
      sourceUrl
    }
  ],
  sceneDocument: sceneDocument(sourceUrl)
});

class StaticLlmProvider implements LlmProvider {
  calls = 0;

  constructor(private readonly outputs: readonly unknown[]) {}

  generateScriptAndScene(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    const output = this.outputs[Math.min(this.calls, this.outputs.length - 1)];
    this.calls += 1;
    return Promise.resolve({
      provider: "test-llm",
      idempotencyKey: request.idempotencyKey,
      createdAt: new Date("2026-08-31T00:00:00.000Z").toISOString(),
      model: request.model,
      promptVersion: request.promptVersion,
      structuredOutput: output,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      },
      estimatedCostUsd: "0.000030"
    });
  }
}

class TestLlmProviderFactory extends LlmProviderFactory {
  constructor(private readonly provider: LlmProvider) {
    super();
  }

  override create(): LlmProvider {
    return this.provider;
  }
}

class MemoryGenerationRepository implements GenerationRepository {
  readonly saved = new Map<string, ScriptSceneGenerationResponse>();
  readonly idea: GenerationIdea = {
    id: "idea-1",
    channelId: "channel-1",
    title: "Reusable rocket test",
    summary: "Reusable rocket recovery improved.",
    canonicalUrl: "https://example.org/science/rocket",
    sourceName: "Example Science",
    sourceKind: "RSS",
    publishedAt: "2026-08-30T00:00:00.000Z",
    topic: "rocket science",
    language: "en"
  };

  findIdea(workspaceId: string, ideaId: string): Promise<GenerationIdea | null> {
    return Promise.resolve(workspaceId === "workspace-1" && ideaId === this.idea.id ? this.idea : null);
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<ScriptSceneGenerationResponse | null> {
    const response = this.saved.get(idempotencyKey);
    return Promise.resolve(response ? { ...response, duplicate: true } : null);
  }

  save(input: SaveGenerationInput): Promise<ScriptSceneGenerationResponse> {
    const response: ScriptSceneGenerationResponse = {
      contentItemId: "content-1",
      scriptVersionId: `script-${this.saved.size + 1}`,
      sceneVersionId: `scene-${this.saved.size + 1}`,
      version: this.saved.size + 1,
      promptVersion: input.promptVersion,
      model: input.model,
      metadata: input.metadata,
      script: input.script,
      facts: input.facts,
      sceneDocument: input.sceneDocument,
      usage: input.usage,
      duplicate: false
    };
    this.saved.set(input.idempotencyKey, response);
    return Promise.resolve(response);
  }
}

const createService = (provider: StaticLlmProvider, jobs?: Pick<JobsService, "create">) => {
  const repository = new MemoryGenerationRepository();
  const service = new GenerationService(repository, new TestLlmProviderFactory(provider), jobs);
  return { provider, repository, service };
};

describe("GenerationService", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "fake";
    process.env.LLM_MODEL = "fake-script-model";
  });

  it("creates a deterministic fake generation snapshot", async () => {
    const { service } = createService(new StaticLlmProvider([structuredOutput("https://example.org/science/rocket")]));

    await expect(
      service.generate("workspace-1", {
        ideaId: "idea-1",
        idempotencyKey: "generation-snapshot",
        platform: "YOUTUBE"
      })
    ).resolves.toMatchInlineSnapshot(`
      {
        "contentItemId": "content-1",
        "duplicate": false,
        "facts": [
          {
            "claim": "Reusable rocket recovery improved.",
            "sourceUrl": "https://example.org/science/rocket",
          },
        ],
        "metadata": {
          "description": "Source: https://example.org/science/rocket",
          "hashtags": [
            "rocket",
            "science",
          ],
        },
        "model": "fake-script-model",
        "promptVersion": "script-scene-v1",
        "sceneDocument": {
          "durationInFrames": 1350,
          "fps": 30,
          "height": 1920,
          "scenes": [
            {
              "durationInFrames": 1350,
              "id": "scene-1",
              "narration": {
                "sourceUrl": "https://example.org/science/rocket",
                "text": "Reusable rocket recovery improved.",
              },
              "overlays": [
                {
                  "kind": "title",
                  "text": "Reusable rocket test",
                },
                {
                  "kind": "fact",
                  "text": "Source checked",
                },
              ],
              "startFrame": 0,
              "visualPrompt": "Vertical short about reusable rocket recovery.",
            },
          ],
          "schemaVersion": "1.0.0",
          "title": "Reusable rocket test",
          "width": 1080,
        },
        "sceneVersionId": "scene-1",
        "script": {
          "body": "A verified source reports reusable rocket recovery improved.",
          "callToAction": "Check the source before sharing.",
          "durationSeconds": 45,
          "hook": "What changed in reusable rockets?",
          "language": "en",
        },
        "scriptVersionId": "script-1",
        "usage": {
          "completionTokens": 20,
          "estimatedCostUsd": "0.000030",
          "promptTokens": 10,
          "totalTokens": 30,
        },
        "version": 1,
      }
    `);
  });

  it("rejects invalid structured output after retry", async () => {
    const { service } = createService(new StaticLlmProvider([{ invalid: true }]));

    await expect(
      service.generate("workspace-1", {
        ideaId: "idea-1",
        idempotencyKey: "generation-invalid-json"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects facts without provided source links", async () => {
    const output = structuredOutput("https://untrusted.example.org/source");
    const { service } = createService(new StaticLlmProvider([output]));

    await expect(
      service.generate("workspace-1", {
        ideaId: "idea-1",
        idempotencyKey: "generation-missing-source"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects script length and duration overflow", async () => {
    const output = structuredOutput("https://example.org/science/rocket");
    const tooLong = {
      ...(output as Record<string, unknown>),
      script: {
        hook: "Long script",
        body: "x".repeat(2_001),
        callToAction: "Done",
        language: "en",
        durationSeconds: 181
      }
    };
    const { service } = createService(new StaticLlmProvider([tooLong]));

    await expect(
      service.generate("workspace-1", {
        ideaId: "idea-1",
        idempotencyKey: "generation-too-long"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("retries once and saves the valid second response", async () => {
    const provider = new StaticLlmProvider([{ invalid: true }, structuredOutput("https://example.org/science/rocket")]);
    const { service } = createService(provider);

    const result = await service.generate("workspace-1", {
      ideaId: "idea-1",
      idempotencyKey: "generation-retry"
    });

    expect(provider.calls).toBe(2);
    expect(result.scriptVersionId).toBe("script-1");
  });

  it("deduplicates repeated generation requests", async () => {
    const provider = new StaticLlmProvider([structuredOutput("https://example.org/science/rocket")]);
    const { service } = createService(provider);
    const input = {
      ideaId: "idea-1",
      idempotencyKey: "generation-duplicate"
    };

    const first = await service.generate("workspace-1", input);
    const second = await service.generate("workspace-1", input);

    expect(first.scriptVersionId).toBe(second.scriptVersionId);
    expect(second.duplicate).toBe(true);
    expect(provider.calls).toBe(1);
  });

  it("enqueues a SCRIPT job without invoking the LLM provider", async () => {
    const provider = new StaticLlmProvider([structuredOutput("https://example.org/science/rocket")]);
    const create = vi.fn().mockResolvedValue({ id: "job-1", type: "SCRIPT", status: "QUEUED" });
    const { service } = createService(provider, { create });

    await expect(service.enqueue("workspace-1", { ideaId: "idea-1", idempotencyKey: "generation-queued" })).resolves.toMatchObject({ id: "job-1" });
    expect(create).toHaveBeenCalledWith("workspace-1", expect.objectContaining({ type: "SCRIPT", channelId: "channel-1" }));
    expect(provider.calls).toBe(0);
  });
});
