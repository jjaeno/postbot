import { normalizeMediaReferences, type ChannelCollectionProfile } from "@postbot/contracts";
import type { TopicSourceCandidate, TopicSourceProvider, TopicSourceRequest, TopicSourceResult } from "./index.js";
import { fairCandidatePool, processingLimit, researchQuery } from "./research.js";
import { topicSourceAllowed } from "./topic-scoring.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const date = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export type DiscoveryRead = (source: "YOUTUBE" | "LOC" | "NASA", url: string) => Promise<unknown>;

// Public metadata discovers research topics; it never supplies verified facts,
// private audience metrics, video files, audio or third-party captions.
export class OfficialTopicSourceProvider implements TopicSourceProvider {
  constructor(private readonly profile: ChannelCollectionProfile, private readonly read: DiscoveryRead) {}
  async collect(request: TopicSourceRequest): Promise<TopicSourceResult> {
    const candidates: TopicSourceCandidate[] = []; const failures: Array<{ source: string; code: string }> = [];
    for await (const batch of this.batches(request)) { candidates.push(...batch.candidates); failures.push(...batch.failures); }
    return { provider: "official-topic-source", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), failures, candidates: fairCandidatePool(candidates, processingLimit(this.profile)) };
  }
  async *batches(request: TopicSourceRequest, extra: Array<{ source: string; query: string; run: () => Promise<TopicSourceCandidate[]> }> = []): AsyncGenerator<{ source: string; query: string; candidates: TopicSourceCandidate[]; failures: Array<{ source: string; code: string }> }> {
    const groups: Array<{ source: string; tasks: Array<{ query: string; run: () => Promise<TopicSourceCandidate[]> }> }> = [];
    const turns = (entries: Array<{ query: string; pages: AsyncGenerator<TopicSourceCandidate[]> }>) => Array.from({ length: this.profile.limits.pagesPerSource }, () => entries.map(({ query, pages }) => ({ query, run: async () => { const page = await pages.next(); return page.done ? [] : page.value; } }))).flat();
    const queries = [...new Set([...(request.researchQuestions ?? []).slice(0, 5).map(researchQuery), ...this.profile.subtopics])];
    for (const source of [...this.profile.sources.collections].sort()) groups.push({ source, tasks: turns(queries.map((query) => ({ query, pages: this.collection(source, query) }))) });
    const youtubeQueries = this.profile.sources.youtubeQueries.length ? [...new Set([...(request.researchQuestions ?? []).slice(0, 5).map(researchQuery), ...this.profile.sources.youtubeQueries])] : [];
    groups.push({ source: "YOUTUBE", tasks: turns([...youtubeQueries.map((query) => ({ query, pages: this.youtubeSearch(query, request) })), ...this.profile.sources.youtubeChannelIds.map((query) => ({ query, pages: this.youtubeUploads(query) }))]) });
    for (const task of extra) { if (!topicSourceAllowed(task.query, task.source, request, true)) continue; let group = groups.find((group) => group.source === task.source); if (!group) { group = { source: task.source, tasks: [] }; groups.push(group); } group.tasks.push(task); }
    const roots: Record<string, string> = { YOUTUBE: "https://www.youtube.com/", LOC: "https://www.loc.gov/", NASA: "https://images.nasa.gov/" };
    const active = groups.filter((group) => group.tasks.length && (group.source === "RSS" || topicSourceAllowed(roots[group.source] ?? "", group.source, request, true))); const offset = active.length ? Math.floor(Date.now() / 86400000) % active.length : 0;
    const ordered = [...active.slice(offset), ...active.slice(0, offset)];
    if (!ordered.length) { yield { source: "PROFILE", query: "", candidates: [], failures: [{ source: "PROFILE", code: "NO_ALLOWED_DISCOVERY_SOURCE_CONFIGURED" }] }; return; }
    let attempts = 0;
    while (ordered.some((group) => group.tasks.length) && attempts < Math.min(120, processingLimit(this.profile))) for (const group of ordered) {
      if (attempts >= Math.min(120, processingLimit(this.profile))) break;
      const task = group.tasks.shift(); if (!task) continue; attempts++;
      try {
        const found = await task.run();
        const researchRequests = (request.researchQuestions ?? []).filter((question) => researchQuery(question) === task.query).map((question) => ({ questionId: question.id, question: question.question, subtopic: question.subtopic, origin: question.origin, status: question.status, query: task.query }));
        yield { source: group.source, query: task.query, candidates: found.map((candidate) => ({ ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, sourceFamily: group.source, searchQuery: task.query, researchRequests: [...list(candidate.reliabilityMetadata?.researchRequests), ...researchRequests], researchContext: request.researchContext ?? null } })), failures: [] };
      } catch (error) {
        const code = error instanceof Error && ["SOURCE_DAILY_CALL_BUDGET_EXHAUSTED", "YOUTUBE_DISCOVERY_KEY_UNSET", "SOURCE_REQUEST_PENDING_OR_FAILED"].includes(error.message) ? error.message : "DISCOVERY_SOURCE_UNAVAILABLE";
        yield { source: group.source, query: task.query, candidates: [], failures: [{ source: `${group.source}:${task.query}`, code }] };
      }
    }
  }
  private url(path: string, params: Record<string, string>) { const url = new URL(path); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); return url.href; }
  private async *youtubeSearch(query: string, request: TopicSourceRequest): AsyncGenerator<TopicSourceCandidate[]> {
    let page = "";
    for (let i = 0; i < this.profile.limits.pagesPerSource; i++) {
      const ids: string[] = [];
      const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/search", {
        part: "snippet", type: "video", q: query, maxResults: "25", relevanceLanguage: this.profile.language.split("-")[0]!,
        ...(this.profile.region ? { regionCode: this.profile.region } : {}),
        ...(this.profile.freshness === "NEWS" ? { publishedAfter: new Date(Date.now() - request.recencyHours * 3600000).toISOString().slice(0, 13) + ":00:00Z" } : {}),
        ...(page ? { pageToken: page } : {}) })));
      for (const item of list(response.items).slice(0, 25)) { const id = text(object(object(item).id).videoId); if (/^[\w-]{11}$/.test(id)) ids.push(id); }
      yield await this.videos(ids, "KEYWORD_SEARCH");
      page = text(response.nextPageToken); if (!page) break;
    }
  }
  private async *youtubeUploads(channel: string): AsyncGenerator<TopicSourceCandidate[]> {
    const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/channels", { part: "contentDetails", id: channel })));
    const playlist = text(object(object(object(list(response.items)[0]).contentDetails).relatedPlaylists).uploads);
    if (!playlist) return;
    let page = "";
    for (let i = 0; i < this.profile.limits.pagesPerSource; i++) {
      const ids: string[] = [];
      const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: "25", ...(page ? { pageToken: page } : {}) })));
      for (const item of list(response.items).slice(0, 25)) { const id = text(object(object(item).contentDetails).videoId); if (/^[\w-]{11}$/.test(id)) ids.push(id); }
      yield await this.videos(ids, "UPLOADS_PLAYLIST");
      page = text(response.nextPageToken); if (!page) break;
    }
  }
  private async videos(ids: string[], discovery: string) {
    const results: TopicSourceCandidate[] = [];
    for (let start = 0; start < ids.length; start += 50) {
      const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/videos", { part: "snippet,contentDetails,statistics", id: ids.slice(start, start + 50).join(",") })));
      for (const raw of list(response.items).slice(0, 50)) {
        const item = object(raw); const snippet = object(item.snippet); const id = text(item.id); const title = text(snippet.title).slice(0, 255);
        if (!/^[\w-]{11}$/.test(id) || !title) continue;
        results.push({ title, summary: text(snippet.description).slice(0, 2000), body: "", url: `https://www.youtube.com/watch?v=${id}`, sourceName: "YouTube", sourceKind: "PUBLIC_DATA", publishedAt: date(snippet.publishedAt), reliabilityScore: 0,
          reliabilityMetadata: { role: "DISCOVERY", contentScope: "UNKNOWN", discovery, publicStatistics: object(item.statistics), duration: text(object(item.contentDetails).duration), shortsClassification: "UNKNOWN",
            searchLanguage: this.profile.language, searchRegion: this.profile.region, audienceDemographics: null, mediaReuseAllowed: false } });
      }
    }
    return results;
  }
  private async *collection(source: "LOC" | "NASA", query: string): AsyncGenerator<TopicSourceCandidate[]> {
    for (let page = 1; page <= this.profile.limits.pagesPerSource; page++) {
      const candidates: TopicSourceCandidate[] = [];
      const response = object(await this.read(source, source === "LOC"
        ? this.url("https://www.loc.gov/search/", { fo: "json", q: query, c: "25", sp: String(page) })
        : this.url("https://images-api.nasa.gov/search", { q: query, media_type: "image", page: String(page), page_size: "25" })));
      const items = list(source === "LOC" ? response.results : object(response.collection).items).slice(0, 25); if (!items.length) break;
      for (const raw of items) {
        const item = object(raw); const data = source === "LOC" ? item : object(list(item.data)[0]); const title = text(data.title).slice(0, 255);
        const url = source === "LOC" ? text(item.id) : `https://images.nasa.gov/details/${encodeURIComponent(text(data.nasa_id))}`;
        if (!title || !url.startsWith("https://")) continue;
        const summary = source === "LOC" ? list(item.description).map(text).join(" ") : text(data.description);
        candidates.push({ title, summary: summary.slice(0, 2000), body: summary.slice(0, 10000), url, sourceName: source, sourceKind: "OFFICIAL", publishedAt: date(source === "LOC" ? item.date : data.date_created), reliabilityScore: 0.8,
          reliabilityMetadata: { role: "TOPIC_DISCOVERY", contentScope: "SUMMARY", untrustedExternalData: true,
            subtopic: query, persons: source === "LOC" ? list(item.subject).map(text).filter((subject) => /\d{4}\s*-\s*\d{0,4}/.test(subject)) : [],
            media: { references: normalizeMediaReferences([...(source === "LOC" ? list(item.image_url) : list(item.links)), { url, kind: "DETAIL_PAGE" }, ...(source === "NASA" && text(item.href) ? [{ url: text(item.href), kind: "API_RESPONSE" }] : [])]), rights: "ITEM_REVIEW_REQUIRED", proofUrl: url },
            evidence: [], question: `What explains ${title}?`, angle: "Investigate the original record" } });
      }
      yield candidates;
    }
  }
}
