import { collectionProfilePreset } from "@postbot/contracts";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { SourceCollection } from "./source-collection.js";
import { CollectProcessor } from "./collect-processor.js";
const prisma = new PrismaClient();
describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("PR5 source research regression", () => {
  afterAll(() => prisma.$disconnect());
  async function fixture(kind: "SCIENCE" | "HISTORY" = "SCIENCE") {
    const key = randomUUID(); const user = await prisma.user.create({ data: { email: `${key}@research.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, slug: key, name: "Fixture" } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const profile = collectionProfilePreset(kind, "en"); profile.subtopics = [kind === "SCIENCE" ? "space" : "history"]; profile.limits.pagesPerSource = 1;
    const request = { channelId: channel.id, topic: profile.subtopics[0]!, keywords: profile.subtopics, allowedSources: [], excludedSources: [], recencyHours: 24, freshness: "EVERGREEN" as const, idempotencyKey: key };
    return { key, channel, profile, request };
  }
  const html = (text: string) => ({ text: `<html><h1>${text}</h1><main>${text}. ${"Original archival description with detailed provenance and history context. ".repeat(3)}</main></html>` });
  it("keeps official and RSS opportunities beyond 25 rejected YouTube discoveries within the shared daily budget", async () => {
    const results: string[][] = [];
    for (const reverse of [false, true]) {
      const f = await fixture("HISTORY"); f.profile.production.requireVisualEvidence = false; f.profile.sources.youtubeQueries = ["history"]; f.profile.sources.rssUrls = ["https://archive.test/feed"]; f.profile.sources.evidenceHosts.push("archive.test"); f.profile.limits.dailyCalls = 8;
      let calls = 0;
      const source = new SourceCollection(prisma, f.channel.id, f.profile, "", async (kind, raw) => {
        calls++; await new Promise((resolve) => setTimeout(resolve, reverse ? 1 : 3));
        const url = new URL(raw); const q = url.searchParams.get("q");
        if (kind === "RSS") return { text: '<rss><channel><item><title>history archive</title><link>https://archive.test/item</link><description>history archive original</description></item></channel></rss>' };
        if (kind === "LOC") return { results: q === "history" ? [{ id: "https://www.loc.gov/item/valid", title: "history official record", description: ["history official record"], image_url: ["https://www.loc.gov/image.jpg"] }] : [] };
        const ids = Array.from({ length: 25 }, (_, index) => `video${String(index).padStart(6, "0")}`); if (reverse) ids.reverse();
        if (kind === "YOUTUBE" && url.pathname.endsWith("/search")) return { items: ids.map((videoId) => ({ id: { videoId } })) };
        if (kind === "YOUTUBE") return { items: ids.map((id) => ({ id, snippet: { title: `history discovery ${id}`, description: "No original evidence link" } })) };
        return html("history official original archival record");
      });
      const result = await source.collect(f.request);
      expect(result.candidates.find((candidate) => candidate.sourceName === "LOC")?.reliabilityMetadata?.collectionEvaluation).toMatchObject({ selectedForTarget: true });
      expect(result.candidates.find((candidate) => candidate.sourceKind === "RSS")?.reliabilityMetadata?.collectionEvaluation).toMatchObject({ selectedForTarget: true });
      expect(result.diagnostics).toMatchObject({ finalTarget: 20, selected: 2, freshSuccessfulFetches: 8 });
      expect(calls).toBeLessThanOrEqual(8); expect(await prisma.sourceFetch.count({ where: { channelId: f.channel.id } })).toBeLessThanOrEqual(8);
      expect(result.failures?.some((failure) => failure.code === "SOURCE_DAILY_CALL_BUDGET_EXHAUSTED")).toBe(true);
      results.push(result.candidates.map((candidate) => candidate.url));
    }
    expect(results[0]).toEqual(results[1]);
  });
  it("takes an actual NASA href response through persistence, reevaluation and selection without rights approval", async () => {
    const f = await fixture();
    await prisma.collectionRule.create({ data: { channelId: f.channel.id, profile: f.profile, keywords: ["space"], recencyHours: 24, collectionFrequencyMinutes: 360 } });
    const source = new SourceCollection(prisma, f.channel.id, f.profile, "", (kind) => Promise.resolve(kind === "NASA" ? { collection: { items: [{ href: "https://images-api.nasa.gov/asset/SPACE", data: [{ nasa_id: "SPACE", title: "Space exploration image", description: "Space exploration original NASA description" }], links: [{ href: "https://images-assets.nasa.gov/image/SPACE/SPACE~thumb.jpg", rel: "preview", render: "image" }] }] } } : html("Space exploration image")));
    const run = await prisma.automationRun.create({ data: { channelId: f.channel.id, idempotencyKey: f.key } });
    const processor = new CollectProcessor(prisma, { collect: (request) => source.collect(request) });
    const payload = (mode: "DISCOVER" | "RANK" | "SELECT") => ({ automation: { runId: run.id, stage: "COLLECT" }, collect: { ...f.request, language: "en", excludedKeywords: [], excludedTopics: [], mode } });
    await processor.process(payload("DISCOVER"));
    const stored = await prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } });
    const snapshot = JSON.stringify(stored.rawSnapshot);
    for (const referenceField of ['"kind":"IMAGE_PREVIEW"', '"downloadable":"UNKNOWN"', '"commercialUse":"UNKNOWN"', '"rights":"ITEM_REVIEW_REQUIRED"', "https://images-assets.nasa.gov/image/SPACE/SPACE~thumb.jpg"]) expect(snapshot).toContain(referenceField);
    await prisma.contentIdea.update({ where: { id: stored.id }, data: { rawSnapshot: { body: "Space original description", reliability: { contentScope: "SUMMARY" }, visualReferences: { references: [{ href: "https://images-assets.nasa.gov/image/SPACE/SPACE~thumb.jpg", rel: "preview", render: "image" }], rights: "ITEM_REVIEW_REQUIRED" } } } });
    expect(await processor.process(payload("RANK"))).toMatchObject({ ranked: 1 });
    const result = await processor.process(payload("SELECT")); const idea = await prisma.contentIdea.findFirstOrThrow({ where: { channelId: f.channel.id } });
    expect(result.idea).toMatchObject({ id: idea.id });
    expect(idea.rawSnapshot).toMatchObject({ visualReferences: { rights: "ITEM_REVIEW_REQUIRED" } });
    expect(await prisma.assetLicense.count({ where: { asset: { channelId: f.channel.id } } })).toBe(0);
  });
  it("persists distinct question searches, scoped evidence, rechecks and stable candidate identities", async () => {
    const f = await fixture("HISTORY"); f.profile.language = "ko"; f.profile.production.requireVisualEvidence = false; f.profile.audience = "중학생"; f.profile.exclusions = ["제외 주제"]; f.profile.storyStyles = ["원인 설명"];
    await prisma.collectionRule.create({ data: { channelId: f.channel.id, profile: f.profile, keywords: ["history"], recencyHours: 24, collectionFrequencyMinutes: 360 } });
    const questions = await Promise.all(["로마는 왜 멸망했는가?", "이집트인은 왜 피라미드를 만들었는가?"].map((question, index) => prisma.researchQuestion.create({ data: { channelId: f.channel.id, idempotencyKey: `${f.key}:${index}`, question, subtopic: "history", origin: index ? "EDITORIAL" : "AUDIENCE" } })));
    const queries: string[] = []; let conflict = false;
    const source = new SourceCollection(prisma, f.channel.id, f.profile, "", async (kind, raw) => {
      await Promise.resolve();
      const url = new URL(raw); const q = url.searchParams.get("q") ?? "";
      if (kind === "LOC") { queries.push(q); return { results: [{ id: q.includes("피라미드") ? "https://www.loc.gov/item/egypt" : "https://www.loc.gov/item/rome", title: "history original record", description: ["history record"] }] }; }
      return html(url.pathname.includes("egypt") ? "이집트인은 파라오의 무덤을 위해 피라미드를 만들었다." : `로마는 내부 문제 때문에 멸망했다.${conflict ? " 이 주장에는 반증과 상충 자료가 있다." : ""}`);
    });
    const run = await prisma.automationRun.create({ data: { channelId: f.channel.id, idempotencyKey: f.key } });
    let context: unknown;
    const processor = new CollectProcessor(prisma, { collect: (request) => { context = request.researchContext; return source.collect(request); } });
    const payload = { automation: { runId: run.id, stage: "COLLECT" }, collect: { ...f.request, mode: "DISCOVER", language: "ko", excludedKeywords: [], excludedTopics: [] } };
    await processor.process(payload);
    expect(queries).toEqual(expect.arrayContaining(questions.map((question) => question.question)));
    expect(context).toMatchObject({ language: "ko", audience: "중학생", exclusions: ["제외 주제"], storyStyles: ["원인 설명"] });
    for (const question of questions) {
      const stored = await prisma.researchQuestion.findUniqueOrThrow({ where: { id: question.id } });
      expect(stored).toMatchObject({ status: "CLAIM_REVIEW_REQUIRED", evidence: { claimsVerified: false, state: "ANSWER_EVIDENCE_AVAILABLE", query: question.question } });
      expect(JSON.stringify(stored.evidence)).toContain(question.question.includes("피라미드") ? "/egypt" : "/rome");
    }
    const count = await prisma.contentIdea.count({ where: { channelId: f.channel.id } });
    await processor.process(payload); expect(await prisma.contentIdea.count({ where: { channelId: f.channel.id } })).toBe(count);
    conflict = true;
    await prisma.researchQuestion.update({ where: { id: questions[0]!.id }, data: { status: "INVESTIGATE", reason: "MANUAL_RECHECK_REQUESTED" } });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 61 * 60000));
    try { await processor.process(payload); } finally { vi.useRealTimers(); }
    expect(await prisma.researchQuestion.findUniqueOrThrow({ where: { id: questions[0]!.id } })).toMatchObject({ status: "CONFLICTING_EVIDENCE", evidence: { claimsVerified: false } });
  });
  it("backfills missing YouTube links only from question-specific independent records and keeps unrelated discoveries held", async () => {
    const f = await fixture("HISTORY"); f.profile.production.requireVisualEvidence = false; f.profile.sources.youtubeQueries = ["history"];
    const queries: string[] = [];
    const source = new SourceCollection(prisma, f.channel.id, f.profile, "", async (kind, raw) => {
      await Promise.resolve();
      const url = new URL(raw); const q = url.searchParams.get("q") ?? "";
      if (kind === "LOC") { queries.push(q); return { results: q.includes("Roman") ? [{ id: "https://www.loc.gov/item/roman-fall", title: "Why the Roman empire fell", description: ["Roman empire fell because political and economic pressures weakened its institutions."] }] : [] }; }
      if (kind === "YOUTUBE" && url.pathname.endsWith("/search")) return { items: [{ id: { videoId: "abcdefghijk" } }, { id: { videoId: "12345678901" } }] };
      if (kind === "YOUTUBE") return { items: [{ id: "abcdefghijk", snippet: { title: "Why the Roman empire fell", description: "A history investigation" } }, { id: "12345678901", snippet: { title: "Why Egyptian pyramids were built", description: "A history investigation" } }] };
      return html("Roman empire fell because political and economic pressures weakened its institutions");
    });
    const result = await source.collect(f.request);
    expect(queries.some((query) => query.includes("Roman"))).toBe(true);
    expect(result.candidates.some((candidate) => candidate.url === "https://www.loc.gov/item/roman-fall" && candidate.reliabilityMetadata?.discoveryUrl === "https://www.youtube.com/watch?v=abcdefghijk" && candidate.reliabilityMetadata?.role === "EVIDENCE")).toBe(true);
    expect(result.candidates.find((candidate) => candidate.url.includes("12345678901"))?.reliabilityMetadata?.role).toBe("DISCOVERY");
  });
  it("continues enrichment after two discoveries resolve to the same record and reports absent independent connectors", async () => {
    const f = await fixture("HISTORY"); f.profile.production.requireVisualEvidence = false; f.profile.limits.targetCandidates = 2; f.profile.sources.youtubeQueries = ["history"];
    const source = new SourceCollection(prisma, f.channel.id, f.profile, "", (kind, raw) => {
      const url = new URL(raw); const q = url.searchParams.get("q") ?? "";
      if (kind === "LOC") return Promise.resolve({ results: q.includes("Roman") || q.includes("Egyptian") ? [{ id: `https://www.loc.gov/item/${q.includes("Roman") ? "rome" : "egypt"}`, title: q, description: [q] }] : [] });
      const titles = ["Why Roman empire fell", "Why Roman empire fell?", "Why Egyptian pyramids were built"];
      if (kind === "YOUTUBE" && url.pathname.endsWith("/search")) return Promise.resolve({ items: titles.map((_, i) => ({ id: { videoId: `video00000${i}` } })) });
      if (kind === "YOUTUBE") return Promise.resolve({ items: titles.map((title, i) => ({ id: `video00000${i}`, snippet: { title, description: "No links" } })) });
      return Promise.resolve(html(url.pathname.includes("rome") ? "Roman empire fell because internal institutions weakened." : "Egyptian pyramids were built because royal burials required monumental tombs."));
    });
    const result = await source.collect(f.request);
    expect(result.diagnostics).toMatchObject({ selected: 2, mergedAfterEnrichment: 1 });
    expect(result.candidates.filter((candidate) => candidate.reliabilityMetadata?.role === "EVIDENCE").map((candidate) => candidate.url).sort()).toEqual(["https://www.loc.gov/item/egypt", "https://www.loc.gov/item/rome"]);
    const unconfigured = await fixture("HISTORY"); unconfigured.profile.sources.collections = []; unconfigured.profile.sources.youtubeQueries = ["history"]; unconfigured.profile.production.requireVisualEvidence = false; unconfigured.profile.sources.evidenceHosts = ["youtube.com"];
    const read = vi.fn((kind: string, raw: string) => Promise.resolve(kind === "YOUTUBE" && new URL(raw).pathname.endsWith("/search") ? { items: [{ id: { videoId: "abcdefghijk" } }] } : { items: [{ id: "abcdefghijk", snippet: { title: "Why Roman empire fell", description: "https://www.youtube.com/watch?v=other123456" } }] }));
    const missing = await new SourceCollection(prisma, unconfigured.channel.id, unconfigured.profile, "", read).collect(unconfigured.request);
    expect(read.mock.calls.some(([kind]) => kind === "HTML")).toBe(false);
    expect(missing.candidates[0]?.reliabilityMetadata).toMatchObject({ role: "DISCOVERY", researchState: "INDEPENDENT_SEARCH_NOT_CONFIGURED", collectionEvaluation: { selectedForTarget: false } });
  });
});
