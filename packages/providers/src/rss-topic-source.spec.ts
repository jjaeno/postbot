import { describe, expect, it, vi } from "vitest";
import { RssTopicSourceProvider } from "./index.js";

const request = {
  channelId: "channel-1",
  topic: "space",
  keywords: ["rocket"],
  allowedSources: ["news.example"],
  excludedSources: [],
  recencyHours: 72,
  idempotencyKey: "rss-contract-1"
} as const;
const requestUrl = (input: URL | RequestInfo): string => typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

describe("RssTopicSourceProvider", () => {
  it("normalizes an allowlisted RSS item and removes stale entries", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Official Space News</title>
      <item><title>Rocket reaches orbit</title><link>https://news.example/rocket?utm_source=rss</link><description>Space rocket telemetry.</description><pubDate>Mon, 28 Sep 2026 12:00:00 GMT</pubDate></item>
      <item><title>Old rocket</title><link>https://news.example/old</link><description>Space archive.</description><pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(xml, { status: 200 }));
    const provider = new RssTopicSourceProvider({ feedUrls: ["https://news.example/feed.xml"], fetchImplementation, now: () => new Date("2026-09-29T00:00:00.000Z") });

    const result = await provider.collect(request);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ title: "Rocket reaches orbit", sourceKind: "RSS", reliabilityScore: 0.9 });
    expect(result.candidates[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("isolates a failing feed when another feed succeeds", async () => {
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      if (requestUrl(input).includes("failed")) return Promise.resolve(new Response("unavailable", { status: 503 }));
      return Promise.resolve(new Response("<feed><title>Agency</title><entry><title>Rocket update</title><link href=\"https://news.example/update\"/><summary>space rocket</summary><updated>2026-09-28T12:00:00Z</updated></entry></feed>", { status: 200 }));
    });
    const provider = new RssTopicSourceProvider({ feedUrls: ["https://failed.example/rss", "https://news.example/atom"], fetchImplementation, maxRetries: 0, now: () => new Date("2026-09-29T00:00:00.000Z") });

    await expect(provider.collect(request)).resolves.toMatchObject({ provider: "rss-topic-source", candidates: [{ title: "Rocket update" }] });
  });
});
