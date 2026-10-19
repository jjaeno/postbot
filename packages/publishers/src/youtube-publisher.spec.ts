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
});

describe.each([["Instagram", new FakeInstagramPublisherProvider(), instagramPublishScope], ["TikTok", new FakeTikTokPublisherProvider(), tiktokPublishScope]] as const)("%s Fake Publisher", (_name, provider, scope) => {
  const input = { title: "Vertical short", description: "metadata", privacyStatus: "private" as const, publishAt: null, video: new Uint8Array([1]), idempotencyKey: "social-publish-key-123" };
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
