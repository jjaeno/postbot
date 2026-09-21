import { describe, expect, it } from "vitest";
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
