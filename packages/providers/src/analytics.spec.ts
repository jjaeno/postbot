import { describe, expect, it } from "vitest";
import { FakeAnalyticsProvider } from "./index.js";

describe("FakeAnalyticsProvider", () => {
  it("paginates posts and keeps unavailable distinct from zero", async () => {
    const provider = new FakeAnalyticsProvider();
    const first = await provider.fetchPage({ platform: "YOUTUBE", postIds: ["one", "two"], periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-01-02T00:00:00.000Z", pageToken: null });
    const second = await provider.fetchPage({ platform: "YOUTUBE", postIds: ["one", "two"], periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-01-02T00:00:00.000Z", pageToken: first.nextPageToken });
    expect(first.nextPageToken).toBe("next");
    expect(second.nextPageToken).toBeNull();
    expect(first.posts[0]?.metrics.find((metric) => metric.metric === "completion_rate")).toMatchObject({ value: null, unavailableReason: "NOT_PROVIDED_BY_PLATFORM" });
  });
});
