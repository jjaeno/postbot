import { describe, expect, it } from "vitest";
import { FakeYouTubePublisherProvider, youtubeUploadScope } from "./index.js";

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
