import { describe, expect, it, vi } from "vitest";
import { instagramPublishScope, MetaInstagramPublisherProvider, TikTokPublisherProvider, tiktokPublishScope } from "./index.js";

const upload = { title: "Postbot", description: "AI generated explainer", privacyStatus: "private" as const, publishAt: null, video: new Uint8Array([0, 1, 2, 3]), idempotencyKey: "social-contract-1", externalAccountId: "account-1", aiGenerated: true };
const requestUrl = (input: URL | RequestInfo): string => typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

describe("MetaInstagramPublisherProvider", () => {
  it("uses Instagram Login scopes and the resumable Reels publish flow", async () => {
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/media")) return Promise.resolve(Response.json({ id: "container-1", uri: "https://rupload.facebook.com/container-1" }));
      if (url.includes("rupload.facebook.com")) return Promise.resolve(Response.json({ success: true }));
      if (url.includes("container-1?")) return Promise.resolve(Response.json({ status_code: "FINISHED" }));
      if (url.endsWith("/media_publish")) return Promise.resolve(Response.json({ id: "media-1" }));
      if (url.includes("/media-1?")) return Promise.resolve(Response.json({ id: "media-1", permalink: "https://www.instagram.com/reel/example", timestamp: "2026-09-29T00:00:00Z" }));
      throw new Error(`Unexpected request: ${url}`);
    });
    const provider = new MetaInstagramPublisherProvider({ clientId: "client", clientSecret: "secret", fetchImplementation, pollIntervalMs: 1 });
    const authorization = new URL(provider.createAuthorizationUrl({ state: "state", codeChallenge: "challenge", redirectUri: "https://app.example/callback", scopes: provider.capabilities.requiredScopes }));
    expect(authorization.hostname).toBe("www.instagram.com");
    expect(authorization.searchParams.get("scope")).toContain(instagramPublishScope);
    await expect(provider.upload(upload, "token")).resolves.toMatchObject({ externalVideoId: "media-1", status: "published" });
  });
});

describe("TikTokPublisherProvider", () => {
  it("uses Login Kit and Direct Post with status polling", async () => {
    const fetchImplementation = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      if (url.includes("creator_info")) return Promise.resolve(Response.json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }));
      if (url.includes("video/init")) return Promise.resolve(Response.json({ data: { publish_id: "publish-1", upload_url: "https://upload.tiktok.example/video" }, error: { code: "ok" } }));
      if (url.includes("upload.tiktok.example")) { expect(init?.headers).toMatchObject({ "content-range": "bytes 0-3/4" }); return Promise.resolve(new Response(null, { status: 201 })); }
      if (url.includes("status/fetch")) return Promise.resolve(Response.json({ data: { status: "PUBLISH_COMPLETE", publicly_available_post_id: ["video-1"] }, error: { code: "ok" } }));
      throw new Error(`Unexpected request: ${url}`);
    });
    const provider = new TikTokPublisherProvider({ clientId: "client", clientSecret: "secret", fetchImplementation, pollIntervalMs: 1 });
    const authorization = new URL(provider.createAuthorizationUrl({ state: "state", codeChallenge: "challenge", redirectUri: "https://app.example/callback", scopes: provider.capabilities.requiredScopes }));
    expect(authorization.pathname).toBe("/v2/auth/authorize/");
    expect(authorization.searchParams.get("scope")).toContain(tiktokPublishScope);
    await expect(provider.upload(upload, "token")).resolves.toMatchObject({ externalVideoId: "video-1", status: "published" });
  });
});
