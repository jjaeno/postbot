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

export class OpenAiLlmProvider implements LlmProvider {
  generateScriptAndScene(): Promise<LlmGenerationResult> {
    return Promise.reject(new Error("OpenAI LLM provider is not configured in this stage."));
  }
}
