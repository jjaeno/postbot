import { describe, expect, it, vi } from "vitest";
import { instagramPublishScope, MetaInstagramPublisherProvider, TikTokPublisherProvider, tiktokPublishScope } from "./index.js";

const upload = { title: "Postbot", description: "AI generated explainer", privacyStatus: "private" as const, publishAt: null, video: new Uint8Array([0, 1, 2, 3]), idempotencyKey: "social-contract-1", externalAccountId: "account-1", aiGenerated: true };
const requestUrl = (input: URL | RequestInfo): string => typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

describe("MetaInstagramPublisherProvider", () => {
  it("rejects visibility settings the adapter cannot honor before sending HTTP", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = new MetaInstagramPublisherProvider({ clientId: "fixture", clientSecret: "fixture", fetchImplementation });
    await expect(provider.upload(upload, "fixture")).rejects.toThrow("INSTAGRAM_VISIBILITY_SETTING_UNSUPPORTED");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it("never invents granted permissions when the token response omits them", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "short" }))
      .mockResolvedValueOnce(Response.json({ access_token: "long", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ data: [{ permission: "instagram_business_basic", status: "granted" }, { permission: instagramPublishScope, status: "declined" }] }));
    const provider = new MetaInstagramPublisherProvider({ clientId: "client", clientSecret: "secret", fetchImplementation });
    const token = await provider.exchangeCode({ code: "code", codeVerifier: "verifier", redirectUri: "https://app.example/callback" });
    expect(token.scopes).toEqual(["instagram_business_basic"]);
    expect(provider.capabilities.requiredScopes).toContain("instagram_business_manage_insights");
  });
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
    await expect(provider.upload({ ...upload, privacyStatus: "public" }, "token")).resolves.toMatchObject({ externalVideoId: "media-1", status: "published" });
  });
});

describe("TikTokPublisherProvider", () => {
  it("holds Direct Post before any network call", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = new TikTokPublisherProvider({ clientId: "client", clientSecret: "secret", fetchImplementation });
    expect(provider.capabilities.requiredScopes).toContain("video.list");
    expect(provider.capabilities.requiredScopes).toContain(tiktokPublishScope);
    await expect(provider.upload(upload, "token")).rejects.toThrow("TIKTOK_DIRECT_POST_HELD");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
