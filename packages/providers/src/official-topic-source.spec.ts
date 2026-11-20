import { collectionProfilePreset } from "@postbot/contracts";
import { describe, expect, it, vi } from "vitest";
import { OfficialTopicSourceProvider } from "./official-topic-source.js";
import { RssTopicSourceProvider } from "./index.js";
const request = { channelId: "channel", topic: "history", keywords: ["history"], allowedSources: [], excludedSources: [], recencyHours: 24, idempotencyKey: "source" };
describe("official discovery source contracts", () => {
  it("gives another source a first page before one query consumes its later pages", async () => {
    const profile = collectionProfilePreset("HISTORY", "en"); profile.subtopics = ["history"]; profile.sources.youtubeQueries = ["history"]; profile.limits.pagesPerSource = 5;
    const day = Math.floor(Date.now() / 86400000); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date((day % 2 ? day : day + 1) * 86400000));
    let calls = 0;
    try {
      const result = await new OfficialTopicSourceProvider(profile, (source, raw) => Promise.resolve().then(() => {
        if (++calls > 3) throw new Error("SOURCE_DAILY_CALL_BUDGET_EXHAUSTED");
        if (source === "LOC") return { results: [{ id: "https://www.loc.gov/item/history", title: "history record", description: ["history"] }] };
        return new URL(raw).pathname.endsWith("/search") ? { items: [{ id: { videoId: "abcdefghijk" } }], nextPageToken: "next" } : { items: [{ id: "abcdefghijk", snippet: { title: "history discovery" } }] };
      })).collect(request);
      expect(result.candidates.some((candidate) => candidate.sourceName === "LOC")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("does not call excluded connectors and reports an entirely unconfigured allowed search", async () => {
    const profile = collectionProfilePreset("SCIENCE", "en"); profile.sources.collections = ["LOC", "NASA"]; profile.limits.pagesPerSource = 1;
    const read = vi.fn(() => Promise.resolve({ collection: { items: [] } }));
    await new OfficialTopicSourceProvider(profile, read).collect({ ...request, excludedSources: ["loc.gov"] });
    expect(read.mock.calls).toHaveLength(2);
    const none = await new OfficialTopicSourceProvider(profile, read).collect({ ...request, allowedSources: ["example.org"] });
    expect(none.failures).toEqual([{ source: "PROFILE", code: "NO_ALLOWED_DISCOVERY_SOURCE_CONFIGURED" }]);
  });
  it("preserves LoC after 25 YouTube results and searches each full question", async () => {
    const profile = collectionProfilePreset("HISTORY", "ko"); profile.subtopics = ["history"]; profile.sources.youtubeQueries = ["history"]; profile.limits.pagesPerSource = 1;
    const read = vi.fn((source: string, raw: string) => {
      const url = new URL(raw);
      if (source === "LOC") return Promise.resolve({ results: [{ id: "https://www.loc.gov/item/rome", title: "Roman history", description: ["Roman history original record"], image_url: ["https://www.loc.gov/rome.jpg"] }] });
      if (url.pathname.endsWith("/search")) return Promise.resolve({ items: Array.from({ length: 25 }, (_, index) => ({ id: { videoId: `video${String(index).padStart(6, "0")}` } })) });
      return Promise.resolve({ items: Array.from({ length: 25 }, (_, index) => ({ id: `video${String(index).padStart(6, "0")}`, snippet: { title: `History ${index}`, description: "Discovery only" } })) });
    });
    const researchQuestions = [{ id: "rome", question: "로마는 왜 멸망했는가?", subtopic: "history", origin: "AUDIENCE", status: "INVESTIGATE" }, { id: "egypt", question: "이집트인은 왜 피라미드를 만들었는가?", subtopic: "history", origin: "EDITORIAL", status: "INVESTIGATE" }];
    const result = await new OfficialTopicSourceProvider(profile, read).collect({ ...request, researchQuestions });
    expect(result.candidates.some((candidate) => candidate.sourceName === "LOC")).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(20);
    const queries = read.mock.calls.filter(([source]) => source === "LOC").map(([, url]) => new URL(url).searchParams.get("q"));
    expect(queries).toContain(researchQuestions[0]!.question); expect(queries).toContain(researchQuestions[1]!.question);
    const youtubeQueries = read.mock.calls.filter(([source, raw]) => source === "YOUTUBE" && new URL(raw).pathname.endsWith("/search")).map(([, raw]) => new URL(raw).searchParams.get("q"));
    expect(youtubeQueries).toEqual(expect.arrayContaining(researchQuestions.map((question) => question.question)));
  });
  it("uses uploads playlists separately from search and never equates public metadata with evidence", async () => {
    const profile = collectionProfilePreset("HISTORY", "ko"); profile.sources.collections = []; profile.sources.youtubeQueries = ["history"]; profile.sources.youtubeChannelIds = ["UCabcdefghijklmnopqrstuv"];
    const read = vi.fn((_source: string, raw: string) => Promise.resolve().then(() => {
      const url = new URL(raw);
      if (url.pathname.endsWith("/channels")) return { items: [{ contentDetails: { relatedPlaylists: { uploads: "uploads-id" } } }] };
      if (url.pathname.endsWith("/playlistItems")) return { items: [{ contentDetails: { videoId: "abcdefghijk" } }] };
      if (url.pathname.endsWith("/search")) return { items: [{ id: { videoId: "abcdefghijk" } }] };
      return { items: [{ id: "abcdefghijk", snippet: { title: "History question", description: "Public description", publishedAt: "2026-01-01T00:00:00Z" }, contentDetails: { duration: "PT30S" }, statistics: { viewCount: "100" } }] };
    }));
    const result = await new OfficialTopicSourceProvider(profile, read).collect(request);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ body: "", reliabilityMetadata: { role: "DISCOVERY", contentScope: "UNKNOWN", shortsClassification: "UNKNOWN", audienceDemographics: null, mediaReuseAllowed: false } });
    const urls = read.mock.calls.map((call) => new URL(call[1]));
    expect(urls.find((url) => url.pathname.endsWith("/playlistItems"))?.searchParams.get("playlistId")).toBe("uploads-id");
    expect(urls.find((url) => url.pathname.endsWith("/search"))?.searchParams.get("publishedAfter")).toBeNull();
    expect(urls.some((url) => /caption|download/i.test(url.href))).toBe(false);
  });
  it("isolates API quota failure and keeps collection rights item-specific", async () => {
    const profile = collectionProfilePreset("SCIENCE", "en"); profile.subtopics = ["space"]; profile.sources.collections = ["LOC", "NASA"]; profile.sources.youtubeQueries = ["space"];
    const read = vi.fn((source: string) => Promise.resolve().then(() => {
      if (source === "YOUTUBE") throw new Error("quotaExceeded");
      if (source === "LOC") return { results: [] };
      return { collection: { items: [{ data: [{ title: "Space image", nasa_id: "ID", description: "NASA image metadata", date_created: "2020-01-01T00:00:00Z" }] }] } };
    }));
    const result = await new OfficialTopicSourceProvider(profile, read).collect(request);
    expect(result.candidates[0]?.reliabilityMetadata).toMatchObject({ contentScope: "SUMMARY", media: { rights: "ITEM_REVIEW_REQUIRED" } });
  });
  it("does not drop old evergreen RSS before selection", async () => {
    const provider = new RssTopicSourceProvider({ feedUrls: ["https://archive.test/rss"], readDocument: () => Promise.resolve('<rss><channel><item><title>history artifact</title><link>https://archive.test/item</link><description>history</description><pubDate>Thu, 01 Jan 2015 00:00:00 GMT</pubDate></item></channel></rss>') });
    expect((await provider.collect({ ...request, freshness: "EVERGREEN" })).candidates).toHaveLength(1);
    expect((await provider.collect({ ...request, freshness: "NEWS" })).candidates).toHaveLength(0);
  });
});
