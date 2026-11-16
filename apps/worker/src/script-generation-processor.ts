import { loadConfig } from "@postbot/config";
import {
  FactSourceLinkSchema,
  GeneratedMetadataSchema,
  GeneratedScriptSchema,
  ScriptGenerationJobPayloadSchema,
  type GenerationIdeaSnapshot,
  type ScriptGenerationJobPayload
} from "@postbot/contracts";
import { assertExecutionOwner, Prisma, type PrismaClient } from "@postbot/database";
import { estimateLlmInputTokens, FakeLlmProvider, FakeStorageProvider, OpenAiLlmProvider, type LlmGenerationRequest, type LlmGenerationResult, type LlmProvider } from "@postbot/providers";
import { alignSceneNarration, AudioStyleSchema, SceneDocumentSchema, VideoStyleSchema, type SceneDocument } from "@postbot/scene-schema";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assignProductionExperiment } from "@postbot/optimization";
import { AssetRepository, readAssetUsagePurpose, sceneAssetUsageKey } from "@postbot/asset-library";

const promptVersion = "script-scene-v1";
const LlmSnapshotSchema = z.object({ provider: z.string(), idempotencyKey: z.string(), createdAt: z.string(), model: z.string(), promptVersion: z.string(), structuredOutput: z.json(), usage: z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }), estimatedCostUsd: z.string() });

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
    if (input.generation.request.partial === "voice" || input.generation.request.partial === "subtitle") return this.reuseVersion(jobId, input.generation);

    const generated = await this.generate(jobId, input.generation);
    return this.save(jobId, input.generation.idea, input.generation.request, generated);
  }

  private async reuseVersion(jobId: string, input: ScriptGenerationJobPayload["generation"]): Promise<GenerationResult> {
    if (!input.request.platform) throw new Error("PARTIAL_PLATFORM_REQUIRED");
    return this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${input.idea.channelId} FOR UPDATE`;
      const existing = await tx.providerUsage.findUnique({ where: { idempotencyKey: `script-job:${jobId}` } });
      const prior = this.readResult(existing?.providerResponse ?? null); if (prior) return prior;
      const content = await tx.contentItem.findUniqueOrThrow({ where: { channelId_topicKey: { channelId: input.idea.channelId, topicKey: `idea:${input.idea.id}` } } });
      const script = await tx.scriptVersion.findFirstOrThrow({ where: { contentItemId: content.id, platform: input.request.platform }, orderBy: { version: "desc" } });
      const scene = await tx.sceneVersion.findFirstOrThrow({ where: { contentItemId: content.id, platform: input.request.platform }, orderBy: { version: "desc" } });
      const template = await tx.channelTemplate.findFirst({ where: { channelId: input.idea.channelId, isActive: true }, orderBy: { version: "desc" } });
      const document = SceneDocumentSchema.parse(scene.sceneDocument); const visual = jsonObject(template?.visualStyle ?? null); const subtitle = jsonObject(template?.subtitleStyle ?? null);
      if (input.request.partial === "subtitle") document.style = VideoStyleSchema.parse({ ...(document.style ?? {}), captionColor: subtitle.color, captionBackground: subtitle.backgroundColor, captionFontSize: subtitle.fontSize });
      if (visual.audio) document.audio = AudioStyleSchema.parse(visual.audio); else delete document.audio;
      const version = script.version + 1;
      const nextScript = await tx.scriptVersion.create({ data: { contentItemId: content.id, platform: script.platform, version, hook: script.hook, body: script.body, callToAction: script.callToAction, language: script.language, durationSeconds: script.durationSeconds, promptVersion: script.promptVersion, qualitySnapshot: { ...jsonObject(script.qualitySnapshot), reviewStatus: "REVIEW_REQUIRED", reusedFor: input.request.partial } } });
      const nextScene = await tx.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: nextScript.id, platform: scene.platform, version, schemaVersion: scene.schemaVersion, sceneDocument: document, durationSeconds: scene.durationSeconds } });
      const usages = await tx.assetUsage.findMany({ where: { sceneVersionId: scene.id } });
      for (const usage of usages) {
        const purpose = readAssetUsagePurpose(usage);
        if (purpose === "bgm" || purpose === "sfx" || (input.request.partial === "voice" && purpose.startsWith("tts-narration"))) continue;
        await tx.assetUsage.create({ data: { assetId: usage.assetId, contentItemId: content.id, sceneVersionId: nextScene.id, purpose: sceneAssetUsageKey(purpose, nextScene.id), usageSnapshot: { ...jsonObject(usage.usageSnapshot), originalPurpose: purpose } } });
      }
      await tx.publishPlan.updateMany({ where: { contentItemId: content.id, platform: script.platform ?? undefined, status: "SCHEDULED" }, data: { status: "HELD" } });
      await tx.contentItem.update({ where: { id: content.id }, data: { status: "REVIEW_REQUIRED", approvedAt: null } });
      const result = { contentItemId: content.id, scriptVersionId: nextScript.id, sceneVersionId: nextScene.id, version };
      await tx.providerUsage.create({ data: { contentItemId: content.id, productionJobId: jobId, provider: "local-reuse", model: "version-reuse", operation: input.request.partial, quantity: 0, unit: "request", estimatedCost: 0, idempotencyKey: `script-job:${jobId}`, providerResponse: result } });
      return result;
    });
  }

  private async journaledGenerate(jobId: string, request: LlmGenerationRequest, provider: LlmProvider): Promise<LlmGenerationResult> {
    const key = request.idempotencyKey;
    const cached = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
      const payload = jsonObject(job.payload);
      const attempts = jsonObject(payload._llmAttempts ?? null);
      const previous = jsonObject(attempts[key] ?? null);
      const snapshot = LlmSnapshotSchema.safeParse(previous.response);
      if (snapshot.success) return snapshot.data;
      if (previous.state === "STARTED") throw new Error("AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED");
      const automation = jsonObject(payload.automation ?? null);
      if (typeof automation.runId !== "string" || typeof automation.platform !== "string") throw new Error("BUDGET_WORKFLOW_REQUIRED");
      const reservationKey = `automation:${automation.runId}:script:${automation.platform.toLowerCase()}:cost`;
      const reservation = await tx.automationCostReservation.findUnique({ where: { idempotencyKey: reservationKey } });
      if (!reservation || reservation.releasedAt || reservation.settledAt) throw new Error("BUDGET_RESERVATION_EXHAUSTED");
      await tx.$queryRaw`SELECT id FROM automation_cost_reservations WHERE id = ${reservation.id} FOR UPDATE`;
      const currentReservation = await tx.automationCostReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      if (currentReservation.releasedAt || currentReservation.settledAt) throw new Error("BUDGET_RESERVATION_EXHAUSTED");
      const related = await tx.productionJob.findMany({ where: { type: "SCRIPT", AND: [{ payload: { path: "$.automation.runId", equals: automation.runId } }, { payload: { path: "$.automation.platform", equals: automation.platform } }] }, select: { id: true, payload: true } });
      if (related.some((item) => item.id !== jobId && Object.values(jsonObject(jsonObject(item.payload)._llmAttempts ?? null)).some((value) => jsonObject(value ?? null).state === "STARTED"))) throw new Error("AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED");
      const spent = await tx.providerUsage.aggregate({ where: { productionJobId: { in: related.map((item) => item.id) } }, _sum: { estimatedCost: true } });
      const config = loadConfig();
      const upperCost = new Prisma.Decimal(estimateLlmInputTokens(request)).mul(config.LLM_INPUT_USD_PER_MILLION_TOKENS).plus(new Prisma.Decimal(request.maxOutputTokens ?? config.LLM_MAX_OUTPUT_TOKENS).mul(config.LLM_OUTPUT_USD_PER_MILLION_TOKENS)).div(1_000_000);
      if (upperCost.plus(spent._sum.estimatedCost ?? 0).gt(currentReservation.amount)) throw new Error("BUDGET_RESERVATION_EXHAUSTED");
      await tx.productionJob.update({ where: { id: jobId }, data: { payload: { ...payload, _llmAttempts: { ...attempts, [key]: { state: "STARTED", upperCostUsd: upperCost.toFixed(6), estimatedInputTokens: estimateLlmInputTokens(request), maxOutputTokens: request.maxOutputTokens ?? config.LLM_MAX_OUTPUT_TOKENS } } } } });
      return null;
    });
    if (cached) return cached;
    try {
      const response = LlmSnapshotSchema.parse(await provider.generateScriptAndScene(request));
      await this.updateLlmJournal(jobId, key, { state: "COMPLETED", response });
      return response;
    } catch (error) {
      // A definite 4xx rejection may be retried according to provider policy.
      // A timeout, incomplete response or interrupted DB write can have incurred
      // a charge: retain STARTED and require reconciliation before another call.
      if (error instanceof Error && /status 4\d\d\./.test(error.message)) { await this.updateLlmJournal(jobId, key, { state: "REJECTED" }); throw error; }
      throw new Error("AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED");
    }
  }

  private async updateLlmJournal(jobId: string, key: string, value: Prisma.InputJsonObject): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
      const payload = jsonObject(job.payload);
      await tx.productionJob.update({ where: { id: jobId }, data: { payload: { ...payload, _llmAttempts: { ...jsonObject(payload._llmAttempts ?? null), [key]: value } } } });
    });
  }

  private async generate(jobId: string, input: ScriptGenerationJobPayload["generation"]): Promise<GeneratedWithUsage> {
    const config = loadConfig();
    if (config.LLM_PROVIDER === "openai" && (config.LLM_INPUT_USD_PER_MILLION_TOKENS <= 0 || config.LLM_OUTPUT_USD_PER_MILLION_TOKENS <= 0)) throw new Error("LLM_PRICING_REQUIRED");
    const context = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      const content = await tx.contentItem.upsert({ where: { channelId_topicKey: { channelId: input.idea.channelId, topicKey: `idea:${input.idea.id}` } }, create: { channelId: input.idea.channelId, topicKey: `idea:${input.idea.id}`, title: input.idea.title, status: "GENERATING" }, update: {} });
      const experiment = input.request.partial === "full" ? await assignProductionExperiment(tx, input.idea.channelId, content.id, input.request.platform ?? undefined) : null;
      return { experiment, contentItemId: content.id };
    });
    const experiment = context.experiment;
    const provider: LlmProvider = config.LLM_PROVIDER === "openai"
      ? new OpenAiLlmProvider({ apiKey: config.OPENAI_API_KEY, baseUrl: config.OPENAI_BASE_URL, timeoutMs: config.LLM_TIMEOUT_MS, inputUsdPerMillionTokens: config.LLM_INPUT_USD_PER_MILLION_TOKENS, outputUsdPerMillionTokens: config.LLM_OUTPUT_USD_PER_MILLION_TOKENS })
      : new FakeLlmProvider();
    let lastError: unknown;
    let knownCost = new Prisma.Decimal(0);
    const knownUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
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
        const visual = jsonObject(template?.visualStyle ?? null);
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
          strategy: experiment?.strategy ?? (Object.keys(strategy).length > 0 ? strategy : null),
          experiment: experiment ? { experimentId: experiment.experimentId, arm: experiment.arm, assignmentKey: experiment.assignmentKey, targetDurationSeconds: experiment.strategy.durationSeconds, toleranceSeconds: experiment.durationToleranceSeconds } : null
        };
        const sourceIdea = await this.prisma.contentIdea.findUnique({ where: { id: input.idea.id }, select: { rawSnapshot: true } });
        const sourceBody = jsonObject(sourceIdea?.rawSnapshot ?? null).body;
        const request: LlmGenerationRequest = {
          model: config.LLM_MODEL, maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS, promptVersion, idempotencyKey: `${input.request.idempotencyKey}:attempt:${attempt}`,
          title: input.idea.title, summary: input.idea.summary, topic: input.idea.topic, platform: input.request.platform,
          partial: input.request.partial, sources: [{ title: input.idea.title, summary: [input.idea.summary, typeof sourceBody === "string" ? sourceBody : "Original source text was not collected; verify claims manually."].join("\n"), url: input.idea.canonicalUrl }],
          channelContext: generationContext
        };
        const response = config.LLM_PROVIDER === "openai" ? await this.journaledGenerate(jobId, request, provider) : await provider.generateScriptAndScene(request);
        if (config.LLM_PROVIDER === "openai") {
          try { await new AssetRepository(this.prisma, new FakeStorageProvider()).recordProviderCost({ contentItemId: context.contentItemId, productionJobId: jobId, provider: "openai", model: response.model, operation: "script-generation-attempt", quantity: response.usage.totalTokens, unit: "token", category: "llm", estimatedCostUsd: response.estimatedCostUsd, idempotencyKey: `script-attempt-cost:${jobId}:${attempt}` }); } catch { throw new Error("AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED"); }
        }
        knownCost = knownCost.plus(response.estimatedCostUsd);
        knownUsage.promptTokens += response.usage.promptTokens; knownUsage.completionTokens += response.usage.completionTokens; knownUsage.totalTokens += response.usage.totalTokens;
        const structured = this.parse(response.structuredOutput, input.idea);
        if (experiment && (Math.abs(structured.script.durationSeconds - experiment.strategy.durationSeconds) > experiment.durationToleranceSeconds || Math.abs(structured.sceneDocument.durationInFrames / structured.sceneDocument.fps - experiment.strategy.durationSeconds) > experiment.durationToleranceSeconds)) throw new Error("EXPERIMENT_DURATION_NOT_APPLIED");
        structured.sceneDocument.style = VideoStyleSchema.parse({ ...visual, captionColor: subtitle.color, captionBackground: subtitle.backgroundColor, captionFontSize: subtitle.fontSize, watermark: typeof visual.watermark === "string" ? visual.watermark : channel?.name ?? "Postbot" });
        structured.sceneDocument.aiStockRatio = template?.aiStockRatio.toNumber() ?? 1;
        if (visual.audio) structured.sceneDocument.audio = AudioStyleSchema.parse(visual.audio);
        return { ...structured, model: response.model, usage: config.LLM_PROVIDER === "openai" ? knownUsage : response.usage, estimatedCostUsd: config.LLM_PROVIDER === "openai" ? knownCost.toFixed(6) : response.estimatedCostUsd, generationContext, strategyVersion: channel?.strategyVersions[0]?.version ?? null };
      } catch (error) {
        lastError = error;
        if (error instanceof Error && ["AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED", "BUDGET_RESERVATION_EXHAUSTED", "BUDGET_WORKFLOW_REQUIRED"].includes(error.message)) break;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
    await tx.contentItem.updateMany({ where: { channelId: input.idea.channelId, topicKey: `idea:${input.idea.id}`, status: "GENERATING", scriptVersions: { none: {} } }, data: { status: lastError instanceof Error && lastError.message === "AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED" ? "REVIEW_REQUIRED" : "FAILED" } });
    });
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
          await assertExecutionOwner(tx);
          const existing = await tx.providerUsage.findUnique({ where: { idempotencyKey: `script-job:${jobId}` } });
          const prior = this.readResult(existing?.providerResponse ?? null);
          if (prior) return prior;
          const originalIdea = await tx.contentIdea.findUniqueOrThrow({ where: { id: idea.id } });
          const originalBody = jsonObject(originalIdea.rawSnapshot).body;
          const contentItem = await tx.contentItem.upsert({
            where: { channelId_topicKey: { channelId: idea.channelId, topicKey: `idea:${idea.id}` } },
            update: { title: idea.title, summary: idea.summary, status: "GENERATING" },
            create: { channelId: idea.channelId, title: idea.title, summary: idea.summary, topicKey: `idea:${idea.id}`, collectedAt: new Date(), status: "GENERATING" }
          });
          await tx.sourceReference.upsert({
            where: { contentItemId_urlHash: { contentItemId: contentItem.id, urlHash: sha256(idea.canonicalUrl) } },
            update: {},
            create: { contentItemId: contentItem.id, kind: idea.sourceKind, title: idea.title, url: idea.canonicalUrl, urlHash: sha256(idea.canonicalUrl), sourceName: idea.sourceName, publishedAt: idea.publishedAt ? new Date(idea.publishedAt) : null, reliabilityScore: originalIdea.reliabilityScore, isPrimary: true, normalizedSnapshot: { facts: generated.facts, body: typeof originalBody === "string" ? originalBody : null, contentScope: jsonObject(originalIdea.rawSnapshot).contentScope ?? "UNKNOWN" } }
          });
          const latestScript = await tx.scriptVersion.findFirst({ where: { contentItemId: contentItem.id, platform: request.platform }, orderBy: { version: "desc" } });
          const latestScene = await tx.sceneVersion.findFirst({ where: { contentItemId: contentItem.id, platform: request.platform }, orderBy: { version: "desc" } });
          const merged = this.merge(request.partial, generated, latestScript, latestScene);
          merged.sceneDocument = alignSceneNarration(merged.sceneDocument, [merged.script.hook, merged.script.body, merged.script.callToAction].filter(Boolean).join(" "));
          if (["hook", "body"].includes(request.partial)) merged.facts = [];
          const version = (latestScript?.version ?? 0) + 1;
          const scriptVersion = await tx.scriptVersion.create({ data: { contentItemId: contentItem.id, version, platform: request.platform, ...merged.script, durationSeconds: new Prisma.Decimal(merged.script.durationSeconds.toFixed(3)), promptVersion, qualitySnapshot: { metadata: merged.metadata, facts: merged.facts, provider: configProviderName(), model: generated.model, generationContext: generated.generationContext, strategyVersion: generated.strategyVersion } } });
          const sceneVersion = await tx.sceneVersion.create({ data: { contentItemId: contentItem.id, scriptVersionId: scriptVersion.id, version, platform: request.platform, schemaVersion: merged.sceneDocument.schemaVersion, sceneDocument: merged.sceneDocument, durationSeconds: new Prisma.Decimal(merged.script.durationSeconds.toFixed(3)) } });
          const result = { contentItemId: contentItem.id, scriptVersionId: scriptVersion.id, sceneVersionId: sceneVersion.id, version };
          const real = configProviderName() === "openai";
          const usage = await tx.providerUsage.create({ data: { contentItemId: contentItem.id, productionJobId: jobId, provider: configProviderName(), model: generated.model, operation: "script-scene-generation", quantity: new Prisma.Decimal(real ? 0 : generated.usage.totalTokens), unit: real ? "logical-result" : "token", estimatedCost: new Prisma.Decimal(real ? 0 : generated.estimatedCostUsd), idempotencyKey: `script-job:${jobId}`, providerResponse: { ...result, usage: generated.usage, billingBasis: "configured-unit-rates" } } });
          if (!real) await tx.costLedger.create({ data: { contentItemId: contentItem.id, providerUsageId: usage.id, direction: "ESTIMATED", category: "llm", amount: new Prisma.Decimal(generated.estimatedCostUsd), note: `model:${generated.model}` } });
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
    return typeof record.contentItemId === "string" && typeof record.scriptVersionId === "string" && typeof record.sceneVersionId === "string" && typeof record.version === "number" ? { contentItemId: record.contentItemId, scriptVersionId: record.scriptVersionId, sceneVersionId: record.sceneVersionId, version: record.version } : null;
  }

  private isRetryableConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
  }
}

const configProviderName = (): string => loadConfig().LLM_PROVIDER === "openai" ? "openai" : "fake-llm";
