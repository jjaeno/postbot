import { describe, expect, it, vi } from "vitest";
import { completePostPublicationDay, FakeAnalyticsProvider, InstagramAnalyticsProvider, TikTokAnalyticsProvider, YouTubeAnalyticsProvider } from "./index.js";

describe("FakeAnalyticsProvider", () => {
  it("paginates posts and keeps unavailable distinct from zero", async () => {
    const provider = new FakeAnalyticsProvider();
    const first = await provider.fetchPage({ platform: "YOUTUBE", postIds: ["one", "two"], periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-01-02T00:00:00.000Z", pageToken: null });
    const second = await provider.fetchPage({ platform: "YOUTUBE", postIds: ["one", "two"], periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-01-02T00:00:00.000Z", pageToken: first.nextPageToken });
    expect(first.nextPageToken).toBe("1");
    expect(second.nextPageToken).toBeNull();
    expect(first.posts[0]?.metrics.find((metric) => metric.metric === "completion_rate")).toMatchObject({ value: null, unavailableReason: "NOT_PROVIDED_BY_PLATFORM" });
  });
});

const input = { platform: "YOUTUBE" as const, postIds: ["post-1"], periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-01-02T00:00:00.000Z", pageToken: null };

describe("platform analytics providers", () => {
  it("requests the full day after publication across the 25-hour DST day", async () => {
    const period = completePostPublicationDay(new Date("2026-10-31T19:00:00Z"), 1);
    expect(period.end.getTime() - period.start.getTime()).toBe(25 * 3600000);
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ columnHeaders: [{ name: "video" }, { name: "views" }], rows: [["post-1", 12]] }));
    const page = await new YouTubeAnalyticsProvider({ accessToken: "fixture", fetchImplementation }).fetchPage({ ...input, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() });
    const request = fetchImplementation.mock.calls[0]?.[0];
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request?.url ?? "https://invalid.test");
    expect(url.searchParams.get("startDate")).toBe("2026-11-01");
    expect(url.searchParams.get("endDate")).toBe("2026-11-01");
    expect(page.posts[0]?.observation).toMatchObject({ coverageVerified: true, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() });
  });
  it("normalizes YouTube Analytics without inventing unavailable metrics", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }], rows: [["post-1", 12, 4.5, 50]] }));
    const page = await new YouTubeAnalyticsProvider({ accessToken: "token", fetchImplementation }).fetchPage(input);
    expect(page.posts[0]?.observation).toEqual({ kind: "PERIOD_TOTAL", reportingTimezone: "America/Los_Angeles", coverageVerified: false, periodStart: "2025-12-31T08:00:00.000Z", periodEnd: "2026-01-02T08:00:00.000Z" });
    expect(page.posts[0]?.observedAt).not.toBe(input.periodEnd);
    expect(page.posts[0]?.metrics.find((metric) => metric.metric === "average_view_ratio")?.value).toBe(0.5);
    expect(page.posts[0]?.metrics.find((metric) => metric.metric === "completion_rate")?.value).toBeNull();
    expect(page.posts[0]?.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ metric: "views", value: 12 }), expect.objectContaining({ metric: "impressions", value: null })]));
  });

  it("normalizes Instagram and TikTok platform-specific engagement", async () => {
    const instagramFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ name: "views", values: [{ value: 20 }] }, { name: "reach", values: [{ value: 10 }] }, { name: "total_interactions", values: [{ value: 2 }] }] }));
    const instagram = await new InstagramAnalyticsProvider({ accessToken: "token", fetchImplementation: instagramFetch }).fetchPage({ ...input, platform: "INSTAGRAM" });
    expect(instagram.posts[0]?.metrics.find((metric) => metric.metric === "engagement_rate")?.value).toBe(0.2);
    expect(instagram.posts[0]?.metrics.find((metric) => metric.metric === "reach")?.value).toBe(10);
    expect(instagram.posts[0]?.metrics.find((metric) => metric.metric === "impressions")?.value).toBeNull();
    const tiktokFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { videos: [{ id: "post-1", view_count: 10, like_count: 1, comment_count: 1, share_count: 0 }] }, error: { code: "ok" } }));
    const tiktok = await new TikTokAnalyticsProvider({ accessToken: "token", fetchImplementation: tiktokFetch }).fetchPage({ ...input, platform: "TIKTOK" });
    expect(tiktok.posts[0]?.observation).toEqual({ kind: "LIFETIME_SNAPSHOT" });
    expect(tiktok.posts[0]?.metrics.find((metric) => metric.metric === "engagement_rate")?.value).toBe(0.2);
  });
});
