import { describe, expect, it, vi } from "vitest";
import { AmbiguousPublishError, GoogleYouTubePublisherProvider } from "./index.js";
import { FakeInstagramPublisherProvider, FakeTikTokPublisherProvider, FakeYouTubePublisherProvider, instagramPublishScope, tiktokPublishScope, youtubeUploadScope } from "./index.js";

describe("FakeYouTubePublisherProvider", () => {
  it("returns an idempotent scheduled upload result", async () => {
    const provider = new FakeYouTubePublisherProvider();
    const input = { title: "Short", description: "Description", privacyStatus: "private" as const, publishAt: "2026-10-01T00:00:00.000Z", video: new Uint8Array([1]), idempotencyKey: "publish-key-123456" };
    await expect(provider.upload(input)).resolves.toEqual(await provider.upload(input));
  });
  it("requests the upload scope and refreshes fake credentials", async () => {
    const provider = new FakeYouTubePublisherProvider();
    expect(provider.capabilities.requiredScopes).toContain(youtubeUploadScope);
    await expect(provider.refreshAccessToken?.("refresh-token")).resolves.toMatchObject({ accessToken: "fake-refreshed-access-token" });
  });
});

describe("YouTube upload safety", () => {
  const input = { title: "Short", description: "Test", privacyStatus: "private" as const, publishAt: null, video: new Uint8Array([1]), idempotencyKey: "youtube-contract" };
  it("holds ambiguous uploads after session creation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: "https://upload.example/session" } })).mockRejectedValueOnce(new TypeError("fetch failed"));
    const provider = new GoogleYouTubePublisherProvider("client", "secret", { fetchImplementation: request });
    await expect(provider.upload(input, "token")).rejects.toBeInstanceOf(AmbiguousPublishError);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects incompatible publishAt/privacy before starting an upload", async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new GoogleYouTubePublisherProvider("client", "secret", { fetchImplementation: request });
    await expect(provider.upload({ ...input, privacyStatus: "public", publishAt: "2099-01-01T00:00:00Z" }, "token")).rejects.toThrow("YOUTUBE_SCHEDULE_REQUIRES_FUTURE_PRIVATE_VIDEO");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    ["processing", { uploadStatus: "uploaded", privacyStatus: "public" }, { processingStatus: "processing" }],
    ["failed", { uploadStatus: "processed", privacyStatus: "public" }, { processingStatus: "failed", processingFailureReason: "transcodeFailed" }],
    ["scheduled", { uploadStatus: "processed", privacyStatus: "private", publishAt: "2099-01-01T00:00:00Z" }, { processingStatus: "succeeded" }],
    ["uploaded", { uploadStatus: "processed", privacyStatus: "private" }, { processingStatus: "succeeded" }],
    ["published", { uploadStatus: "processed", privacyStatus: "public" }, { processingStatus: "succeeded" }]
  ] as const)("maps native %s without treating upload time as public time", async (expected, status, processingDetails) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [{ id: "video-1", snippet: { channelId: "channel-1", publishedAt: "2026-11-01T01:02:03Z" }, status, processingDetails }] }));
    const provider = new GoogleYouTubePublisherProvider("fixture", "fixture", { fetchImplementation });
    expect(await provider.getPublicationStatus("video-1", "fixture", "channel-1")).toMatchObject({ status: expected, publishedAt: expected === "published" ? "2026-11-01T01:02:03Z" : null });
    const requested = fetchImplementation.mock.calls[0]?.[0];
    if (!(requested instanceof URL)) throw new Error("Expected a structured URL");
    expect(requested.searchParams.get("part")).toContain("processingDetails");
  });
  it("requires native owner identity when linking a recovered result", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [{ id: "video-1", snippet: { channelId: "foreign" }, status: { uploadStatus: "processed", privacyStatus: "public" } }] }));
    await expect(new GoogleYouTubePublisherProvider("fixture", "fixture", { fetchImplementation }).getPublicationStatus("video-1", "fixture", "owner")).rejects.toThrow("PUBLICATION_ACCOUNT_OR_ID_MISMATCH");
  });
});

describe.each([["Instagram", new FakeInstagramPublisherProvider(), instagramPublishScope], ["TikTok", new FakeTikTokPublisherProvider(), tiktokPublishScope]] as const)("%s Fake Publisher", (_name, provider, scope) => {
  const input = { title: "Vertical short", description: "metadata", privacyStatus: "public" as const, publishAt: null, video: new Uint8Array([1]), idempotencyKey: "social-publish-key-123" };
  it("validates, publishes idempotently, and exposes status", async () => {
    expect(provider.capabilities.requiredScopes).toContain(scope);
    const first = await provider.upload(input); const second = await provider.upload(input);
    expect(second).toEqual(first); await expect(provider.getPublicationStatus(first.externalVideoId, "token")).resolves.toMatchObject({ externalVideoId: first.externalVideoId });
  });
  it("rejects invalid video input and refreshes tokens independently", async () => {
    await expect(provider.validate({ ...input, video: new Uint8Array() })).rejects.toThrow("Invalid social video upload.");
    await expect(provider.refreshAccessToken?.("refresh")).resolves.toMatchObject({ refreshToken: "refresh" });
  });
});
