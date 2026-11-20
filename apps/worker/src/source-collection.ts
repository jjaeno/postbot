import { hasHttpsVisualReference, type ChannelCollectionProfile } from "@postbot/contracts";
import { assertExecutionOwner, Prisma, type PrismaClient } from "@postbot/database";
import { createHash } from "node:crypto";
import { QuestionInvestigation, questionIds } from "./question-investigation.js";
import { assessResearch, canonicalizeTopicUrl, fairCandidatePool, processingLimit, researchQuery, scoreTopicCandidate, topicSourceAllowed, OfficialTopicSourceProvider, RssTopicSourceProvider, SafeExternalReader, type TopicSourceCandidate, type TopicSourceRequest, type TopicSourceResult } from "@postbot/providers";
const values = (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [];
const discoveryOnlyHost = (hostname: string): boolean => ["youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com"].some((host) => hostname === host || hostname.endsWith(`.${host}`));

export class SourceCollection {
  private freshSuccessfulFetches = 0;
  private attemptedFetches = 0;
  private cachedReads = 0;
  private activeQuestionIds: string[] = [];
  private questionCalls = new Map<string, number>();
  private questionCallLimit = 0;
  private discoveryCallLimit = Infinity;
  private discoveryPhase = false;
  private productionCallLimit = Infinity;
  private productionCalls = 0;
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
      if (this.discoveryPhase && this.attemptedFetches >= this.discoveryCallLimit) throw new Error("RESEARCH_BUDGET_RESERVED");
      if (this.activeQuestionIds.some((id) => (this.questionCalls.get(id) ?? 0) >= this.questionCallLimit)) throw new Error("QUESTION_RESEARCH_CALL_LIMIT_REACHED");
      if (!this.discoveryPhase && !this.activeQuestionIds.length && this.productionCalls >= this.productionCallLimit) throw new Error("RESEARCH_BUDGET_RESERVED");
      return { cached: false, row: await tx.sourceFetch.create({ data: { channelId: this.channelId, requestKey, source, state: "PENDING", startedAt: now, expiresAt: new Date(now.getTime() + cacheMs) } }) };
    });
    if (lease.cached) { if (lease.row.state !== "READY") throw new Error("SOURCE_REQUEST_PENDING_OR_FAILED"); this.cachedReads++; return lease.row.response; }
    for (const id of this.activeQuestionIds) this.questionCalls.set(id, (this.questionCalls.get(id) ?? 0) + 1);
    if (!this.discoveryPhase && !this.activeQuestionIds.length) this.productionCalls++;
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
    this.questionCalls.clear(); this.activeQuestionIds = []; this.productionCalls = 0;
    // Expire API bodies independently from daily-call receipts. Keep receipts
    // through the budget window so cache deletion cannot grant more calls.
    const now = new Date();
    await this.prisma.sourceFetch.updateMany({ where: { channelId: this.channelId, expiresAt: { lte: now }, state: "READY" }, data: { response: Prisma.DbNull, state: "EXPIRED" } });
    await this.prisma.sourceFetch.deleteMany({ where: { channelId: this.channelId, startedAt: { lt: new Date(now.getTime() - 2 * 86400000) } } });
    const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
    const questions = [...(request.researchQuestions ?? [])].slice(0, 5); const offset = questions.length ? Math.floor(now.getTime() / 86400000) % questions.length : 0;
    request = { ...request, researchQuestions: [...questions.slice(offset), ...questions.slice(0, offset)] };
    const questionCount = questions.length;
    const remaining = Math.max(0, this.profile.limits.dailyCalls - await this.prisma.sourceFetch.count({ where: { channelId: this.channelId, startedAt: { gte: day } } }));
    const investigation = new QuestionInvestigation(request, this.profile);
    const selectedQuestions = request.researchQuestions!.slice(0, remaining ? Math.max(1, Math.floor(remaining / 2)) : questionCount);
    const selectedQuestionIds = new Set(selectedQuestions.map((question) => question.id));
    const resumed = selectedQuestions.flatMap((question) => investigation.resume(question.id));
    const searchQuestions = selectedQuestions.filter((question) => investigation.resume(question.id).length === 0);
    const discoveryRequest = { ...request, researchQuestions: searchQuestions };
    const searchedIds = new Set<string>();
    this.discoveryCallLimit = questionCount ? Math.max(0, remaining - Math.min(selectedQuestions.length, Math.floor(remaining / 2))) : Infinity; this.discoveryPhase = true;
    const official = new OfficialTopicSourceProvider(this.profile, (source, url) => this.read(source, url));
    const rss = (feedUrl: string) => new RssTopicSourceProvider({ feedUrls: [feedUrl],
      readDocument: async (url) => {
        const result = await this.read("RSS", url);
        return typeof result === "object" && result && "text" in result && typeof result.text === "string" ? result.text : "";
      } });
    // Bounded source/query turns rotate by UTC day; low budgets cannot always favor one family.
    const candidates: TopicSourceCandidate[] = [...resumed]; const failures: Array<{ source: string; code: string }> = [];
    const rssTasks = [...this.profile.sources.rssUrls].sort().map((feed) => ({ source: "RSS", query: feed, run: async () => {
      const result = await rss(feed).collect(discoveryRequest);
      if (result.failures?.length && !result.candidates.length) throw new Error("RSS_SOURCE_UNAVAILABLE");
      return result.candidates.map((candidate) => ({ ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, feedUrl: feed, researchRequests: searchQuestions.map((question) => ({ questionId: question.id, query: researchQuery(question), method: "LOCAL_FEED_FILTER", requestUrl: feed })) } }));
    } }));
    const families = new Set([...this.profile.sources.collections, ...(this.profile.sources.youtubeQueries.length || this.profile.sources.youtubeChannelIds.length ? ["YOUTUBE"] : []), ...(rssTasks.length ? ["RSS"] : [])]);
    const seen = new Set<string>(); const investigated = new Set<string>();
    let processingStopped = false;
    if (!resumed.length || searchQuestions.length) for await (const batch of official.batches(discoveryRequest, rssTasks)) {
      candidates.push(...batch.candidates); failures.push(...batch.failures); seen.add(batch.source);
      for (const question of searchQuestions) if (researchQuery(question) === batch.query || batch.source === "RSS") { investigated.add(question.id); searchedIds.add(question.id); }
      const pendingCount = questionCount ? candidates.filter((candidate) => investigation.pending(candidate)).length : candidates.length;
      if (pendingCount >= processingLimit(this.profile) && seen.size >= families.size && searchQuestions.every((question) => investigated.has(question.id))) { processingStopped = true; break; }
    }
    this.discoveryPhase = false;
    const available = Math.max(0, this.profile.limits.dailyCalls - await this.prisma.sourceFetch.count({ where: { channelId: this.channelId, startedAt: { gte: day } } }));
    this.questionCallLimit = questionCount ? Math.min(3, Math.max(1, Math.floor(available / Math.max(1, selectedQuestions.length)))) : 0;
    this.productionCallLimit = questionCount ? Math.max(0, available - selectedQuestions.length) : Infinity;
    const pool = investigation.pool(candidates, processingLimit(this.profile));
    const enriched: TopicSourceCandidate[] = []; const diagnostics: Record<string, { collected: number; processed: number; enriched: number; passed: number; selected: number; rejected: number }> = {};
    for (const candidate of candidates) { const source = candidate.sourceKind === "RSS" ? "RSS" : candidate.sourceName; (diagnostics[source] ??= { collected: 0, processed: 0, enriched: 0, passed: 0, selected: 0, rejected: 0 }).collected++; }
    const passed = new Set<string>();
    for (const original of pool) {
      const source = original.sourceKind === "RSS" ? "RSS" : original.sourceName; const stats = diagnostics[source]!; stats.processed++;
      let candidate = original;
      const researchIds = investigation.claim(original, selectedQuestionIds); this.activeQuestionIds = researchIds;
      if (researchIds.length || !questionIds(original).length && passed.size < this.profile.limits.targetCandidates) try {
        candidate = original.reliabilityMetadata?.role === "DISCOVERY" ? await this.researchDiscovery(original, request) : await this.enrich(original, request);
        if (candidate.reliabilityMetadata?.contentScope === "FULL_TEXT") stats.enriched++;
      } catch (error) {
        candidate = { ...original, reliabilityMetadata: { ...original.reliabilityMetadata, evidenceFailure: error instanceof Error && ["SOURCE_DAILY_CALL_BUDGET_EXHAUSTED", "QUESTION_RESEARCH_CALL_LIMIT_REACHED", "RESEARCH_BUDGET_RESERVED", "SOURCE_REQUEST_PENDING_OR_FAILED"].includes(error.message) ? error.message : "ORIGINAL_UNAVAILABLE" } };
        failures.push({ source, code: String(candidate.reliabilityMetadata?.evidenceFailure) });
      }
      investigation.record(original, candidate, researchIds); this.activeQuestionIds = [];
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
    const research = investigation.outcomes(final, failures, processingStopped, selectedQuestionIds, searchedIds);
    return { provider: "channel-profile-sources", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), candidates: final, failures, research,
      diagnostics: { stopReasons: [...new Set([selected.length >= this.profile.limits.targetCandidates ? "PRODUCTION_TARGET_REACHED" : "PRODUCTION_TARGET_NOT_REACHED", ...(research.length ? [research.every((outcome) => outcome.investigation?.state === "COMPLETE") ? "QUESTION_RESEARCH_COMPLETE" : "QUESTION_RESEARCH_INCOMPLETE"] : []), ...(processingStopped ? ["PROCESSING_LIMIT_REACHED"] : []), ...failures.filter((failure) => ["SOURCE_DAILY_CALL_BUDGET_EXHAUSTED", "QUESTION_RESEARCH_CALL_LIMIT_REACHED", "RESEARCH_BUDGET_RESERVED"].includes(failure.code)).map((failure) => failure.code)])], processingLimit: processingLimit(this.profile), finalTarget: this.profile.limits.targetCandidates, deduplicatedProcessed: pool.length, mergedAfterEnrichment: enriched.length - deduplicated.length, sources: diagnostics, attemptedFetches: this.attemptedFetches, freshSuccessfulFetches: this.freshSuccessfulFetches, cachedReads: this.cachedReads, selected: selected.length } };
  }

  private async researchDiscovery(candidate: TopicSourceCandidate, request: TopicSourceRequest): Promise<TopicSourceCandidate> {
    const question = { id: `discovery:${createHash("sha256").update(candidate.url).digest("hex")}`, question: candidate.title, subtopic: this.profile.subtopics[0] ?? "", origin: "AI_HYPOTHESIS", status: "INVESTIGATE" };
    const researchRequests = [...values(candidate.reliabilityMetadata?.researchRequests), { questionId: question.id, question: question.question, query: researchQuery(question) }];
    let linked = candidate; const researchFailures: Array<{ source: string; code: string }> = [];
    const failureCode = (error: unknown) => error instanceof Error && ["SOURCE_DAILY_CALL_BUDGET_EXHAUSTED", "QUESTION_RESEARCH_CALL_LIMIT_REACHED", "SOURCE_REQUEST_PENDING_OR_FAILED"].includes(error.message) ? error.message : "ORIGINAL_UNAVAILABLE";
    try { linked = await this.enrich({ ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, researchRequests } }, request); } catch (error) { researchFailures.push({ source: candidate.sourceName, code: failureCode(error) }); }
    const linkedOutcome = assessResearch(question, [linked], request.researchContext);
    if (linked.reliabilityMetadata?.contentScope === "FULL_TEXT" && linkedOutcome.state === "ANSWER_EVIDENCE_AVAILABLE") return { ...linked, reliabilityMetadata: { ...linked.reliabilityMetadata, claimEvidence: linkedOutcome.sources, claimVerification: "REQUIRED" } };
    if (!this.profile.sources.collections.length) return { ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, researchState: researchFailures[0]?.code ?? "INDEPENDENT_SEARCH_NOT_CONFIGURED", researchFailures } };
    const profile = { ...this.profile, subtopics: [], sources: { ...this.profile.sources, youtubeQueries: [], youtubeChannelIds: [], rssUrls: [] } };
    const result = await new OfficialTopicSourceProvider(profile, (source, url) => this.read(source, url)).collect({ ...request, researchQuestions: [question] });
    for (const record of result.candidates.slice(0, 3)) {
      let original: TopicSourceCandidate;
      try { original = await this.enrich({ ...record, reliabilityMetadata: { ...record.reliabilityMetadata, researchRequests: [...values(record.reliabilityMetadata?.researchRequests), ...researchRequests] } }, request); } catch (error) { researchFailures.push({ source: record.sourceName, code: failureCode(error) }); continue; }
      const outcome = assessResearch(question, [original], request.researchContext);
      if (outcome.state !== "ANSWER_EVIDENCE_AVAILABLE") continue;
      return { ...original, reliabilityMetadata: { ...original.reliabilityMetadata, discoveryUrl: candidate.url, discoveryRole: "TOPIC_DISCOVERY_ONLY", role: "EVIDENCE", claimEvidence: outcome.sources, claimVerification: "REQUIRED", independentResearchQuestion: question } };
    }
    const allFailures = [...(result.failures ?? []), ...researchFailures];
    return { ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, researchState: allFailures[0]?.code ?? "INSUFFICIENT_INDEPENDENT_EVIDENCE", researchFailures: allFailures } };
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
      role: "EVIDENCE", contentScope: "FULL_TEXT", evidenceFailure: null, researchFailures: [], researchState: null, untrustedExternalData: true, discoveryUrl: candidate.url, collectedAt,
      fingerprint: createHash("sha256").update(body).digest("hex"),
      evidence: [{ url: originalUrl, start: 0, end: body.length, scope: "FULL_TEXT", independence: "SINGLE_SOURCE" }], mediaRights: "REVIEW_REQUIRED" } };
  }
}
