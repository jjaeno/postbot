import { createDecipheriv, createHash } from "node:crypto";
export type SupportedPlatform = "youtube" | "instagram" | "tiktok";

export type OAuthStartInput = {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
};

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

export type PublisherAccountProfile = {
  externalAccountId: string;
  handle: string | null;
  displayName: string | null;
};

export type OAuthProviderCapabilities = {
  provider: "fake" | "google";
  platform: SupportedPlatform;
  requiredScopes: string[];
};

export type PublisherProvider = {
  capabilities: OAuthProviderCapabilities;
  createAuthorizationUrl(input: OAuthStartInput): string;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokenSet>;
  getAccountProfile(accessToken: string): Promise<PublisherAccountProfile>;
  revoke?(refreshToken: string | null, accessToken: string): Promise<void>;
  refreshAccessToken?(refreshToken: string): Promise<OAuthTokenSet>;
};

export const youtubeReadonlyScope = "https://www.googleapis.com/auth/youtube.readonly";
export const youtubeUploadScope = "https://www.googleapis.com/auth/youtube.upload";

export type VideoUploadInput = { title: string; description: string; privacyStatus: "public" | "unlisted" | "private"; publishAt: string | null; video: Uint8Array; idempotencyKey: string };
export type PublishedVideo = { externalVideoId: string; url: string; publishedAt: string | null; status: "uploaded" | "scheduled" | "published" };
export interface VideoPublisher { upload(input: VideoUploadInput, accessToken: string): Promise<PublishedVideo>; }
export const decryptOAuthToken = (cipherText: string, cipher: string, encryptionKey: string): string => {
  if (cipher !== "aes-256-gcm") throw new Error("Unsupported OAuth token cipher.");
  const [iv, tag, encrypted] = cipherText.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted OAuth token payload.");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(encryptionKey).digest(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
};

export class OAuthScopeError extends Error {
  constructor(message = "OAuth scope is insufficient.") {
    super(message);
    this.name = "OAuthScopeError";
  }
}

export const assertRequiredScopes = (grantedScopes: string[], requiredScopes: string[]): void => {
  const granted = new Set(grantedScopes);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new OAuthScopeError("Required OAuth scope was not granted.");
  }
};

export class FakeYouTubePublisherProvider implements PublisherProvider, VideoPublisher {
  readonly capabilities: OAuthProviderCapabilities = {
    provider: "fake",
    platform: "youtube",
    requiredScopes: [youtubeReadonlyScope, youtubeUploadScope]
  };

  createAuthorizationUrl(input: OAuthStartInput): string {
    const url = new URL(input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code", "fake-youtube-code");
    return url.toString();
  }

  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokenSet> {
    if (!input.code || !input.codeVerifier || !input.redirectUri) {
      throw new Error("Invalid fake OAuth callback.");
    }
    return Promise.resolve({
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: [youtubeReadonlyScope, youtubeUploadScope]
    });
  }

  getAccountProfile(): Promise<PublisherAccountProfile> {
    return Promise.resolve({
      externalAccountId: "fake-youtube-channel",
      handle: "@postbot-fake",
      displayName: "Postbot Fake YouTube"
    });
  }

  async revoke(): Promise<void> {
    return Promise.resolve();
  }
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    if (!refreshToken) return Promise.reject(new Error("Missing refresh token."));
    return Promise.resolve({ accessToken: "fake-refreshed-access-token", refreshToken, expiresAt: new Date(Date.now() + 60 * 60 * 1000), scopes: [youtubeReadonlyScope, youtubeUploadScope] });
  }
  upload(input: VideoUploadInput): Promise<PublishedVideo> {
    const externalVideoId = `fake-${input.idempotencyKey.slice(0, 24)}`;
    return Promise.resolve({ externalVideoId, url: `https://www.youtube.com/watch?v=${externalVideoId}`, publishedAt: input.publishAt, status: input.publishAt ? "scheduled" : "published" });
  }
}

export class GoogleYouTubePublisherProvider implements PublisherProvider, VideoPublisher {
  readonly capabilities: OAuthProviderCapabilities = {
    provider: "google",
    platform: "youtube",
    requiredScopes: [youtubeReadonlyScope, youtubeUploadScope]
  };

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  createAuthorizationUrl(input: OAuthStartInput): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", input.scopes.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokenSet> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri
      })
    });
    if (!response.ok) {
      throw new Error("Google OAuth token exchange failed.");
    }
    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!body.access_token) {
      throw new Error("Google OAuth response did not include an access token.");
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
      scopes: body.scope ? body.scope.split(" ") : []
    };
  }

  async getAccountProfile(accessToken: string): Promise<PublisherAccountProfile> {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("mine", "true");
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error("YouTube channel lookup failed.");
    }
    const body = (await response.json()) as {
      items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
    };
    const item = body.items?.[0];
    if (!item?.id) {
      throw new Error("No YouTube channel was found for this account.");
    }
    return {
      externalAccountId: item.id,
      handle: item.snippet?.customUrl ?? null,
      displayName: item.snippet?.title ?? null
    };
  }

  async revoke(refreshToken: string | null, accessToken: string): Promise<void> {
    const token = refreshToken ?? accessToken;
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token })
    });
  }
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
    if (!response.ok) throw new Error("Google OAuth token refresh failed.");
    const body = await response.json() as { access_token?: string; expires_in?: number; scope?: string };
    if (!body.access_token) throw new Error("Google token refresh did not include an access token.");
    return { accessToken: body.access_token, refreshToken, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null, scopes: body.scope ? body.scope.split(" ") : [youtubeReadonlyScope, youtubeUploadScope] };
  }

  async upload(input: VideoUploadInput, accessToken: string): Promise<PublishedVideo> {
    const metadata = { snippet: { title: input.title, description: input.description }, status: { privacyStatus: input.privacyStatus, ...(input.publishAt ? { publishAt: input.publishAt } : {}) } };
    const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(input.video.byteLength) }, body: JSON.stringify(metadata) });
    const location = start.headers.get("location");
    if (!start.ok || !location) throw new Error("YouTube resumable upload could not be initiated.");
    const videoBody = new Uint8Array(input.video).buffer;
    const uploaded = await fetch(location, { method: "PUT", headers: { authorization: `Bearer ${accessToken}`, "content-length": String(input.video.byteLength), "content-type": "video/mp4" }, body: videoBody });
    if (!uploaded.ok) throw new Error("YouTube resumable upload failed.");
    const body = await uploaded.json() as { id?: string; status?: { publishAt?: string; privacyStatus?: string } };
    if (!body.id) throw new Error("YouTube upload response did not include a video ID.");
    return { externalVideoId: body.id, url: `https://www.youtube.com/watch?v=${body.id}`, publishedAt: body.status?.publishAt ?? input.publishAt, status: body.status?.privacyStatus === "private" && (body.status.publishAt ?? input.publishAt) ? "scheduled" : "uploaded" };
  }
}
