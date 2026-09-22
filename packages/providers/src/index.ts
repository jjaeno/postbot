export interface ProviderResult {
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export type AnalyticsMetric = "views" | "impressions" | "average_watch_seconds" | "completion_rate" | "engagement_rate";
export type AnalyticsMetricValue = { metric: AnalyticsMetric; value: number | null; unit: "count" | "seconds" | "ratio" | null; aggregation: "sum" | "average" | "ratio" | null; unavailableReason: string | null };
export type AnalyticsPostResult = { externalPostId: string; observedAt: string; raw: Record<string, unknown>; metrics: readonly AnalyticsMetricValue[] };
export type AnalyticsPage = { posts: readonly AnalyticsPostResult[]; nextPageToken: string | null; dataDelayHours: number | null };
export interface AnalyticsProvider { fetchPage(input: { platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"; postIds: readonly string[]; periodStart: string; periodEnd: string; pageToken: string | null }): Promise<AnalyticsPage>; }

export class FakeAnalyticsProvider implements AnalyticsProvider {
  fetchPage(input: { platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"; postIds: readonly string[]; periodStart: string; periodEnd: string; pageToken: string | null }): Promise<AnalyticsPage> {
    const posts = input.postIds.slice(input.pageToken ? 1 : 0, input.pageToken ? 2 : 1).map((externalPostId, index) => ({ externalPostId, observedAt: input.periodEnd, raw: { platform: input.platform, periodStart: input.periodStart, page: input.pageToken ?? "first" }, metrics: [
      { metric: "views" as const, value: 100 + index, unit: "count" as const, aggregation: "sum" as const, unavailableReason: null },
      { metric: "average_watch_seconds" as const, value: 12.5, unit: "seconds" as const, aggregation: "average" as const, unavailableReason: null },
      { metric: "completion_rate" as const, value: null, unit: null, aggregation: null, unavailableReason: "NOT_PROVIDED_BY_PLATFORM" }
    ] }));
    return Promise.resolve({ posts, nextPageToken: input.pageToken || input.postIds.length < 2 ? null : "next", dataDelayHours: 24 });
  }
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

export type StorageObject = { key: string; checksumSha256: string; mimeType: string; sizeBytes: number };
export interface StorageProvider {
  upload(input: { key: string; body: Uint8Array; mimeType: string }): Promise<StorageObject>;
  download(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  presignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export class FakeStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { body: Uint8Array; mimeType: string }>();

  upload(input: { key: string; body: Uint8Array; mimeType: string }): Promise<StorageObject> {
    const body = new Uint8Array(input.body);
    this.objects.set(input.key, { body, mimeType: input.mimeType });
    return Promise.resolve({ key: input.key, checksumSha256: createHash("sha256").update(body).digest("hex"), mimeType: input.mimeType, sizeBytes: body.byteLength });
  }
  download(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error("STORAGE_OBJECT_NOT_FOUND");
    return Promise.resolve(new Uint8Array(object.body));
  }
  delete(key: string): Promise<void> { this.objects.delete(key); return Promise.resolve(); }
  presignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw new Error("STORAGE_OBJECT_NOT_FOUND");
    return Promise.resolve(`fake-storage://${encodeURIComponent(key)}?expiresIn=${expiresInSeconds}`);
  }
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  constructor(private readonly options: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }) { this.client = new S3Client({ endpoint: options.endpoint, region: options.region, forcePathStyle: true, credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } }); }
  async upload(input: { key: string; body: Uint8Array; mimeType: string }): Promise<StorageObject> { await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: input.key, Body: input.body, ContentType: input.mimeType })); return { key: input.key, checksumSha256: createHash("sha256").update(input.body).digest("hex"), mimeType: input.mimeType, sizeBytes: input.body.byteLength }; }
  async download(key: string): Promise<Uint8Array> { const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key })); if (!result.Body) throw new Error("STORAGE_OBJECT_NOT_FOUND"); return new Uint8Array(await result.Body.transformToByteArray()); }
  async delete(key: string): Promise<void> { await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key })); }
  presignedUrl(key: string, expiresInSeconds: number): Promise<string> { return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), { expiresIn: expiresInSeconds }); }
}

export type ImageGenerationRequest = { model: string; prompt: string; idempotencyKey: string; width: number; height: number };
export type ImageGenerationResult = ProviderResult & { model: string; mimeType: string; bytes: Uint8Array; width: number; height: number; estimatedCostUsd: string };
export interface ImageProvider { generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>; }
export class FakeImageProvider implements ImageProvider {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (request.prompt.includes("provider-failure")) throw new Error("IMAGE_PROVIDER_FAILED");
    return Promise.resolve({ provider: "fake-image", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: "image/svg+xml", bytes: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}"><text x="20" y="40">${request.prompt.slice(0, 80)}</text></svg>`), width: request.width, height: request.height, estimatedCostUsd: "0.000000" });
  }
}

export class GoogleImageProvider implements ImageProvider {
  constructor(private readonly options: { apiKey: string; timeoutMs: number }) {}
  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.options.apiKey) throw new Error("GOOGLE_API_KEY is required when IMAGE_PROVIDER=google.");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": this.options.apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: request.prompt }] }] }), signal: controller.signal });
      if (!response.ok) throw new Error(`Google image API failed with status ${response.status}.`);
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
      const image = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data)?.inlineData;
      if (!image?.data || !image.mimeType) throw new Error("Google image API did not return inline image data.");
      return { provider: "google", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: image.mimeType, bytes: Uint8Array.from(Buffer.from(image.data, "base64")), width: request.width, height: request.height, estimatedCostUsd: "0.000000" };
    } finally { clearTimeout(timer); }
  }
}

export type TtsRequest = { model: string; voice: string; text: string; idempotencyKey: string };
export type TtsTiming = { text: string; startSeconds: number; endSeconds: number };
export type TtsResult = ProviderResult & { model: string; mimeType: string; bytes: Uint8Array; durationSeconds: number; timings: TtsTiming[]; estimatedCostUsd: string };
export interface TtsProvider { synthesize(request: TtsRequest): Promise<TtsResult>; }
export class FakeTtsProvider implements TtsProvider {
  synthesize(request: TtsRequest): Promise<TtsResult> {
    if (request.text.includes("provider-failure")) throw new Error("TTS_PROVIDER_FAILED");
    const words = request.text.trim().split(/\s+/).filter(Boolean);
    const timings = words.map((text, index) => ({ text, startSeconds: index * 0.3, endSeconds: (index + 1) * 0.3 }));
    return Promise.resolve({ provider: "fake-tts", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: "audio/wav", bytes: new TextEncoder().encode(`fake-audio:${request.voice}:${request.text}`), durationSeconds: timings.length * 0.3, timings, estimatedCostUsd: "0.000000" });
  }
}

export class ElevenLabsTtsProvider implements TtsProvider {
  constructor(private readonly options: { apiKey: string; timeoutMs: number }) {}
  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (!this.options.apiKey) throw new Error("ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs.");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voice)}`, { method: "POST", headers: { "xi-api-key": this.options.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ text: request.text, model_id: request.model }), signal: controller.signal });
      if (!response.ok) throw new Error(`ElevenLabs TTS API failed with status ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer()); const words = request.text.trim().split(/\s+/).filter(Boolean); const timings = words.map((text, index) => ({ text, startSeconds: index * 0.3, endSeconds: (index + 1) * 0.3 }));
      return { provider: "elevenlabs", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: response.headers.get("content-type") ?? "audio/mpeg", bytes, durationSeconds: timings.length * 0.3, timings, estimatedCostUsd: "0.000000" };
    } finally { clearTimeout(timer); }
  }
}
import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
