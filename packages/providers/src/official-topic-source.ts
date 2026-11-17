import type { ChannelCollectionProfile } from "@postbot/contracts";
import type { TopicSourceCandidate, TopicSourceProvider, TopicSourceRequest, TopicSourceResult } from "./index.js";

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
    const tasks: Array<Promise<TopicSourceCandidate[]>> = [];
    for (const query of this.profile.sources.youtubeQueries) tasks.push(this.youtubeSearch(query, request));
    for (const channel of this.profile.sources.youtubeChannelIds) tasks.push(this.youtubeUploads(channel));
    for (const source of this.profile.sources.collections) for (const query of this.profile.subtopics) tasks.push(this.collection(source, query));
    const settled = await Promise.allSettled(tasks);
    return { provider: "official-topic-source", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(),
      failures: settled.flatMap((result, index) => result.status === "rejected" ? [{ source: `configured-source-${index}`, code: "DISCOVERY_SOURCE_UNAVAILABLE" }] : []),
      candidates: [...new Map(settled.flatMap((result) => result.status === "fulfilled" ? result.value : []).map((candidate) => [candidate.url, candidate])).values()].slice(0, this.profile.limits.targetCandidates) };
  }
  private url(path: string, params: Record<string, string>) { const url = new URL(path); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); return url.href; }
  private async youtubeSearch(query: string, request: TopicSourceRequest) {
    const ids: string[] = []; let page = "";
    for (let i = 0; i < this.profile.limits.pagesPerSource; i++) {
      const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/search", {
        part: "snippet", type: "video", q: query, maxResults: "25", relevanceLanguage: this.profile.language.split("-")[0]!,
        ...(this.profile.region ? { regionCode: this.profile.region } : {}),
        ...(this.profile.freshness === "NEWS" ? { publishedAfter: new Date(Date.now() - request.recencyHours * 3600000).toISOString().slice(0, 13) + ":00:00Z" } : {}),
        ...(page ? { pageToken: page } : {}) })));
      for (const item of list(response.items)) { const id = text(object(object(item).id).videoId); if (/^[\w-]{11}$/.test(id)) ids.push(id); }
      page = text(response.nextPageToken); if (!page) break;
    }
    return this.videos(ids, "KEYWORD_SEARCH");
  }
  private async youtubeUploads(channel: string) {
    const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/channels", { part: "contentDetails", id: channel })));
    const playlist = text(object(object(object(list(response.items)[0]).contentDetails).relatedPlaylists).uploads);
    if (!playlist) return [];
    const ids: string[] = []; let page = "";
    for (let i = 0; i < this.profile.limits.pagesPerSource; i++) {
      const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: "25", ...(page ? { pageToken: page } : {}) })));
      for (const item of list(response.items)) { const id = text(object(object(item).contentDetails).videoId); if (/^[\w-]{11}$/.test(id)) ids.push(id); }
      page = text(response.nextPageToken); if (!page) break;
    }
    return this.videos(ids, "UPLOADS_PLAYLIST");
  }
  private async videos(ids: string[], discovery: string) {
    const results: TopicSourceCandidate[] = [];
    for (let start = 0; start < ids.length; start += 50) {
      const response = object(await this.read("YOUTUBE", this.url("https://www.googleapis.com/youtube/v3/videos", { part: "snippet,contentDetails,statistics", id: ids.slice(start, start + 50).join(",") })));
      for (const raw of list(response.items)) {
        const item = object(raw); const snippet = object(item.snippet); const id = text(item.id); const title = text(snippet.title).slice(0, 255);
        if (!/^[\w-]{11}$/.test(id) || !title) continue;
        results.push({ title, summary: text(snippet.description).slice(0, 2000), body: "", url: `https://www.youtube.com/watch?v=${id}`, sourceName: "YouTube", sourceKind: "PUBLIC_DATA", publishedAt: date(snippet.publishedAt), reliabilityScore: 0,
          reliabilityMetadata: { role: "DISCOVERY", contentScope: "UNKNOWN", discovery, publicStatistics: object(item.statistics), duration: text(object(item.contentDetails).duration), shortsClassification: "UNKNOWN",
            searchLanguage: this.profile.language, searchRegion: this.profile.region, audienceDemographics: null, mediaReuseAllowed: false } });
      }
    }
    return results;
  }
  private async collection(source: "LOC" | "NASA", query: string) {
    const candidates: TopicSourceCandidate[] = [];
    for (let page = 1; page <= this.profile.limits.pagesPerSource; page++) {
      const response = object(await this.read(source, source === "LOC"
        ? this.url("https://www.loc.gov/search/", { fo: "json", q: query, c: "25", sp: String(page) })
        : this.url("https://images-api.nasa.gov/search", { q: query, media_type: "image", page: String(page), page_size: "25" })));
      const items = list(source === "LOC" ? response.results : object(response.collection).items); if (!items.length) break;
      for (const raw of items) {
        const item = object(raw); const data = source === "LOC" ? item : object(list(item.data)[0]); const title = text(data.title).slice(0, 255);
        const url = source === "LOC" ? text(item.id) : `https://images.nasa.gov/details/${encodeURIComponent(text(data.nasa_id))}`;
        if (!title || !url.startsWith("https://")) continue;
        const summary = source === "LOC" ? list(item.description).map(text).join(" ") : text(data.description);
        candidates.push({ title, summary: summary.slice(0, 2000), body: summary.slice(0, 10000), url, sourceName: source, sourceKind: "OFFICIAL", publishedAt: date(source === "LOC" ? item.date : data.date_created), reliabilityScore: 0.8,
          reliabilityMetadata: { role: "TOPIC_DISCOVERY", contentScope: "SUMMARY", untrustedExternalData: true,
            subtopic: query, persons: source === "LOC" ? list(item.subject).map(text).filter((subject) => /\d{4}\s*-\s*\d{0,4}/.test(subject)) : [],
            media: { references: source === "LOC" ? list(item.image_url) : list(item.links), rights: "ITEM_REVIEW_REQUIRED", proofUrl: url },
            evidence: [], question: `What explains ${title}?`, angle: "Investigate the original record" } });
      }
    }
    return candidates;
  }
}
