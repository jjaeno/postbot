import { collectionProfilePreset } from "@postbot/contracts";
import { describe, expect, it, vi } from "vitest";
import { OfficialTopicSourceProvider } from "./official-topic-source.js";
import { RssTopicSourceProvider } from "./index.js";
const request = { channelId: "channel", topic: "history", keywords: ["history"], allowedSources: [], excludedSources: [], recencyHours: 24, idempotencyKey: "source" };
describe("official discovery source contracts", () => {
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
