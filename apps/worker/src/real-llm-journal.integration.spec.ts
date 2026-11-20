import { AssetRepository } from "@postbot/asset-library";
import { PrismaClient } from "@postbot/database";
import { z } from "zod";
import { FakeLlmProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ScriptGenerationProcessor } from "./script-generation-processor.js";
import { DeterministicJobProcessor } from "./job-processor.js";
import { recoverQueues } from "./queue-recovery.js";
import { BullMqQueueAdapter } from "@postbot/jobs";

const enabled = process.env.RUN_DB_INTEGRATION === "1" && new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");
const prisma = new PrismaClient();
describe.skipIf(!enabled).sequential("real LLM call journal (mock HTTP, no paid calls)", () => {
  afterAll(async () => prisma.$disconnect());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const fixture = async () => {
    vi.stubEnv("LLM_PROVIDER", "openai"); vi.stubEnv("OPENAI_API_KEY", "contract-only"); vi.stubEnv("LLM_INPUT_USD_PER_MILLION_TOKENS", "1"); vi.stubEnv("LLM_OUTPUT_USD_PER_MILLION_TOKENS", "1"); vi.stubEnv("LLM_MAX_RETRIES", "1");
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@llm-journal.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Journal", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Journal", slug: key } });
    const idea = await prisma.contentIdea.create({ data: { channelId: channel.id, title: "Software verification", summary: "A staging test checks software.", canonicalUrl: "https://example.com/source", urlHash: key, contentHash: key, sourceName: "Fixture", sourceKind: "RSS", provider: "fixture", suitabilityScore: 1, freshnessScore: 1, reliabilityScore: 1, expectedValueScore: 1 } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key, status: "RUNNING" } });
    await prisma.automationCostReservation.create({ data: { automationRunId: run.id, stage: "SCRIPT", amount: 1, idempotencyKey: `automation:${run.id}:script:youtube:cost` } });
    const payload = { automation: { runId: run.id, stage: "SCRIPT", platform: "YOUTUBE" }, generation: { request: { ideaId: idea.id, idempotencyKey: key, platform: "YOUTUBE" as const, partial: "full" as const }, idea: { id: idea.id, channelId: channel.id, title: idea.title, summary: idea.summary ?? "", canonicalUrl: idea.canonicalUrl, sourceName: "Fixture", sourceKind: "RSS", publishedAt: null, topic: "software", language: "en" } } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, type: "SCRIPT", queueName: "script", idempotencyKey: key, payload } });
    const valid = await new FakeLlmProvider().generateScriptAndScene({ model: "gpt-5-mini", promptVersion: "v1", idempotencyKey: key, title: idea.title, summary: idea.summary ?? "", topic: "software", platform: "YOUTUBE", partial: "full", sources: [{ title: idea.title, summary: idea.summary ?? "", url: idea.canonicalUrl }] });
    return { job, payload, output: valid.structuredOutput };
  };
  const response = (output: unknown) => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
  it("resumes a recovered response under its original call key without another paid request", async () => {
    const item = await fixture(); const callKey = `${item.payload.generation.request.idempotencyKey}:attempt:1`;
    await prisma.productionJob.update({ where: { id: item.job.id }, data: { payload: { ...item.payload, _llmAttempts: { [callKey]: { state: "COMPLETED", response: { provider: "openai", idempotencyKey: callKey, createdAt: new Date().toISOString(), model: "gpt-5-mini", promptVersion: "recovered-v1", structuredOutput: z.json().parse(item.output), usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, estimatedCostUsd: "0.000030" } } }, _providerReconciliations: { fixture: { outcome: "RESULT_AVAILABLE", evidenceHash: "a".repeat(64) } } } } });
    const network = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", network);
    const result = await new ScriptGenerationProcessor(prisma).process(item.job.id, item.payload);
    expect(result).toHaveProperty("sceneVersionId"); expect(network).not.toHaveBeenCalled();
    const saved = JSON.stringify((await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } })).payload);
    expect(saved).toContain(JSON.stringify(callKey)); expect(saved).toContain('"state":"COMPLETED"');
    expect(await prisma.costLedger.count({ where: { providerUsage: { productionJobId: item.job.id } } })).toBe(1);
  });
  it("includes invalid schema attempts in usage and cost, and reuses a completed logical result", async () => {
    const item = await fixture();
    const network = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ invalid: true })).mockResolvedValueOnce(response(item.output));
    vi.stubGlobal("fetch", network);
    const processor = new ScriptGenerationProcessor(prisma);
    const result = await processor.process(item.job.id, item.payload);
    const usage = await prisma.providerUsage.aggregate({ where: { productionJobId: item.job.id }, _sum: { estimatedCost: true, actualCost: true, quantity: true } });
    expect(usage._sum.estimatedCost?.toFixed(6)).toBe("0.000060");
    expect(usage._sum.actualCost).toBeNull();
    expect(usage._sum.quantity?.toNumber()).toBe(60);
    expect(await processor.process(item.job.id, item.payload)).toEqual(result);
    expect(network).toHaveBeenCalledTimes(2);
    await new DeterministicJobProcessor(prisma).process({ id: item.job.id, type: "SCRIPT", queueName: "script", runAfter: null, payload: item.payload });
    expect(await prisma.automationCostReservation.findUniqueOrThrow({ where: { idempotencyKey: `automation:${item.payload.automation.runId}:script:youtube:cost` } })).toMatchObject({ releasedAt: null, settlementBasis: "KNOWN_USAGE_BILLING_PENDING" });
    expect((await prisma.automationCostReservation.findUniqueOrThrow({ where: { idempotencyKey: `automation:${item.payload.automation.runId}:script:youtube:cost` } })).settledAt).not.toBeNull();

    expect(await prisma.costLedger.count({ where: { providerUsage: { productionJobId: item.job.id } } })).toBe(2);
    const queue = new BullMqQueueAdapter(process.env.REDIS_URL ?? "redis://127.0.0.1:16379", `known-receipt-${randomUUID()}`);
    try {
      await prisma.productionJob.update({ where: { id: item.job.id }, data: { status: "RUNNING", heartbeatAt: new Date(Date.now() - 600000), executionToken: randomUUID() } });
      await recoverQueues(prisma, queue, 60000);
      expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } })).status).toBe("RETRY_WAIT");
      await new DeterministicJobProcessor(prisma).process({ id: item.job.id, type: "SCRIPT", queueName: "script", runAfter: null, payload: item.payload });
      expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } })).status).toBe("SUCCEEDED");
      expect(network).toHaveBeenCalledTimes(2);
      expect(await prisma.costLedger.count({ where: { providerUsage: { productionJobId: item.job.id } } })).toBe(2);
    } finally { await queue.close(); }
  });
  it("refuses a long-input call before network I/O when remaining reservation is insufficient", async () => {
    const item = await fixture();
    await prisma.contentIdea.update({ where: { id: item.payload.generation.idea.id }, data: { rawSnapshot: { body: "긴 원문 ".repeat(2000) } } });
    await prisma.automationCostReservation.updateMany({ where: { automationRunId: item.payload.automation.runId }, data: { amount: "0.000001" } });
    const network = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", network);
    await expect(new ScriptGenerationProcessor(prisma).process(item.job.id, item.payload)).rejects.toThrow("BUDGET_RESERVATION_EXHAUSTED");
    expect(network).not.toHaveBeenCalled();
  });
  it("checks remaining reservation again before schema regeneration and keeps incurred usage", async () => {
    const item = await fixture();
    const network = vi.fn<typeof fetch>(async () => {
      await prisma.automationCostReservation.updateMany({ where: { automationRunId: item.payload.automation.runId }, data: { amount: "0.000001" } });
      return response({ invalid: true });
    });
    vi.stubGlobal("fetch", network);
    await expect(new ScriptGenerationProcessor(prisma).process(item.job.id, item.payload)).rejects.toThrow("BUDGET_RESERVATION_EXHAUSTED");
    expect(network).toHaveBeenCalledTimes(1);
    expect((await prisma.providerUsage.aggregate({ where: { productionJobId: item.job.id }, _sum: { estimatedCost: true } }))._sum.estimatedCost?.toFixed(6)).toBe("0.000030");
  });
  it("does not pay for a new attempt when usage persistence fails after a response", async () => {
    const item = await fixture();
    const network = vi.fn<typeof fetch>().mockResolvedValue(response(item.output)); vi.stubGlobal("fetch", network);
    vi.spyOn(AssetRepository.prototype, "recordProviderCost").mockRejectedValueOnce(new Error("Injected cost persistence failure"));
    await expect(new ScriptGenerationProcessor(prisma).process(item.job.id, item.payload)).rejects.toThrow("AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED");
    expect(network).toHaveBeenCalledTimes(1);
    expect(await prisma.providerUsage.count({ where: { productionJobId: item.job.id } })).toBe(0);
    await new ScriptGenerationProcessor(prisma).process(item.job.id, item.payload);
    expect(network).toHaveBeenCalledTimes(1);
    expect(await prisma.providerUsage.count({ where: { productionJobId: item.job.id, operation: "script-generation-attempt" } })).toBe(1);
  });
  it("holds an uncertain call and prevents further calls on redelivery", async () => {
    const item = await fixture();
    const network = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", network);
    const input = { id: item.job.id, type: "SCRIPT" as const, queueName: "script" as const, runAfter: null, payload: item.payload };
    await new DeterministicJobProcessor(prisma).process(input);
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: item.job.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED" });
    await expect(new ScriptGenerationProcessor(prisma).process(item.job.id, item.payload)).rejects.toThrow("AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED");
    expect(network).toHaveBeenCalledTimes(1);
  });
});
