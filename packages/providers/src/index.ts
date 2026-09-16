export interface ProviderResult {
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export type TopicSourceKind = "NEWS" | "OFFICIAL" | "PAPER" | "RSS" | "PUBLIC_DATA" | "MANUAL";

export type TopicSourceCandidate = {
  readonly title: string;
  readonly summary: string;
  readonly url: string;
  readonly sourceName: string;
  readonly sourceKind: TopicSourceKind;
  readonly publishedAt: string | null;
  readonly body: string;
  readonly reliabilityScore: number;
};

export type TopicSourceRequest = {
  readonly channelId: string;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly allowedSources: readonly string[];
  readonly excludedSources: readonly string[];
  readonly recencyHours: number;
  readonly idempotencyKey: string;
};

export type TopicSourceResult = ProviderResult & {
  readonly candidates: readonly TopicSourceCandidate[];
};

export interface TopicSourceProvider {
  collect(request: TopicSourceRequest): Promise<TopicSourceResult>;
}

const fixtureCandidates: readonly TopicSourceCandidate[] = [
  {
    title: "Reusable rocket test reaches new altitude",
    summary: "A public aerospace test reported improved reusable booster recovery performance.",
    url: "https://example.org/science/reusable-rocket-test?utm_source=fixture",
    sourceName: "Example Science",
    sourceKind: "RSS",
    publishedAt: "2026-08-30T00:00:00.000Z",
    body: "Reusable rocket test reaches new altitude with verified public telemetry and recovery footage.",
    reliabilityScore: 0.82
  },
  {
    title: "Ocean sensor network publishes open climate data",
    summary: "A research group released public ocean sensor data for short-form explainers.",
    url: "https://public.example.org/ocean/sensor-network",
    sourceName: "Public Research Data",
    sourceKind: "PUBLIC_DATA",
    publishedAt: "2026-08-29T00:00:00.000Z",
    body: "Ocean sensor network publishes open climate data with methodology notes and public license metadata.",
    reliabilityScore: 0.88
  },
  {
    title: "Medical investment rumor should be filtered",
    summary: "A fixture item intentionally includes excluded health and finance terms.",
    url: "https://example.org/rumor/medical-investment",
    sourceName: "Filtered Fixture",
    sourceKind: "NEWS",
    publishedAt: "2026-08-30T00:00:00.000Z",
    body: "Medical investment rumor combines health advice and finance speculation.",
    reliabilityScore: 0.2
  }
];

const sourceAllowed = (
  candidate: TopicSourceCandidate,
  allowedSources: readonly string[],
  excludedSources: readonly string[]
): boolean => {
  const hostname = new URL(candidate.url).hostname;
  if (excludedSources.some((source) => candidate.url.startsWith(source) || hostname === source)) {
    return false;
  }
  return allowedSources.length === 0 || allowedSources.some((source) => candidate.url.startsWith(source) || hostname === source);
};

export class FixtureTopicSourceProvider implements TopicSourceProvider {
  constructor(private readonly candidates: readonly TopicSourceCandidate[] = fixtureCandidates) {}

  collect(request: TopicSourceRequest): Promise<TopicSourceResult> {
    if (request.keywords.includes("fixture-source-failure")) {
      return Promise.reject(new Error("Fixture source failure."));
    }
    const lowerTerms = [request.topic, ...request.keywords].map((term) => term.toLowerCase());
    const candidates = this.candidates.filter((candidate) => {
      const haystack = `${candidate.title} ${candidate.summary} ${candidate.body}`.toLowerCase();
      return lowerTerms.some((term) => haystack.includes(term)) && sourceAllowed(candidate, request.allowedSources, request.excludedSources);
    });
    return Promise.resolve({
      provider: "fixture-topic-source",
      idempotencyKey: request.idempotencyKey,
      createdAt: new Date().toISOString(),
      candidates
    });
  }
}

export type LlmGenerationSource = {
  readonly title: string;
  readonly url: string;
  readonly summary: string;
};

export type LlmGenerationRequest = {
  readonly model: string;
  readonly promptVersion: string;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly summary: string;
  readonly topic: string;
  readonly platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | null;
  readonly sources: readonly LlmGenerationSource[];
  readonly partial: "full" | "hook" | "body" | "metadata" | "scene";
};

export type LlmTokenUsage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
};

export type LlmGenerationResult = ProviderResult & {
  readonly model: string;
  readonly promptVersion: string;
  readonly structuredOutput: unknown;
  readonly usage: LlmTokenUsage;
  readonly estimatedCostUsd: string;
};

export interface LlmProvider {
  generateScriptAndScene(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
}

const fakeStructuredOutput = (request: LlmGenerationRequest): Record<string, unknown> => {
  const source = request.sources[0];
  if (!source) {
    return { error: "missing source" };
  }
  return {
    planning: {
      title: request.title,
      summary: request.summary,
      metadata: {
        description: `${request.summary}\n\nSource: ${source.url}`,
        hashtags: ["postbot", "shorts", request.topic.toLowerCase().replaceAll(" ", "-").slice(0, 40)]
      }
    },
    script: {
      hook: `What changed in ${request.title}?`,
      body: `A verified source reports: ${request.summary}`,
      callToAction: "Check the source before sharing.",
      language: "en",
      durationSeconds: 45
    },
    facts: [
      {
        claim: request.summary,
        sourceUrl: source.url
      }
    ],
    sceneDocument: {
      schemaVersion: "1.0.0",
      title: request.title,
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 1350,
      scenes: [
        {
          id: "scene-1",
          startFrame: 0,
          durationInFrames: 1350,
          visualPrompt: `Vertical short explainer about ${request.title}`,
          narration: {
            text: request.summary,
            sourceUrl: source.url
          },
          overlays: [
            {
              kind: "title",
              text: request.title.slice(0, 120)
            },
            {
              kind: "fact",
              text: "Source checked"
            }
          ]
        }
      ]
    }
  };
};

export class FakeLlmProvider implements LlmProvider {
  private attempts = 0;

  generateScriptAndScene(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    this.attempts += 1;
    const behavior = request.title.toLowerCase();
    const structuredOutput =
      behavior.includes("bad-json") && this.attempts === 1
        ? { invalid: true }
        : behavior.includes("missing-source")
          ? { ...fakeStructuredOutput(request), facts: [] }
          : behavior.includes("too-long")
            ? {
                ...fakeStructuredOutput(request),
                script: {
                  hook: "Too long",
                  body: "x".repeat(2_001),
                  callToAction: "Done",
                  language: "en",
                  durationSeconds: 181
                }
              }
            : fakeStructuredOutput(request);

    return Promise.resolve({
      provider: "fake-llm",
      idempotencyKey: request.idempotencyKey,
      createdAt: new Date("2026-08-31T00:00:00.000Z").toISOString(),
      model: request.model,
      promptVersion: request.promptVersion,
      structuredOutput,
      usage: {
        promptTokens: 120,
        completionTokens: 240,
        totalTokens: 360
      },
      estimatedCostUsd: "0.000360"
    });
  }
}

type OpenAiLlmProviderOptions = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
};

type OpenAiResponse = {
  readonly id?: string;
  readonly created_at?: number;
  readonly output_text?: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly total_tokens?: number;
  };
};

const scriptSceneJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planning", "script", "facts", "sceneDocument"],
  properties: {
    planning: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "metadata"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        metadata: {
          type: "object",
          additionalProperties: false,
          required: ["description", "hashtags"],
          properties: { description: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } }
        }
      }
    },
    script: {
      type: "object",
      additionalProperties: false,
      required: ["hook", "body", "callToAction", "language", "durationSeconds"],
      properties: {
        hook: { type: "string" }, body: { type: "string" }, callToAction: { type: "string" },
        language: { type: "string" }, durationSeconds: { type: "number" }
      }
    },
    facts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["claim", "sourceUrl"],
        properties: { claim: { type: "string" }, sourceUrl: { type: "string" } }
      }
    },
    sceneDocument: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "title", "width", "height", "fps", "durationInFrames", "scenes"],
      properties: {
        schemaVersion: { type: "string" }, title: { type: "string" }, width: { type: "integer" }, height: { type: "integer" },
        fps: { type: "integer" }, durationInFrames: { type: "integer" },
        scenes: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "startFrame", "durationInFrames", "visualPrompt", "narration", "overlays"],
            properties: {
              id: { type: "string" }, startFrame: { type: "integer" }, durationInFrames: { type: "integer" }, visualPrompt: { type: "string" },
              narration: {
                type: "object", additionalProperties: false, required: ["text", "sourceUrl"],
                properties: { text: { type: "string" }, sourceUrl: { type: "string" } }
              },
              overlays: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false, required: ["text", "kind"],
                  properties: { text: { type: "string" }, kind: { type: "string", enum: ["title", "fact", "cta"] } }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

const readResponseText = (response: OpenAiResponse): string => {
  if (!response.output_text) {
    throw new Error("OpenAI response did not include structured output text.");
  }
  return response.output_text;
};

export class OpenAiLlmProvider implements LlmProvider {
  constructor(private readonly options: OpenAiLlmProviderOptions) {}

  async generateScriptAndScene(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    if (!this.options.apiKey) {
      throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.idempotencyKey
        },
        body: JSON.stringify({
          model: request.model,
          store: false,
          instructions:
            "Generate a factual short-form script and scene document. Return only data that conforms to the supplied JSON Schema and cite only the supplied source URLs.",
          input: JSON.stringify({
            title: request.title,
            summary: request.summary,
            topic: request.topic,
            platform: request.platform,
            partial: request.partial,
            sources: request.sources
          }),
          text: {
            format: {
              type: "json_schema",
              name: "script_scene_generation",
              strict: true,
              schema: scriptSceneJsonSchema
            }
          }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`OpenAI Responses API failed with status ${response.status}.`);
      }
      const payload = (await response.json()) as OpenAiResponse;
      const usage = payload.usage;
      const promptTokens = usage?.input_tokens ?? 0;
      const completionTokens = usage?.output_tokens ?? 0;
      return {
        provider: "openai",
        idempotencyKey: request.idempotencyKey,
        createdAt: payload.created_at ? new Date(payload.created_at * 1_000).toISOString() : new Date().toISOString(),
        model: request.model,
        promptVersion: request.promptVersion,
        structuredOutput: JSON.parse(readResponseText(payload)) as unknown,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: usage?.total_tokens ?? promptTokens + completionTokens
        },
        estimatedCostUsd: "0.000000"
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
