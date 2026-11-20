import { hasHttpsVisualReference, type ChannelCollectionProfile } from "@postbot/contracts";
import { assertExecutionOwner, Prisma, type PrismaClient } from "@postbot/database";
import { createHash } from "node:crypto";
import { assessResearch, canonicalizeTopicUrl, fairCandidatePool, processingLimit, researchQuery, scoreTopicCandidate, topicSourceAllowed, OfficialTopicSourceProvider, RssTopicSourceProvider, SafeExternalReader, type TopicSourceCandidate, type TopicSourceRequest, type TopicSourceResult } from "@postbot/providers";
const values = (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [];
const discoveryOnlyHost = (hostname: string): boolean => ["youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com"].some((host) => hostname === host || hostname.endsWith(`.${host}`));

export class SourceCollection {
  private freshSuccessfulFetches = 0;
  private attemptedFetches = 0;
  private cachedReads = 0;
  constructor(private readonly prisma: PrismaClient, private readonly channelId: string, private readonly profile: ChannelCollectionProfile,
    private readonly youtubeApiKey: string, private readonly reader?: (source: string, url: string) => Promise<unknown>) {}

  async read(source: string, url: string): Promise<unknown> {
    const now = new Date(); const cacheMs = this.profile.limits.cacheMinutes * 60000;
    const requestKey = createHash("sha256").update(`${source}:${url}:${Math.floor(now.getTime() / cacheMs)}`).digest("hex");
    const lease = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${this.channelId} FOR UPDATE`;
      const existing = await tx.sourceFetch.findUnique({ where: { channelId_requestKey: { channelId: this.channelId, requestKey } } });
      if (existing) return { cached: true, row: existing };
      const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
      const calls = await tx.sourceFetch.count({ where: { channelId: this.channelId, startedAt: { gte: day } } });
      if (calls >= this.profile.limits.dailyCalls) throw new Error("SOURCE_DAILY_CALL_BUDGET_EXHAUSTED");
      return { cached: false, row: await tx.sourceFetch.create({ data: { channelId: this.channelId, requestKey, source, state: "PENDING", expiresAt: new Date(now.getTime() + cacheMs) } }) };
    });
    if (lease.cached) { if (lease.row.state !== "READY") throw new Error("SOURCE_REQUEST_PENDING_OR_FAILED"); this.cachedReads++; return lease.row.response; }
    try {
      if (source === "YOUTUBE" && !this.youtubeApiKey && !this.reader) throw new Error("YOUTUBE_DISCOVERY_KEY_UNSET");
      this.attemptedFetches++;
      const hosts = source === "YOUTUBE" ? ["www.googleapis.com"] : source === "LOC" ? ["loc.gov"] : source === "NASA" ? ["images-api.nasa.gov"] : source === "RSS" ? this.profile.sources.rssUrls.map((url) => new URL(url).hostname) : this.profile.sources.evidenceHosts;
      const result: unknown = this.reader ? await this.reader(source, url) : await new SafeExternalReader({ hosts,
        ...(source === "YOUTUBE" ? { headers: { "x-goog-api-key": this.youtubeApiKey } } : {}) }).read(url).then((document) => source === "HTML" || source === "RSS" ? document : JSON.parse(document.text) as unknown);
      const json = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await this.prisma.sourceFetch.update({ where: { id: lease.row.id }, data: { state: "READY", response: json, completedAt: new Date() } });
      this.freshSuccessfulFetches++;
      return result;
    } catch (error) { await this.prisma.sourceFetch.update({ where: { id: lease.row.id }, data: { state: "FAILED" } }); throw error; }
  }

  async collect(request: TopicSourceRequest): Promise<TopicSourceResult> {
    this.freshSuccessfulFetches = 0; this.attemptedFetches = 0; this.cachedReads = 0;
    // Expire API bodies independently from daily-call receipts. Keep receipts
    // through the budget window so cache deletion cannot grant more calls.
    const now = new Date();
    await this.prisma.sourceFetch.updateMany({ where: { channelId: this.channelId, expiresAt: { lte: now }, state: "READY" }, data: { response: Prisma.DbNull, state: "EXPIRED" } });
    await this.prisma.sourceFetch.deleteMany({ where: { channelId: this.channelId, startedAt: { lt: new Date(now.getTime() - 2 * 86400000) } } });
    const official = new OfficialTopicSourceProvider(this.profile, (source, url) => this.read(source, url));
    const rss = (feedUrl: string) => new RssTopicSourceProvider({ feedUrls: [feedUrl],
      readDocument: async (url) => {
        const result = await this.read("RSS", url);
        return typeof result === "object" && result && "text" in result && typeof result.text === "string" ? result.text : "";
      } });
    // Bounded source/query turns rotate by UTC day; low budgets cannot always favor one family.
    const candidates: TopicSourceCandidate[] = []; const failures: Array<{ source: string; code: string }> = [];
    const rssTasks = [...this.profile.sources.rssUrls].sort().map((feed) => ({ source: "RSS", query: feed, run: async () => {
      const result = await rss(feed).collect(request);
      if (result.failures?.length && !result.candidates.length) throw new Error("RSS_SOURCE_UNAVAILABLE");
      return result.candidates.map((candidate) => ({ ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, feedUrl: feed, researchRequests: (request.researchQuestions ?? []).map((question) => ({ questionId: question.id, query: researchQuery(question), method: "LOCAL_FEED_FILTER", requestUrl: feed })) } }));
    } }));
    const families = new Set([...this.profile.sources.collections, ...(this.profile.sources.youtubeQueries.length || this.profile.sources.youtubeChannelIds.length ? ["YOUTUBE"] : []), ...(rssTasks.length ? ["RSS"] : [])]);
    const seen = new Set<string>(); const investigated = new Set<string>();
    for await (const batch of official.batches(request, rssTasks)) {
      candidates.push(...batch.candidates); failures.push(...batch.failures); seen.add(batch.source);
      for (const question of request.researchQuestions ?? []) if (researchQuery(question) === batch.query) investigated.add(question.id);
      if (candidates.length >= processingLimit(this.profile) && seen.size >= families.size && (request.researchQuestions ?? []).every((question) => investigated.has(question.id))) break;
    }
    const pool = fairCandidatePool(candidates, processingLimit(this.profile));
    const enriched: TopicSourceCandidate[] = []; const diagnostics: Record<string, { collected: number; processed: number; enriched: number; passed: number; selected: number; rejected: number }> = {};
    for (const candidate of candidates) { const source = candidate.sourceKind === "RSS" ? "RSS" : candidate.sourceName; (diagnostics[source] ??= { collected: 0, processed: 0, enriched: 0, passed: 0, selected: 0, rejected: 0 }).collected++; }
    const passed = new Set<string>();
    for (const original of pool) {
      const source = original.sourceKind === "RSS" ? "RSS" : original.sourceName; const stats = diagnostics[source]!; stats.processed++;
      let candidate = original;
      if (passed.size < this.profile.limits.targetCandidates) try {
        candidate = original.reliabilityMetadata?.role === "DISCOVERY" ? await this.researchDiscovery(original, request) : await this.enrich(original, request);
        if (candidate.reliabilityMetadata?.contentScope === "FULL_TEXT") stats.enriched++;
      } catch (error) {
        candidate = { ...original, reliabilityMetadata: { ...original.reliabilityMetadata, evidenceFailure: error instanceof Error && error.message === "SOURCE_DAILY_CALL_BUDGET_EXHAUSTED" ? error.message : "ORIGINAL_UNAVAILABLE" } };
        failures.push({ source, code: String(candidate.reliabilityMetadata?.evidenceFailure) });
      }
      for (const failure of values(candidate.reliabilityMetadata?.researchFailures)) if (failure && typeof failure === "object" && "source" in failure && "code" in failure && typeof failure.source === "string" && typeof failure.code === "string") failures.push({ source: failure.source, code: failure.code });
      const score = scoreTopicCandidate(candidate, { ...request, excludedKeywords: [...this.profile.exclusions, ...(request.researchContext?.exclusions ?? [])], excludedTopics: [], selectionPolicy: { freshness: this.profile.freshness } });
      const reason = score.rejectionReason ?? (this.profile.production.requireVisualEvidence && !hasHttpsVisualReference({ reliability: candidate.reliabilityMetadata }) ? "VISUAL_REFERENCE_REQUIRED" : null);
      if (!reason) { stats.passed++; passed.add(canonicalizeTopicUrl(candidate.url)); } else stats.rejected++;
      enriched.push({ ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, collectionEvaluation: { reason: reason ?? "ELIGIBLE", score: score.expectedValueScore, sourceFamily: source, selectedForTarget: false } } });
    }
    const deduplicated = fairCandidatePool(enriched, processingLimit(this.profile));
    const selected = deduplicated.filter((candidate) => (candidate.reliabilityMetadata?.collectionEvaluation as { reason: string }).reason === "ELIGIBLE").sort((a, b) => Number((b.reliabilityMetadata?.collectionEvaluation as { score: number }).score) - Number((a.reliabilityMetadata?.collectionEvaluation as { score: number }).score) || a.url.localeCompare(b.url)).slice(0, this.profile.limits.targetCandidates);
    const selectedUrls = new Set(selected.map((candidate) => candidate.url));
    const final = deduplicated.map((candidate) => {
      const selectedForTarget = selectedUrls.has(candidate.url); const evaluation = candidate.reliabilityMetadata?.collectionEvaluation as Record<string, unknown>;
      if (selectedForTarget) diagnostics[String(evaluation.sourceFamily)]!.selected++;
      return { ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, collectionEvaluation: { ...evaluation, selectedForTarget, finalReason: selectedForTarget ? "BEST_ELIGIBLE_AFTER_EVIDENCE_AND_FIT" : evaluation.reason === "ELIGIBLE" ? "FINAL_TARGET_CAP" : evaluation.reason } } };
    });
    return { provider: "channel-profile-sources", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), candidates: final, failures,
      research: (request.researchQuestions ?? []).map((question) => assessResearch(question, final, request.researchContext)),
      diagnostics: { processingLimit: processingLimit(this.profile), finalTarget: this.profile.limits.targetCandidates, deduplicatedProcessed: pool.length, mergedAfterEnrichment: enriched.length - deduplicated.length, sources: diagnostics, attemptedFetches: this.attemptedFetches, freshSuccessfulFetches: this.freshSuccessfulFetches, cachedReads: this.cachedReads, selected: selected.length } };
  }

  private async researchDiscovery(candidate: TopicSourceCandidate, request: TopicSourceRequest): Promise<TopicSourceCandidate> {
    const question = { id: `discovery:${createHash("sha256").update(candidate.url).digest("hex")}`, question: candidate.title, subtopic: this.profile.subtopics[0] ?? "", origin: "AI_HYPOTHESIS", status: "INVESTIGATE" };
    const researchRequests = [...values(candidate.reliabilityMetadata?.researchRequests), { questionId: question.id, question: question.question, query: researchQuery(question) }];
    let linked = candidate;
    try { linked = await this.enrich({ ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, researchRequests } }, request); } catch { /* A failed linked page must not suppress configured independent search. */ }
    const linkedOutcome = assessResearch(question, [linked], request.researchContext);
    if (linked.reliabilityMetadata?.contentScope === "FULL_TEXT" && linkedOutcome.state === "ANSWER_EVIDENCE_AVAILABLE") return { ...linked, reliabilityMetadata: { ...linked.reliabilityMetadata, claimEvidence: linkedOutcome.sources, claimVerification: "REQUIRED" } };
    if (!this.profile.sources.collections.length) return { ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, researchState: "INDEPENDENT_SEARCH_NOT_CONFIGURED" } };
    const profile = { ...this.profile, subtopics: [], sources: { ...this.profile.sources, youtubeQueries: [], youtubeChannelIds: [], rssUrls: [] } };
    const result = await new OfficialTopicSourceProvider(profile, (source, url) => this.read(source, url)).collect({ ...request, researchQuestions: [question] });
    for (const record of result.candidates.slice(0, 3)) {
      let original: TopicSourceCandidate;
      try { original = await this.enrich({ ...record, reliabilityMetadata: { ...record.reliabilityMetadata, researchRequests: [...values(record.reliabilityMetadata?.researchRequests), ...researchRequests] } }, request); } catch { continue; }
      const outcome = assessResearch(question, [original], request.researchContext);
      if (outcome.state !== "ANSWER_EVIDENCE_AVAILABLE") continue;
      return { ...original, reliabilityMetadata: { ...original.reliabilityMetadata, discoveryUrl: candidate.url, discoveryRole: "TOPIC_DISCOVERY_ONLY", role: "EVIDENCE", claimEvidence: outcome.sources, claimVerification: "REQUIRED", independentResearchQuestion: question } };
    }
    return { ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, researchState: result.failures?.some((failure) => failure.code === "SOURCE_DAILY_CALL_BUDGET_EXHAUSTED") ? "SOURCE_DAILY_CALL_BUDGET_EXHAUSTED" : "INSUFFICIENT_INDEPENDENT_EVIDENCE", researchFailures: result.failures ?? [] } };
  }

  private async enrich(candidate: TopicSourceCandidate, request?: TopicSourceRequest): Promise<TopicSourceCandidate> {
    const urls = candidate.reliabilityMetadata?.role === "DISCOVERY" ? candidate.summary.match(/https:\/\/[^\s<>"']+/g) ?? [] : [candidate.url];
    const allowed = urls.find((raw) => { try { const url = new URL(raw); const name = url.hostname === "loc.gov" || url.hostname.endsWith(".loc.gov") ? "LOC" : url.hostname === "nasa.gov" || url.hostname.endsWith(".nasa.gov") ? "NASA" : url.hostname; return !discoveryOnlyHost(url.hostname) && (!request || topicSourceAllowed(raw, name, request)) && this.profile.sources.evidenceHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; } });
    if (!allowed) return candidate;
    const raw = await this.read("HTML", allowed);
    if (!raw || typeof raw !== "object" || !("text" in raw) || typeof raw.text !== "string") throw new Error("ORIGINAL_EXTRACTION_FAILED");
    const html = raw.text.replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    const match = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
    const body = match?.[2]?.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!body || body.length < 100 || body.length > 10000) throw new Error("ORIGINAL_EXTRACTION_INCOMPLETE");
    const collectedAt = "collectedAt" in raw && typeof raw.collectedAt === "string" ? raw.collectedAt : new Date().toISOString();
    const originalUrl = "url" in raw && typeof raw.url === "string" ? raw.url : allowed;
    const originalHost = new URL(originalUrl).hostname;
    const originalName = originalHost === "loc.gov" || originalHost.endsWith(".loc.gov") ? "LOC" : originalHost === "nasa.gov" || originalHost.endsWith(".nasa.gov") ? "NASA" : originalHost;
    if (discoveryOnlyHost(originalHost) || request && !topicSourceAllowed(originalUrl, originalName, request) || !this.profile.sources.evidenceHosts.some((host) => originalHost === host || originalHost.endsWith(`.${host}`))) throw new Error("ORIGINAL_SOURCE_NOT_ALLOWED");
    const title = /<(?:h1|title)\b[^>]*>([\s\S]*?)<\/(?:h1|title)>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ").trim();
    if (candidate.reliabilityMetadata?.role === "DISCOVERY" && !title) throw new Error("ORIGINAL_TITLE_UNAVAILABLE");
    const discovery = candidate.reliabilityMetadata?.role === "DISCOVERY";
    const metadata = discovery ? { researchRequests: candidate.reliabilityMetadata?.researchRequests ?? [], discovery: { url: candidate.url, publishedAt: candidate.publishedAt, publicStatistics: candidate.reliabilityMetadata?.publicStatistics ?? null, role: "TOPIC_DISCOVERY_ONLY", mediaReuseAllowed: false } } : candidate.reliabilityMetadata;
    return { ...candidate, title: title?.slice(0, 255) ?? candidate.title, sourceName: discovery ? new URL(originalUrl).hostname : candidate.sourceName, sourceKind: discovery ? "PUBLIC_DATA" : candidate.sourceKind, publishedAt: discovery ? null : candidate.publishedAt, summary: body.slice(0, 2000), url: originalUrl, body, reliabilityScore: 0.8, reliabilityMetadata: { ...metadata,
      role: "EVIDENCE", contentScope: "FULL_TEXT", untrustedExternalData: true, discoveryUrl: candidate.url, collectedAt,
      fingerprint: createHash("sha256").update(body).digest("hex"),
      evidence: [{ url: originalUrl, start: 0, end: body.length, scope: "FULL_TEXT", independence: "SINGLE_SOURCE" }], mediaRights: "REVIEW_REQUIRED" } };
  }
}
