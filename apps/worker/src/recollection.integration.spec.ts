import { collectionProfilePreset } from "@postbot/contracts";
import { PrismaClient } from "@postbot/database";
import { FakeLlmProvider, sourceRecord, type LlmGenerationRequest, type TopicSourceCandidate } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CollectProcessor } from "./collect-processor.js";
import { SourceCollection } from "./source-collection.js";
import { ScriptGenerationProcessor } from "./script-generation-processor.js";
const prisma = new PrismaClient();
describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("PR5 recollection and independent question completion", () => {
  afterAll(() => prisma.$disconnect());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });
  async function fixture() {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@recollection.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, slug: key, name: "Fixture" } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, language: "en" } });
    const profile = collectionProfilePreset("HISTORY", "en"); profile.subtopics = ["history"]; profile.production.requireVisualEvidence = false; profile.limits.pagesPerSource = 1; profile.limits.targetCandidates = 1;
    await prisma.collectionRule.create({ data: { channelId: channel.id, profile, keywords: ["history"], recencyHours: 24, collectionFrequencyMinutes: 60 } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key } });
    const request = { channelId: channel.id, topic: "history", keywords: ["history"], allowedSources: [], excludedSources: [], recencyHours: 24, idempotencyKey: key };
    const payload = (mode = "DISCOVER") => ({ automation: { runId: run.id, stage: "COLLECT" }, collect: { ...request, mode, language: "en", excludedKeywords: [], excludedTopics: [] } });
    return { key, channel, workspace, profile, request, run, payload };
  }
  function candidate(body: string, scope: "SUMMARY" | "FULL_TEXT", url = "https://www.loc.gov/item/rome"): TopicSourceCandidate {
    return { title: "Roman history", summary: "Roman history record", body, url, sourceName: "LOC", sourceKind: "OFFICIAL", reliabilityScore: 0.8, publishedAt: null, reliabilityMetadata: { contentScope: scope, role: "EVIDENCE", evidence: scope === "FULL_TEXT" ? [{ url, start: 0, end: body.length, scope: "FULL_TEXT" }] : [], media: { references: ["https://www.loc.gov/rome.jpg"], rights: "ITEM_REVIEW_REQUIRED" } } };
  }
  const text = "Rome fall because institutions weakened. This history record describes the original evidence and its provenance in detail. ".repeat(2);
  it("upgrades the same unused URL from summary to full text instead of returning the stale candidate", async () => {
    const f = await fixture(); let current = candidate("history summary", "SUMMARY");
    const processor = new CollectProcessor(prisma, { collect: () => Promise.resolve({ provider: "fixture", idempotencyKey: f.key, createdAt: new Date().toISOString(), candidates: [current] }) });
    await processor.process(f.payload()); current = candidate(text, "FULL_TEXT"); await processor.process(f.payload());
    const stored = await prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } });
    expect(stored.rawSnapshot).toMatchObject({ contentScope: "FULL_TEXT", body: text });
    expect(await prisma.contentIdea.count({ where: { channelId: f.channel.id } })).toBe(1);
  });
  it("preserves full text after lower quality reads, versions changes once, and retains distinct source lineage", async () => {
    const f = await fixture(); let current = candidate(text, "FULL_TEXT");
    const processor = new CollectProcessor(prisma, { collect: () => Promise.resolve({ provider: "fixture", idempotencyKey: f.key, createdAt: new Date().toISOString(), candidates: [current] }) });
    const read = () => prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } });
    await processor.process(f.payload()); const original = await read();
    await processor.process(f.payload()); expect(await read()).toMatchObject({ rawSnapshot: original.rawSnapshot });
    current = candidate("history summary", "SUMMARY"); await processor.process(f.payload());
    current = { ...current, reliabilityMetadata: { ...current.reliabilityMetadata, evidenceFailure: "ORIGINAL_UNAVAILABLE" } }; await processor.process(f.payload());
    expect((await read()).rawSnapshot).toMatchObject({ body: text, contentScope: "FULL_TEXT" });
    const before = Object.keys(sourceRecord(sourceRecord((await read()).rawSnapshot).sourceVersions)).length;
    await processor.process(f.payload()); expect(Object.keys(sourceRecord(sourceRecord((await read()).rawSnapshot).sourceVersions))).toHaveLength(before);
    current = { ...candidate(text, "FULL_TEXT", "https://archive.test/same-record"), contentHash: original.contentHash };
    await processor.process(f.payload()); const aliased = await read();
    expect(aliased).toMatchObject({ canonicalUrl: original.canonicalUrl, sourceName: "LOC" });
    expect(Object.values(sourceRecord(sourceRecord(aliased.rawSnapshot).sourceVersions)).map(sourceRecord).some((entry) => entry.url === current.url && entry.changeReason === "ALTERNATE_SOURCE_SAME_CONTENT")).toBe(true);
    expect(await prisma.contentIdea.count({ where: { channelId: f.channel.id } })).toBe(1);
    current = { ...candidate(`${text} A contradictory claim is recorded.`, "FULL_TEXT"), reliabilityMetadata: { contentScope: "FULL_TEXT", researchState: "CONFLICTING_EVIDENCE" } };
    await processor.process(f.payload()); expect((await read()).rawSnapshot).toMatchObject({ body: text });
    expect(Object.values(sourceRecord(sourceRecord((await read()).rawSnapshot).sourceVersions)).map(sourceRecord).some((entry) => entry.changeReason === "CONFLICT_REQUIRES_REVIEW")).toBe(true);
    expect(await processor.process(f.payload("RANK"))).toMatchObject({ ranked: 0 });
  });
  it("pins the enriched original used by the actual generator and keeps later observations separate", async () => {
    vi.stubEnv("LLM_PROVIDER", "fake"); const f = await fixture(); let current = candidate("history summary", "SUMMARY");
    const collector = new CollectProcessor(prisma, { collect: () => Promise.resolve({ provider: "fixture", idempotencyKey: f.key, createdAt: new Date().toISOString(), candidates: [current] }) });
    await collector.process(f.payload()); current = candidate(text, "FULL_TEXT"); await collector.process(f.payload());
    const idea = await prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } }); const active = sourceRecord(idea.rawSnapshot).sourceVersionId;
    const payload = { generation: { request: { ideaId: idea.id, idempotencyKey: f.key, platform: "YOUTUBE", partial: "full" }, idea: { id: idea.id, channelId: f.channel.id, title: idea.title, summary: idea.summary ?? "", canonicalUrl: idea.canonicalUrl, sourceName: idea.sourceName, sourceKind: idea.sourceKind, publishedAt: null, topic: "history", language: "en" } } };
    const job = await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "SCRIPT", queueName: "script", idempotencyKey: f.key, payload } });
    const originalGenerate = new FakeLlmProvider().generateScriptAndScene.bind(new FakeLlmProvider()); let observed: LlmGenerationRequest | undefined;
    vi.spyOn(FakeLlmProvider.prototype, "generateScriptAndScene").mockImplementation(async (request) => { observed = request; current = candidate(`${text} New revised history record.`, "FULL_TEXT"); await collector.process(f.payload()); return originalGenerate(request); });
    const result = await new ScriptGenerationProcessor(prisma).process(job.id, payload);
    expect(observed?.sources[0]?.summary).toContain(text);
    expect(observed?.sources[0]?.summary).not.toContain("New revised history record");
    const used = await prisma.contentIdea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(used).toMatchObject({ status: "USED", usedContentItemId: result.contentItemId, rawSnapshot: { body: text, sourceVersionId: active } });
    expect(Object.keys(sourceRecord(sourceRecord(used.rawSnapshot).sourceVersions))).toHaveLength(3);
    const script = await prisma.scriptVersion.findUniqueOrThrow({ where: { id: result.scriptVersionId } });
    expect(script.qualitySnapshot).toMatchObject({ generationContext: { sourceVersionId: active, sourceFingerprint: sourceRecord(used.rawSnapshot).sourceFingerprint } });
    expect(await prisma.sourceReference.findFirstOrThrow({ where: { contentItemId: result.contentItemId } })).toMatchObject({ normalizedSnapshot: { body: text, sourceVersionId: active } });
    await collector.process(f.payload()); expect(await prisma.contentIdea.findUniqueOrThrow({ where: { id: idea.id } })).toMatchObject({ status: "USED", usedContentItemId: result.contentItemId, rawSnapshot: { body: text, sourceVersionId: active } });
  });
  it("versions a newer full original without allowing an older cached response to replace it", async () => {
    const f = await fixture(); let current = { ...candidate(text, "FULL_TEXT"), reliabilityMetadata: { ...candidate(text, "FULL_TEXT").reliabilityMetadata, collectedAt: "2026-11-20T00:00:00Z" } };
    const collector = new CollectProcessor(prisma, { collect: () => Promise.resolve({ provider: "fixture", idempotencyKey: f.key, createdAt: new Date().toISOString(), candidates: [current] }) });
    await collector.process(f.payload()); const older = current;
    current = { ...candidate(`${text} Revised original evidence.`, "FULL_TEXT"), reliabilityMetadata: { ...candidate(text, "FULL_TEXT").reliabilityMetadata, collectedAt: "2026-11-21T00:00:00Z" } };
    await collector.process(f.payload()); const newest = await prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } });
    current = older; await collector.process(f.payload());
    expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: newest.id } })).rawSnapshot).toMatchObject({ body: `${text} Revised original evidence.`, sourceVersionId: sourceRecord(newest.rawSnapshot).sourceVersionId });
    expect(Object.keys(sourceRecord(sourceRecord(newest.rawSnapshot).sourceVersions))).toHaveLength(2);
  });
  it("serializes concurrent recollection and selection without clearing reservations or duplicating versions", async () => {
    const f = await fixture(); let current = candidate("history summary", "SUMMARY");
    const collector = new CollectProcessor(prisma, { collect: () => Promise.resolve({ provider: "fixture", idempotencyKey: f.key, createdAt: new Date().toISOString(), candidates: [current] }) });
    await collector.process(f.payload()); current = candidate(text, "FULL_TEXT");
    await Promise.all([collector.process(f.payload()), collector.process(f.payload()), collector.process(f.payload("SELECT"))]);
    const row = await prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } }); const snapshot = sourceRecord(row.rawSnapshot);
    expect(snapshot.reservationRunId).toBe(f.run.id); expect(row.status).toBe("SHORTLISTED");
    const pinnedBody = snapshot.body; current = candidate(`${text} Later observation.`, "FULL_TEXT");
    await Promise.all([collector.process(f.payload()), collector.process(f.payload())]);
    const after = await prisma.contentIdea.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "SHORTLISTED", rawSnapshot: { body: pinnedBody, reservationRunId: f.run.id } });
    expect(await prisma.contentIdea.count({ where: { channelId: f.channel.id } })).toBe(1);
    expect(Object.keys(sourceRecord(sourceRecord(after.rawSnapshot).sourceVersions))).toHaveLength(3);
  });
  it("researches the question original after a general candidate fills targetCandidates=1", async () => {
    const f = await fixture(); const question = { id: "rome", question: "Why did Rome fall?", subtopic: "history", origin: "EDITORIAL", status: "INVESTIGATE" };
    const reads: string[] = [];
    const source = new SourceCollection(prisma, f.channel.id, f.profile, "", (kind, raw) => {
      reads.push(`${kind}:${raw}`); const url = new URL(raw);
      if (kind === "LOC") { const general = url.searchParams.get("q") === "history"; return Promise.resolve({ results: [{ id: `https://www.loc.gov/item/${general ? "a-general" : "z-rome"}`, title: general ? "history archive" : "Roman history", description: [general ? "general history" : "Rome history"] }] }); }
      return Promise.resolve({ text: `<h1>history record</h1><main>${url.pathname.includes("z-rome") ? text : "General history original archival record with sufficient historical documentation. ".repeat(3)}</main>` });
    });
    const result = await source.collect({ ...f.request, researchQuestions: [question] });
    expect(reads.some((read) => read === "HTML:https://www.loc.gov/item/z-rome")).toBe(true);
    expect(result.research?.[0]?.state).toBe("ANSWER_EVIDENCE_AVAILABLE");
    expect(result.diagnostics).toMatchObject({ selected: 1 });
  });
  it("gives multiple questions bounded original reads independently of the production target", async () => {
    const f = await fixture(); f.profile.limits.dailyCalls = 6;
    const questions = [{ id: "rome", question: "Why did Rome fall?", subtopic: "history", origin: "EDITORIAL", status: "INVESTIGATE" }, { id: "egypt", question: "Why were pyramids built?", subtopic: "history", origin: "AUDIENCE", status: "INVESTIGATE" }];
    const read = vi.fn((kind: string, raw: string) => {
      const url = new URL(raw); const q = url.searchParams.get("q") ?? "";
      if (kind === "LOC") return Promise.resolve({ results: [{ id: `https://www.loc.gov/item/${q.includes("Rome") ? "rome" : q.includes("pyramids") ? "egypt" : "a-general"}`, title: "history archive", description: ["history material"] }] });
      return Promise.resolve({ text: `<h1>history record</h1><main>${url.pathname.includes("rome") ? text : url.pathname.includes("egypt") ? "Pyramids built because royal burials required monumental tombs. This history record preserves original archival evidence. ".repeat(2) : "General history archival description without a related answer. ".repeat(3)}</main>` });
    });
    const result = await new SourceCollection(prisma, f.channel.id, f.profile, "", read).collect({ ...f.request, researchQuestions: questions });
    expect(result.research?.map((outcome) => outcome.state)).toEqual(["ANSWER_EVIDENCE_AVAILABLE", "ANSWER_EVIDENCE_AVAILABLE"]);
    expect(result.research?.every((outcome) => outcome.investigation?.enriched === 1)).toBe(true);
    expect(result.diagnostics).toMatchObject({ selected: 1 }); expect(read).toHaveBeenCalledTimes(6);
    const before = read.mock.calls.length;
    await new SourceCollection(prisma, f.channel.id, f.profile, "", read).collect({ ...f.request, researchQuestions: questions });
    expect(read.mock.calls).toHaveLength(before);
  });
  it("checkpoints a budget-blocked original and resumes next UTC day without repeating discovery", async () => {
    const f = await fixture(); f.profile.limits.dailyCalls = 1;
    const question = { id: "rome", question: "Why did Rome fall?", subtopic: "history", origin: "EDITORIAL", status: "INVESTIGATE" };
    const read = vi.fn((kind: string) => Promise.resolve(kind === "LOC" ? { results: [{ id: "https://www.loc.gov/item/rome", title: "history Rome", description: ["history Rome"] }] } : { text: `<h1>history Rome</h1><main>${text}</main>` }));
    const first = await new SourceCollection(prisma, f.channel.id, f.profile, "", read).collect({ ...f.request, researchQuestions: [question] });
    expect(first.research?.[0]).toMatchObject({ state: "RESEARCH_PARTIAL", reason: "SOURCE_DAILY_CALL_BUDGET_EXHAUSTED", investigation: { state: "PARTIAL", enriched: 0 } });
    expect(read).toHaveBeenCalledTimes(1);
    const resume = { ...question, status: "RESEARCH_PARTIAL", progress: first.research?.[0]?.investigation?.progress };
    const repeated = await new SourceCollection(prisma, f.channel.id, f.profile, "", read).collect({ ...f.request, researchQuestions: [resume] });
    expect(read).toHaveBeenCalledTimes(1); expect(repeated.research?.[0]?.state).toBe("RESEARCH_PARTIAL");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 86400000));
    const restored = await new SourceCollection(prisma, f.channel.id, f.profile, "", read).collect({ ...f.request, researchQuestions: [resume] });
    expect(restored.research?.[0]).toMatchObject({ state: "ANSWER_EVIDENCE_AVAILABLE", investigation: { state: "COMPLETE", enriched: 1 } });
    expect(read.mock.calls.map(([kind]) => kind)).toEqual(["LOC", "HTML"]);
    expect(restored.diagnostics).toMatchObject({ selected: 1 });
  });
  it("persists partial progress, deduplicates unchanged evidence history and automatically resumes from the database", async () => {
    const f = await fixture(); f.profile.limits.dailyCalls = 1;
    await prisma.collectionRule.updateMany({ where: { channelId: f.channel.id }, data: { profile: f.profile } });
    const question = await prisma.researchQuestion.create({ data: { channelId: f.channel.id, idempotencyKey: f.key, question: "Why did Rome fall?", subtopic: "history", origin: "EDITORIAL" } });
    const days: number[] = []; const queries: string[] = [];
    const source = new SourceCollection(prisma, f.channel.id, f.profile, "", (kind, raw) => {
      days.push(Math.floor(Date.now() / 86400000)); if (kind === "LOC") queries.push(new URL(raw).searchParams.get("q") ?? "");
      return Promise.resolve(kind === "LOC" ? { results: [{ id: "https://www.loc.gov/item/rome", title: "history Rome", description: ["history Rome"] }] } : { text: `<h1>history Rome</h1><main>${text}</main>` });
    });
    const collector = new CollectProcessor(prisma, { collect: (request) => source.collect(request) });
    await collector.process(f.payload()); const first = await prisma.researchQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(first.status).toBe("RESEARCH_PARTIAL");
    await collector.process(f.payload()); const repeated = await prisma.researchQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(sourceRecord(repeated.evidence).history).toEqual(sourceRecord(first.evidence).history);
    const initial = Date.now(); vi.useFakeTimers({ toFake: ["Date"] });
    for (let day = 1; day <= 5; day++) {
      vi.setSystemTime(new Date(initial + day * 86400000)); await collector.process(f.payload());
      if ((await prisma.researchQuestion.findUniqueOrThrow({ where: { id: question.id } })).status === "CLAIM_REVIEW_REQUIRED") break;
    }
    expect(await prisma.researchQuestion.findUniqueOrThrow({ where: { id: question.id } })).toMatchObject({ status: "CLAIM_REVIEW_REQUIRED", evidence: { claimsVerified: false } });
    expect(queries.filter((query) => query === question.question)).toHaveLength(1);
    expect([...new Set(days)].every((day) => days.filter((value) => value === day).length <= 1)).toBe(true);
    expect(await prisma.contentIdea.count({ where: { channelId: f.channel.id } })).toBe(1);
  });
  it("keeps processing and per-question limits distinct from examined unrelated evidence", async () => {
    const f = await fixture(); f.profile.limits.processingCandidates = 20;
    const question = { id: "rome", question: "Why did Rome fall?", subtopic: "history", origin: "EDITORIAL", status: "INVESTIGATE" };
    let originals = 0;
    const source = new SourceCollection(prisma, f.channel.id, f.profile, "", (kind, raw) => {
      if (kind === "LOC") return Promise.resolve({ results: new URL(raw).searchParams.get("q") === "history" ? [] : Array.from({ length: 25 }, (_, i) => ({ id: `https://www.loc.gov/item/rome-${i}`, title: "history record", description: ["history material"] })) });
      originals++; return Promise.resolve({ text: `<h1>Unrelated history</h1><main>${"An Egyptian burial history record discusses pyramids and tombs, without any Roman event or claim. ".repeat(3)}</main>` });
    });
    const result = await source.collect({ ...f.request, researchQuestions: [question] });
    expect(originals).toBe(2); expect(result.research?.[0]).toMatchObject({ state: "RESEARCH_PARTIAL", reason: "PROCESSING_LIMIT_REACHED", sources: [] });
    expect(result.diagnostics).toMatchObject({ deduplicatedProcessed: 20, selected: 1 });
    const resumed = await source.collect({ ...f.request, researchQuestions: [{ ...question, status: "RESEARCH_PARTIAL", progress: result.research?.[0]?.investigation?.progress }] });
    expect(originals).toBe(4); expect(resumed.research?.[0]?.state).toBe("RESEARCH_PARTIAL"); expect(resumed.research?.[0]?.sources).toEqual([]);
  });
  it("links question evidence to the persisted observation and does not overwrite a concurrent manual recheck", async () => {
    const f = await fixture(); const question = await prisma.researchQuestion.create({ data: { channelId: f.channel.id, idempotencyKey: f.key, question: "Why did Rome fall?", subtopic: "history", origin: "EDITORIAL" } });
    let recheck = false;
    const collector = new CollectProcessor(prisma, { collect: async (request) => {
      if (recheck) await prisma.researchQuestion.update({ where: { id: question.id }, data: { status: "INVESTIGATE", reason: "MANUAL_RECHECK_REQUESTED", updatedAt: new Date(Date.now() + 1000) } });
      return { provider: "fixture", idempotencyKey: f.key, createdAt: new Date().toISOString(), candidates: [{ ...candidate(text, "FULL_TEXT"), reliabilityMetadata: { ...candidate(text, "FULL_TEXT").reliabilityMetadata, researchRequests: request.researchQuestions?.map((entry) => ({ questionId: entry.id, query: entry.question })) } }] };
    } });
    await collector.process(f.payload()); const stored = await prisma.researchQuestion.findUniqueOrThrow({ where: { id: question.id } });
    const sources = sourceRecord(stored.evidence).sources; const first = Array.isArray(sources) ? sourceRecord(sources[0]) : {};
    const idea = await prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } });
    expect(first.sourceObservation).toMatchObject({ ideaId: idea.id, versionId: sourceRecord(idea.rawSnapshot).sourceVersionId, fingerprint: sourceRecord(idea.rawSnapshot).sourceFingerprint });
    recheck = true; await prisma.researchQuestion.update({ where: { id: question.id }, data: { status: "INVESTIGATE" } });
    await collector.process(f.payload()); expect(await prisma.researchQuestion.findUniqueOrThrow({ where: { id: question.id } })).toMatchObject({ status: "INVESTIGATE", reason: "MANUAL_RECHECK_REQUESTED" });
  });
});
