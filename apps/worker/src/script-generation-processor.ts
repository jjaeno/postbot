import { loadConfig } from "@postbot/config";
import {
  FactSourceLinkSchema,
  GeneratedMetadataSchema,
  GeneratedScriptSchema,
  ScriptGenerationJobPayloadSchema,
  type GenerationIdeaSnapshot,
  type ScriptGenerationJobPayload
} from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { FakeLlmProvider, OpenAiLlmProvider, type LlmProvider } from "@postbot/providers";
import { SceneDocumentSchema, type SceneDocument } from "@postbot/scene-schema";
import { createHash } from "node:crypto";
import { z } from "zod";

const promptVersion = "script-scene-v1";

const StructuredGenerationSchema = z.object({
  planning: z.object({ title: z.string().min(1).max(255), summary: z.string().min(1).max(2000), metadata: GeneratedMetadataSchema }),
  script: GeneratedScriptSchema,
  facts: z.array(FactSourceLinkSchema).min(1),
  sceneDocument: SceneDocumentSchema
});

type StructuredGeneration = z.infer<typeof StructuredGenerationSchema>;
type GenerationResult = { contentItemId: string; scriptVersionId: string; sceneVersionId: string; version: number };
type MergedGeneration = { metadata: z.infer<typeof GeneratedMetadataSchema>; script: z.infer<typeof GeneratedScriptSchema>; facts: z.infer<typeof FactSourceLinkSchema>[]; sceneDocument: SceneDocument };
type GeneratedWithUsage = StructuredGeneration & { model: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; estimatedCostUsd: string; generationContext: Prisma.JsonObject; strategyVersion: number | null };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const jsonObject = (value: Prisma.JsonValue | null): Prisma.JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export class ScriptGenerationProcessor {
  constructor(private readonly prisma: PrismaClient) {}

  async process(jobId: string, payload: Record<string, unknown>): Promise<GenerationResult> {
    const input = ScriptGenerationJobPayloadSchema.parse(payload) satisfies ScriptGenerationJobPayload;
    const existing = await this.prisma.providerUsage.findUnique({ where: { idempotencyKey: `script-job:${jobId}` } });
    const prior = this.readResult(existing?.providerResponse ?? null);
    if (prior) return prior;

    const generated = await this.generate(input.generation);
    return this.save(jobId, input.generation.idea, input.generation.request, generated);
  }

  private async generate(input: ScriptGenerationJobPayload["generation"]): Promise<GeneratedWithUsage> {
    const config = loadConfig();
    const provider: LlmProvider = config.LLM_PROVIDER === "openai"
      ? new OpenAiLlmProvider({ apiKey: config.OPENAI_API_KEY, baseUrl: config.OPENAI_BASE_URL, timeoutMs: config.LLM_TIMEOUT_MS, inputUsdPerMillionTokens: config.LLM_INPUT_USD_PER_MILLION_TOKENS, outputUsdPerMillionTokens: config.LLM_OUTPUT_USD_PER_MILLION_TOKENS })
      : new FakeLlmProvider();
    let lastError: unknown;
    for (let attempt = 1; attempt <= config.LLM_MAX_RETRIES + 1; attempt += 1) {
      try {
        const channel = await this.prisma.channel.findUnique({
          where: { id: input.idea.channelId },
          include: {
            templates: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1 },
            outputProfiles: { where: { ...(input.request.platform ? { platform: input.request.platform } : {}), isActive: true }, orderBy: { version: "desc" }, take: 1 },
            strategyVersions: { where: { appliedAt: { not: null } }, orderBy: { version: "desc" }, take: 1 }
          }
        });
        const template = channel?.templates[0];
        const profile = channel?.outputProfiles[0];
        const subtitle = jsonObject(template?.subtitleStyle ?? null);
        const strategy = jsonObject(channel?.strategyVersions[0]?.strategy ?? null);
        const generationContext = {
          language: channel?.language ?? input.idea.language,
          targetAudience: channel?.targetAudience ?? null,
          tone: template?.tone ?? null,
          hookStyle: profile?.hookStyle ?? null,
          callToActionStyle: typeof subtitle.cta === "string" ? subtitle.cta : null,
          minDurationSeconds: profile?.minDurationSeconds ?? null,
          maxDurationSeconds: profile?.maxDurationSeconds ?? null,
          captionStyle: profile?.captionStyle ?? null,
          voiceProfile: template?.voiceProfile ?? null,
          visualStyle: jsonObject(template?.visualStyle ?? null),
          strategy: Object.keys(strategy).length > 0 ? strategy : null
        };
        const response = await provider.generateScriptAndScene({
          model: config.LLM_MODEL, promptVersion, idempotencyKey: `${input.request.idempotencyKey}:attempt:${attempt}`,
          title: input.idea.title, summary: input.idea.summary, topic: input.idea.topic, platform: input.request.platform,
          partial: input.request.partial, sources: [{ title: input.idea.title, summary: input.idea.summary, url: input.idea.canonicalUrl }],
          channelContext: generationContext
        });
        const structured = this.parse(response.structuredOutput, input.idea);
        return { ...structured, model: response.model, usage: response.usage, estimatedCostUsd: response.estimatedCostUsd, generationContext, strategyVersion: channel?.strategyVersions[0]?.version ?? null };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("LLM_GENERATION_FAILED");
  }

  private parse(value: unknown, idea: GenerationIdeaSnapshot): StructuredGeneration {
    const parsed = StructuredGenerationSchema.safeParse(value);
    if (!parsed.success) throw new Error("INVALID_LLM_OUTPUT");
    if (parsed.data.facts.some((fact) => fact.sourceUrl !== idea.canonicalUrl) || parsed.data.sceneDocument.scenes.some((scene) => scene.narration.sourceUrl !== idea.canonicalUrl)) {
      throw new Error("MISSING_SOURCE_LINK");
    }
    return parsed.data;
  }

  private async save(
    jobId: string,
    idea: GenerationIdeaSnapshot,
    request: ScriptGenerationJobPayload["generation"]["request"],
    generated: GeneratedWithUsage
  ): Promise<GenerationResult> {
    for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.providerUsage.findUnique({ where: { idempotencyKey: `script-job:${jobId}` } });
          const prior = this.readResult(existing?.providerResponse ?? null);
          if (prior) return prior;
          const contentItem = await tx.contentItem.upsert({
            where: { channelId_topicKey: { channelId: idea.channelId, topicKey: `idea:${idea.id}` } },
            update: { title: idea.title, summary: idea.summary, status: "GENERATING" },
            create: { channelId: idea.channelId, title: idea.title, summary: idea.summary, topicKey: `idea:${idea.id}`, collectedAt: new Date(), status: "GENERATING" }
          });
          await tx.sourceReference.upsert({
            where: { contentItemId_urlHash: { contentItemId: contentItem.id, urlHash: sha256(idea.canonicalUrl) } },
            update: {},
            create: { contentItemId: contentItem.id, kind: idea.sourceKind, title: idea.title, url: idea.canonicalUrl, urlHash: sha256(idea.canonicalUrl), sourceName: idea.sourceName, publishedAt: idea.publishedAt ? new Date(idea.publishedAt) : null, reliabilityScore: new Prisma.Decimal("0.800000"), isPrimary: true, normalizedSnapshot: { facts: generated.facts } }
          });
          const latestScript = await tx.scriptVersion.findFirst({ where: { contentItemId: contentItem.id, platform: request.platform }, orderBy: { version: "desc" } });
          const latestScene = await tx.sceneVersion.findFirst({ where: { contentItemId: contentItem.id, platform: request.platform }, orderBy: { version: "desc" } });
          const merged = this.merge(request.partial, generated, latestScript, latestScene);
          const version = (latestScript?.version ?? 0) + 1;
          const scriptVersion = await tx.scriptVersion.create({ data: { contentItemId: contentItem.id, version, platform: request.platform, ...merged.script, durationSeconds: new Prisma.Decimal(merged.script.durationSeconds.toFixed(3)), promptVersion, qualitySnapshot: { metadata: merged.metadata, facts: merged.facts, model: generated.model, generationContext: generated.generationContext, strategyVersion: generated.strategyVersion } } });
          const sceneVersion = await tx.sceneVersion.create({ data: { contentItemId: contentItem.id, scriptVersionId: scriptVersion.id, version, platform: request.platform, schemaVersion: merged.sceneDocument.schemaVersion, sceneDocument: merged.sceneDocument, durationSeconds: new Prisma.Decimal(merged.script.durationSeconds.toFixed(3)) } });
          const result = { contentItemId: contentItem.id, scriptVersionId: scriptVersion.id, sceneVersionId: sceneVersion.id, version };
          const usage = await tx.providerUsage.create({ data: { contentItemId: contentItem.id, productionJobId: jobId, provider: configProviderName(), model: generated.model, operation: "script-scene-generation", quantity: new Prisma.Decimal(generated.usage.totalTokens), unit: "token", estimatedCost: new Prisma.Decimal(generated.estimatedCostUsd), idempotencyKey: `script-job:${jobId}`, providerResponse: result } });
          await tx.costLedger.create({ data: { contentItemId: contentItem.id, providerUsageId: usage.id, direction: "ESTIMATED", category: "llm", amount: new Prisma.Decimal(generated.estimatedCostUsd), note: `model:${generated.model}` } });
          await tx.contentIdea.update({ where: { id: idea.id }, data: { status: "USED", usedContentItemId: contentItem.id } });
          await tx.contentItem.update({ where: { id: contentItem.id }, data: { status: "REVIEW_REQUIRED" } });
          return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (transactionAttempt === 2 || !this.isRetryableConflict(error)) throw error;
      }
    }
    throw new Error("SCRIPT_GENERATION_TRANSACTION_FAILED");
  }

  merge(partial: ScriptGenerationJobPayload["generation"]["request"]["partial"], generated: StructuredGeneration, latestScript: { hook: string; body: string; callToAction: string | null; language: string; durationSeconds: Prisma.Decimal | null; qualitySnapshot: Prisma.JsonValue | null } | null, latestScene: { sceneDocument: Prisma.JsonValue } | null): MergedGeneration {
    if (partial === "full" || !latestScript) return { metadata: generated.planning.metadata, script: generated.script, facts: generated.facts, sceneDocument: generated.sceneDocument };
    const snapshot = jsonObject(latestScript.qualitySnapshot);
    const storedMetadata = GeneratedMetadataSchema.safeParse(snapshot.metadata).success ? GeneratedMetadataSchema.parse(snapshot.metadata) : generated.planning.metadata;
    const storedFacts = z.array(FactSourceLinkSchema).min(1).safeParse(snapshot.facts).success ? z.array(FactSourceLinkSchema).min(1).parse(snapshot.facts) : generated.facts;
    const storedScene = SceneDocumentSchema.safeParse(latestScene?.sceneDocument).success ? SceneDocumentSchema.parse(latestScene?.sceneDocument) : generated.sceneDocument;
    const storedScript = { hook: latestScript.hook, body: latestScript.body, callToAction: latestScript.callToAction ?? generated.script.callToAction, language: latestScript.language, durationSeconds: latestScript.durationSeconds?.toNumber() ?? generated.script.durationSeconds };
    return {
      metadata: partial === "metadata" ? generated.planning.metadata : storedMetadata,
      script: partial === "hook" ? { ...storedScript, hook: generated.script.hook } : partial === "body" ? { ...storedScript, body: generated.script.body } : storedScript,
      facts: storedFacts,
      sceneDocument: partial === "scene" ? { ...storedScene, scenes: storedScene.scenes.map((scene, index) => ({ ...scene, visualPrompt: generated.sceneDocument.scenes[index]?.visualPrompt ?? scene.visualPrompt })) }
        : partial === "hook" ? { ...storedScene, scenes: storedScene.scenes.map((scene, index) => index === 0 ? { ...scene, narration: { ...scene.narration, text: generated.script.hook } } : scene) }
          : partial === "body" ? { ...storedScene, scenes: storedScene.scenes.map((scene, index) => index > 0 ? { ...scene, narration: { ...scene.narration, text: generated.sceneDocument.scenes[index]?.narration.text ?? scene.narration.text } } : scene) }
            : storedScene
    };
  }

  private readResult(value: Prisma.JsonValue | null): GenerationResult | null {
    const record = jsonObject(value);
    return typeof record.contentItemId === "string" && typeof record.scriptVersionId === "string" && typeof record.sceneVersionId === "string" && typeof record.version === "number" ? record as GenerationResult : null;
  }

  private isRetryableConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}

const configProviderName = (): string => loadConfig().LLM_PROVIDER === "openai" ? "openai" : "fake-llm";
