import { describe, expect, it } from "vitest";
import { scoreTopicCandidate } from "./topic-scoring.js";
import type { TopicSourceCandidate } from "./index.js";

const now = Date.parse("2026-10-21T00:00:00Z");
const candidate: TopicSourceCandidate = { title: "rocket history", summary: "Historical research", body: "The event occurred in 1789.", url: "https://example.com/research/item/?utm_source=feed", sourceName: "Research", sourceKind: "OFFICIAL", publishedAt: new Date(now).toISOString(), eventAt: "1789-01-01T00:00:00Z", reliabilityScore: 0.8 };
const settings = { keywords: ["rocket"], excludedKeywords: [], excludedTopics: [], allowedSources: ["https://example.com/research"], excludedSources: [], recencyHours: 72 };
describe("shared manual/automatic topic scoring", () => {
  it("uses publication freshness separately from the historical event date", () => {
    const fresh = scoreTopicCandidate(candidate, settings, now);
    const old = scoreTopicCandidate({ ...candidate, publishedAt: "2026-10-01T00:00:00Z" }, settings, now);
    expect(fresh.freshnessScore).toBe(1); expect(old.freshnessScore).toBe(0);
    expect(fresh.eventAt).toBe("1789-01-01T00:00:00Z");
    expect(fresh.expectedValueScore).toBeGreaterThan(old.expectedValueScore);
  });
  it("normalizes tracking URLs and honors URL-prefix source allowlists", () => {
    const first = scoreTopicCandidate(candidate, settings, now);
    const second = scoreTopicCandidate({ ...candidate, url: "https://example.com/research/item#fragment" }, settings, now);
    expect(first.urlHash).toBe(second.urlHash); expect(first.rejectionReason).toBeNull();
    expect(scoreTopicCandidate({ ...candidate, url: "https://example.com.evil.test/research/item" }, settings, now).rejectionReason).toBe("SOURCE_NOT_ALLOWED");
  });
  it("applies exclusions and keyword suitability consistently", () => {
    expect(scoreTopicCandidate(candidate, { ...settings, excludedKeywords: ["HISTORY"] }, now).rejectionReason).toContain("Blocked term");
    expect(scoreTopicCandidate(candidate, settings, now).suitabilityScore).toBe(1);
    expect(scoreTopicCandidate(candidate, { ...settings, keywords: ["ocean"] }, now).suitabilityScore).toBe(0);
  });
});
