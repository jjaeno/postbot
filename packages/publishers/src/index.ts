import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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
  provider: "fake" | "google" | "meta" | "tiktok";
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
export const youtubeAnalyticsScope = "https://www.googleapis.com/auth/yt-analytics.readonly";
export const instagramBasicScope = "instagram_business_basic";
export const instagramPublishScope = "instagram_business_content_publish";
export const instagramInsightsScope = "instagram_business_manage_insights";
export const tiktokVideoListScope = "video.list";
export const tiktokBasicScope = "user.info.basic";
export const tiktokPublishScope = "video.publish";

export type VideoUploadInput = { title: string; description: string; privacyStatus: "public" | "unlisted" | "private"; publishAt: string | null; video: Uint8Array; idempotencyKey: string; externalAccountId?: string; aiGenerated?: boolean };
export class OAuthRefreshError extends Error { constructor(readonly reauthenticationRequired: boolean) { super(reauthenticationRequired ? "OAUTH_REAUTHENTICATION_REQUIRED" : "OAUTH_REFRESH_TRANSIENT"); } }
export type PublishedVideo = { externalVideoId: string; url: string; publishedAt: string | null; scheduledAt?: string | null; visibility?: "public" | "unlisted" | "private"; processingComplete?: boolean; failureReason?: string; status: "uploaded" | "processing" | "scheduled" | "published" | "failed" | "ambiguous" };
export interface VideoPublisher { upload(input: VideoUploadInput, accessToken?: string): Promise<PublishedVideo>; getPublicationStatus?(externalVideoId: string, accessToken?: string, externalAccountId?: string): Promise<PublishedVideo>; }
export interface SocialVideoPublisher extends PublisherProvider, VideoPublisher { validate(input: VideoUploadInput): Promise<void>; getPublicationStatus(externalVideoId: string, accessToken?: string): Promise<PublishedVideo>; }
export const decryptOAuthToken = (cipherText: string, cipher: string, encryptionKey: string, previousKeys: readonly string[] = []): string => {
  if (cipher !== "aes-256-gcm") throw new Error("Unsupported OAuth token cipher.");
  const [iv, tag, encrypted] = cipherText.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted OAuth token payload.");
  for (const key of [encryptionKey, ...previousKeys]) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
    } catch { /* Try the next retained key. */ }
  }
  throw new Error("Unable to decrypt OAuth token with configured keys.");
};
export const encryptOAuthToken = (plainText: string, encryptionKey: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(encryptionKey).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
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
  private readonly results = new Map<string, PublishedVideo>();
  readonly capabilities: OAuthProviderCapabilities = {
    provider: "fake",
    platform: "youtube",
    requiredScopes: [youtubeReadonlyScope, youtubeUploadScope, youtubeAnalyticsScope]
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
      scopes: [youtubeReadonlyScope, youtubeUploadScope, youtubeAnalyticsScope]
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
    return Promise.resolve({ accessToken: "fake-refreshed-access-token", refreshToken, expiresAt: new Date(Date.now() + 60 * 60 * 1000), scopes: [youtubeReadonlyScope, youtubeUploadScope, youtubeAnalyticsScope] });
  }
  upload(input: VideoUploadInput): Promise<PublishedVideo> {
    const existing = this.results.get(input.idempotencyKey); if (existing) return Promise.resolve(existing);
    const prefix = input.publishAt ? `scheduled-${Date.parse(input.publishAt)}-` : input.privacyStatus === "private" ? "private-" : "";
    const externalVideoId = `fake-${prefix}${input.idempotencyKey.slice(0, 24)}`;
    const result: PublishedVideo = { externalVideoId, url: `https://www.youtube.com/watch?v=${externalVideoId}`, publishedAt: input.publishAt || input.privacyStatus === "private" ? null : new Date().toISOString(), scheduledAt: input.publishAt, visibility: input.privacyStatus, processingComplete: true, status: input.publishAt ? "scheduled" : input.privacyStatus === "private" ? "uploaded" : "published" };
    this.results.set(input.idempotencyKey, result); return Promise.resolve(result);
  }
  getPublicationStatus(externalVideoId: string): Promise<PublishedVideo> {
    const result = [...this.results.values()].find((result) => result.externalVideoId === externalVideoId);
    if (result && result.status !== "scheduled") return Promise.resolve(result);
    const scheduled = /^fake-scheduled-(\d+)-/.exec(externalVideoId)?.[1]; const scheduledAt = scheduled ? new Date(Number(scheduled)).toISOString() : null;
    const isPrivate = externalVideoId.startsWith("fake-private-"); const future = scheduled !== undefined && Number(scheduled) > Date.now();
    return Promise.resolve({ externalVideoId, url: `https://www.youtube.com/watch?v=${externalVideoId}`, publishedAt: isPrivate || future ? null : scheduledAt ?? new Date().toISOString(), scheduledAt, processingComplete: true, visibility: isPrivate || future ? "private" : "public", status: isPrivate ? "uploaded" : future ? "scheduled" : "published" });
  }
}

export class GoogleYouTubePublisherProvider implements PublisherProvider, VideoPublisher {
  readonly capabilities: OAuthProviderCapabilities = {
    provider: "google",
    platform: "youtube",
    requiredScopes: [youtubeReadonlyScope, youtubeUploadScope, youtubeAnalyticsScope]
  };

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly options: { timeoutMs?: number; fetchImplementation?: typeof fetch; onUploadSession?: (url: string) => Promise<void> } = {}
  ) {}

  private request(url: string | URL, init: RequestInit): Promise<Response> {
    return withTimeout(this.options.fetchImplementation ?? fetch, url, init, this.options.timeoutMs ?? 180_000);
  }

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
    const response = await this.request("https://oauth2.googleapis.com/token", {
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
    const response = await this.request(url, {
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
    await this.request("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token })
    });
  }
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    const response = await this.request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
    if (!response.ok) throw new OAuthRefreshError([400, 401, 403].includes(response.status));
    const body = await response.json() as { access_token?: string; expires_in?: number; scope?: string };
    if (!body.access_token) throw new Error("Google token refresh did not include an access token.");
    return { accessToken: body.access_token, refreshToken, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null, scopes: body.scope ? body.scope.split(" ") : [] };
  }

  async upload(input: VideoUploadInput, accessToken: string): Promise<PublishedVideo> {
    if (input.publishAt && (input.privacyStatus !== "private" || new Date(input.publishAt).getTime() <= Date.now())) throw new Error("YOUTUBE_SCHEDULE_REQUIRES_FUTURE_PRIVATE_VIDEO");
    const metadata = { snippet: { title: input.title, description: input.description }, status: { privacyStatus: input.privacyStatus, ...(input.publishAt ? { publishAt: input.publishAt } : {}) } };
    const start = await this.request("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(input.video.byteLength) }, body: JSON.stringify(metadata) });
    const location = start.headers.get("location");
    if ([401, 403].includes(start.status)) throw new OAuthRefreshError(true);
    if (!start.ok || !location) throw new Error("YouTube resumable upload could not be initiated.");
    try {
    await this.options.onUploadSession?.(location);
    const videoBody = new Uint8Array(input.video).buffer;
    const uploaded = await this.request(location, { method: "PUT", headers: { authorization: `Bearer ${accessToken}`, "content-length": String(input.video.byteLength), "content-type": "video/mp4" }, body: videoBody });
    if (!uploaded.ok) throw new Error("YouTube resumable upload failed.");
    const body = await uploaded.json() as { id?: string; status?: { publishAt?: string; privacyStatus?: string } };
    if (!body.id) throw new Error("YouTube upload response did not include a video ID.");
    return { externalVideoId: body.id, url: `https://www.youtube.com/watch?v=${body.id}`, publishedAt: null, scheduledAt: body.status?.publishAt ?? input.publishAt, visibility: body.status?.privacyStatus === "public" || body.status?.privacyStatus === "unlisted" || body.status?.privacyStatus === "private" ? body.status.privacyStatus : undefined, status: body.status?.privacyStatus === "private" && (body.status.publishAt ?? input.publishAt) ? "scheduled" : "uploaded" };
    } catch { throw new AmbiguousPublishError("YouTube upload outcome is ambiguous; inspect the resumable session before retrying."); }
  }
  async getPublicationStatus(externalVideoId: string, accessToken = "", externalAccountId?: string): Promise<PublishedVideo> {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos"); url.search = new URLSearchParams({ part: "snippet,status,processingDetails", id: externalVideoId }).toString();
    const response = await this.request(url, { method: "GET", headers: { authorization: `Bearer ${accessToken}` } });
    if ([401, 403].includes(response.status)) throw new OAuthRefreshError(true);
    if (!response.ok) throw new Error("PUBLICATION_STATUS_LOOKUP_FAILED");
    const body = await response.json() as { items?: Array<{ id?: string; snippet?: { channelId?: string; publishedAt?: string }; status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string; failureReason?: string; rejectionReason?: string }; processingDetails?: { processingStatus?: string; processingFailureReason?: string } }> };
    const item = body.items?.find((item) => item.id === externalVideoId);
    if (!item || externalAccountId && item.snippet?.channelId !== externalAccountId) throw new Error("PUBLICATION_ACCOUNT_OR_ID_MISMATCH");
    const status = item.status; const processing = item.processingDetails;
    const visibility = status?.privacyStatus === "public" || status?.privacyStatus === "unlisted" || status?.privacyStatus === "private" ? status.privacyStatus : undefined;
    const failed = ["failed", "rejected", "deleted"].includes(status?.uploadStatus ?? "") || processing?.processingStatus === "failed";
    const phase = failed ? "failed" : status?.publishAt && visibility === "private" ? "scheduled" : processing?.processingStatus === "processing" || status?.uploadStatus === "uploaded" ? "processing" : status?.uploadStatus === "processed" && (visibility === "public" || visibility === "unlisted") ? "published" : "uploaded";
    return { externalVideoId, url: `https://www.youtube.com/watch?v=${externalVideoId}`, status: phase, visibility, processingComplete: status?.uploadStatus === "processed" && processing?.processingStatus !== "processing", publishedAt: phase === "published" ? item.snippet?.publishedAt ?? null : null, scheduledAt: status?.publishAt ?? null,
      ...(failed ? { failureReason: processing?.processingFailureReason ?? status?.failureReason ?? status?.rejectionReason ?? "PLATFORM_REPORTED_FAILURE" } : {}) };
  }
}

class FakeSocialPublisher implements SocialVideoPublisher {
  private readonly results = new Map<string, PublishedVideo>();
  constructor(readonly capabilities: OAuthProviderCapabilities, private readonly baseUrl: string) {}
  createAuthorizationUrl(input: OAuthStartInput): string { const url = new URL(input.redirectUri); url.searchParams.set("state", input.state); url.searchParams.set("code", `fake-${this.capabilities.platform}-code`); return url.toString(); }
  exchangeCode(): Promise<OAuthTokenSet> { return Promise.resolve({ accessToken: `fake-${this.capabilities.platform}-access-token`, refreshToken: `fake-${this.capabilities.platform}-refresh-token`, expiresAt: new Date(Date.now() + 3_600_000), scopes: this.capabilities.requiredScopes }); }
  getAccountProfile(): Promise<PublisherAccountProfile> { return Promise.resolve({ externalAccountId: `fake-${this.capabilities.platform}-account`, handle: `@postbot-${this.capabilities.platform}`, displayName: `Postbot Fake ${this.capabilities.platform}` }); }
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> { return Promise.resolve({ accessToken: `fake-${this.capabilities.platform}-refreshed-token`, refreshToken, expiresAt: new Date(Date.now() + 3_600_000), scopes: this.capabilities.requiredScopes }); }
  validate(input: VideoUploadInput): Promise<void> { if (!input.title || input.video.byteLength === 0) return Promise.reject(new Error("Invalid social video upload.")); if (this.capabilities.platform === "instagram" && input.privacyStatus !== "public") return Promise.reject(new Error("INSTAGRAM_VISIBILITY_SETTING_UNSUPPORTED")); return Promise.resolve(); }
  async upload(input: VideoUploadInput): Promise<PublishedVideo> { await this.validate(input); const existing = this.results.get(input.idempotencyKey); if (existing) return existing; const id = `fake-${this.capabilities.platform}-${input.idempotencyKey.slice(0, 24)}`; const result: PublishedVideo = { externalVideoId: id, url: `${this.baseUrl}/${id}`, publishedAt: input.publishAt ? null : new Date().toISOString(), scheduledAt: input.publishAt, visibility: input.privacyStatus, status: input.publishAt ? "scheduled" : "published" }; this.results.set(input.idempotencyKey, result); return result; }
  getPublicationStatus(externalVideoId: string, accessToken?: string): Promise<PublishedVideo> { void accessToken; return Promise.resolve({ externalVideoId, url: `${this.baseUrl}/${externalVideoId}`, publishedAt: new Date().toISOString(), status: "published" }); }
}
export class FakeInstagramPublisherProvider extends FakeSocialPublisher { constructor() { super({ provider: "fake", platform: "instagram", requiredScopes: [instagramBasicScope, instagramPublishScope, instagramInsightsScope] }, "https://www.instagram.com/reel"); } }
export class FakeTikTokPublisherProvider extends FakeSocialPublisher { constructor() { super({ provider: "fake", platform: "tiktok", requiredScopes: [tiktokBasicScope, tiktokPublishScope, tiktokVideoListScope] }, "https://www.tiktok.com/@postbot/video"); } }

export class AmbiguousPublishError extends Error {
  constructor(message: string, readonly externalOperationId: string | null = null) {
    super(message);
    this.name = "AmbiguousPublishError";
  }
}

type SocialProviderOptions = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchImplementation?: typeof fetch;
};

const responseJson = async <Body>(response: Response, label: string): Promise<Body> => {
  const body = await response.json().catch(() => null) as Body | null;
  if (!response.ok || body === null) throw new Error(`${label} failed with status ${response.status}.`);
  return body;
};

const withTimeout = async (fetchImplementation: typeof fetch, input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(input, { ...init, signal: controller.signal });
    const bytes = await response.arrayBuffer();
    return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : bytes, { status: response.status, headers: response.headers });
  }
  finally { clearTimeout(timeout); }
};

const wait = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class MetaInstagramPublisherProvider implements SocialVideoPublisher {
  readonly capabilities: OAuthProviderCapabilities = { provider: "meta", platform: "instagram", requiredScopes: [instagramBasicScope, instagramPublishScope, instagramInsightsScope] };
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: SocialProviderOptions & { readonly graphVersion?: string }) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  createAuthorizationUrl(input: OAuthStartInput): string {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", input.scopes.join(","));
    url.searchParams.set("state", input.state);
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokenSet> {
    void input.codeVerifier;
    const response = await withTimeout(this.fetchImplementation, "https://api.instagram.com/oauth/access_token", { method: "POST", body: new URLSearchParams({ client_id: this.options.clientId, client_secret: this.options.clientSecret, grant_type: "authorization_code", redirect_uri: input.redirectUri, code: input.code }) }, this.timeoutMs);
    const tokenResponse = await responseJson<{ access_token?: string; user_id?: number; permissions?: string[]; data?: Array<{ access_token?: string; user_id?: number; permissions?: string[] }> }>(response, "Instagram OAuth token exchange");
    const body = tokenResponse.data?.[0] ?? tokenResponse;
    if (!body.access_token) throw new Error("Instagram OAuth response did not include an access token.");
    const longLived = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: this.options.clientSecret, access_token: body.access_token })}`, { method: "GET" }, this.timeoutMs);
    const longBody = await responseJson<{ access_token?: string; expires_in?: number }>(longLived, "Instagram long-lived token exchange");
    if (!longBody.access_token) throw new Error("Instagram long-lived token response did not include an access token.");
    return { accessToken: longBody.access_token, refreshToken: longBody.access_token, expiresAt: longBody.expires_in ? new Date(Date.now() + longBody.expires_in * 1000) : null, scopes: body.permissions ?? await this.grantedScopes(longBody.access_token) };
  }

  async getAccountProfile(accessToken: string): Promise<PublisherAccountProfile> {
    const response = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/me?${new URLSearchParams({ fields: "user_id,username,name", access_token: accessToken })}`, { method: "GET" }, this.timeoutMs);
    const body = await responseJson<{ user_id?: string; id?: string; username?: string; name?: string }>(response, "Instagram profile lookup");
    const externalAccountId = body.user_id ?? body.id;
    if (!externalAccountId) throw new Error("Instagram profile response did not include a user ID.");
    return { externalAccountId, handle: body.username ? `@${body.username}` : null, displayName: body.name ?? body.username ?? null };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    const response = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: refreshToken })}`, { method: "GET" }, this.timeoutMs);
    if (!response.ok) throw new OAuthRefreshError([400, 401, 403].includes(response.status));
    const body = await responseJson<{ access_token?: string; expires_in?: number }>(response, "Instagram token refresh");
    if (!body.access_token) throw new Error("Instagram refresh response did not include an access token.");
    return { accessToken: body.access_token, refreshToken: body.access_token, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null, scopes: await this.grantedScopes(body.access_token) };
  }

  private async grantedScopes(accessToken: string): Promise<string[]> {
    const response = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/${this.options.graphVersion ?? "v24.0"}/me/permissions`, { headers: { authorization: `Bearer ${accessToken}` } }, this.timeoutMs);
    const body = await responseJson<{ data?: Array<{ permission?: string; status?: string; permissions?: string[] }> }>(response, "Instagram granted permissions lookup");
    return (body.data ?? []).flatMap((entry) => entry.permissions ?? (entry.status === "granted" && entry.permission ? [entry.permission] : []));
  }

  async revoke(_refreshToken: string | null, accessToken: string): Promise<void> {
    const response = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/me/permissions?${new URLSearchParams({ access_token: accessToken })}`, { method: "DELETE" }, this.timeoutMs);
    if (!response.ok) throw new Error("Instagram authorization revoke failed.");
  }

  validate(input: VideoUploadInput): Promise<void> {
    if (input.privacyStatus !== "public") return Promise.reject(new Error("INSTAGRAM_VISIBILITY_SETTING_UNSUPPORTED"));
    if (!input.externalAccountId || input.video.byteLength === 0 || input.video.byteLength > 300 * 1024 * 1024) return Promise.reject(new Error("Invalid Instagram Reels upload."));
    return Promise.resolve();
  }

  async upload(input: VideoUploadInput, accessToken?: string): Promise<PublishedVideo> {
    await this.validate(input);
    if (!accessToken || !input.externalAccountId) throw new Error("Instagram access token and account ID are required.");
    const graphVersion = this.options.graphVersion ?? "v24.0";
    let containerId: string | null = null;
    let publicationStarted = false;
    try {
      const create = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/${graphVersion}/${encodeURIComponent(input.externalAccountId)}/media`, { method: "POST", headers: { authorization: `OAuth ${accessToken}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ media_type: "REELS", upload_type: "resumable", caption: input.description || input.title, share_to_feed: "true" }) }, this.timeoutMs);
      const createBody = await responseJson<{ id?: string; uri?: string }>(create, "Instagram media container creation");
      if (!createBody.id) throw new Error("Instagram media container response did not include an ID.");
      containerId = createBody.id;
      const uploadUrl = createBody.uri ?? `https://rupload.facebook.com/ig-api-upload/${containerId}`;
      const upload = await withTimeout(this.fetchImplementation, uploadUrl, { method: "POST", headers: { authorization: `OAuth ${accessToken}`, offset: "0", file_size: String(input.video.byteLength), "content-type": "application/octet-stream" }, body: new Uint8Array(input.video).buffer }, this.timeoutMs);
      if (!upload.ok) throw new Error(`Instagram media upload failed with status ${upload.status}.`);
      await this.waitForContainer(containerId, accessToken, graphVersion);
      publicationStarted = true;
      const publish = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/${graphVersion}/${encodeURIComponent(input.externalAccountId)}/media_publish`, { method: "POST", headers: { authorization: `OAuth ${accessToken}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: containerId }) }, this.timeoutMs);
      const publishBody = await responseJson<{ id?: string }>(publish, "Instagram media publish");
      if (!publishBody.id) throw new Error("Instagram publish response did not include a media ID.");
      return this.getPublicationStatus(publishBody.id, accessToken);
    } catch (error) {
      if (publicationStarted) throw new AmbiguousPublishError("Instagram publish outcome requires reconciliation before retry.", containerId);
      if (containerId && (error instanceof DOMException || (error instanceof Error && /abort|network|fetch/i.test(error.message)))) throw new AmbiguousPublishError("Instagram publish outcome is ambiguous.", containerId);
      throw error;
    }
  }

  async getPublicationStatus(externalVideoId: string, accessToken?: string): Promise<PublishedVideo> {
    if (!accessToken) throw new Error("Instagram access token is required.");
    const response = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/${this.options.graphVersion ?? "v24.0"}/${encodeURIComponent(externalVideoId)}?${new URLSearchParams({ fields: "id,permalink,timestamp", access_token: accessToken })}`, { method: "GET" }, this.timeoutMs);
    const body = await responseJson<{ id?: string; permalink?: string; timestamp?: string }>(response, "Instagram publication lookup");
    return { externalVideoId: body.id ?? externalVideoId, url: body.permalink ?? "", publishedAt: body.timestamp ?? null, status: "published" };
  }

  private async waitForContainer(containerId: string, accessToken: string, graphVersion: string): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const response = await withTimeout(this.fetchImplementation, `https://graph.instagram.com/${graphVersion}/${encodeURIComponent(containerId)}?${new URLSearchParams({ fields: "status_code,status", access_token: accessToken })}`, { method: "GET" }, this.timeoutMs);
      const body = await responseJson<{ status_code?: string; status?: string }>(response, "Instagram container status");
      if (body.status_code === "FINISHED") return;
      if (body.status_code === "ERROR" || body.status_code === "EXPIRED") throw new Error(`Instagram container failed: ${body.status ?? body.status_code}.`);
      await wait(this.pollIntervalMs);
    }
    throw new AmbiguousPublishError("Instagram media container status timed out.", containerId);
  }
}

export class TikTokPublisherProvider implements SocialVideoPublisher {
  readonly capabilities: OAuthProviderCapabilities = { provider: "tiktok", platform: "tiktok", requiredScopes: [tiktokBasicScope, tiktokPublishScope, tiktokVideoListScope] };
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: SocialProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  createAuthorizationUrl(input: OAuthStartInput): string {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", this.options.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", input.scopes.join(","));
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokenSet> {
    const response = await withTimeout(this.fetchImplementation, "https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: this.options.clientId, client_secret: this.options.clientSecret, code: input.code, grant_type: "authorization_code", redirect_uri: input.redirectUri, code_verifier: input.codeVerifier }) }, this.timeoutMs);
    return this.parseToken(await responseJson(response, "TikTok OAuth token exchange"));
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    const response = await withTimeout(this.fetchImplementation, "https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: this.options.clientId, client_secret: this.options.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }) }, this.timeoutMs);
    return this.parseToken(await responseJson(response, "TikTok token refresh"));
  }

  async getAccountProfile(accessToken: string): Promise<PublisherAccountProfile> {
    const response = await withTimeout(this.fetchImplementation, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name", { headers: { authorization: `Bearer ${accessToken}` } }, this.timeoutMs);
    const body = await responseJson<{ data?: { user?: { open_id?: string; display_name?: string; username?: string } }; error?: { code?: string } }>(response, "TikTok profile lookup");
    if (body.error?.code && body.error.code !== "ok") throw new Error(`TikTok profile lookup failed: ${body.error.code}.`);
    const user = body.data?.user;
    if (!user?.open_id) throw new Error("TikTok profile response did not include open_id.");
    return { externalAccountId: user.open_id, handle: user.username ? `@${user.username}` : null, displayName: user.display_name ?? user.username ?? null };
  }

  async revoke(_refreshToken: string | null, accessToken: string): Promise<void> {
    const response = await withTimeout(this.fetchImplementation, "https://open.tiktokapis.com/v2/oauth/revoke/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: this.options.clientId, client_secret: this.options.clientSecret, token: accessToken }) }, this.timeoutMs);
    if (!response.ok) throw new Error("TikTok authorization revoke failed.");
  }

  validate(input: VideoUploadInput): Promise<void> {
    if (!input.externalAccountId || input.video.byteLength === 0 || input.video.byteLength > 4 * 1024 * 1024 * 1024) return Promise.reject(new Error("Invalid TikTok Direct Post upload."));
    return Promise.resolve();
  }

  upload(_input: VideoUploadInput, _accessToken?: string): Promise<PublishedVideo> {
    void _input; void _accessToken;
    // Direct Post requires per-video creator settings, preview, explicit consent
    // and an approved public-use client. Postbot's automation UX cannot certify it.
    return Promise.reject(new Error("TIKTOK_DIRECT_POST_HELD"));
  }

  async getPublicationStatus(externalVideoId: string, accessToken?: string): Promise<PublishedVideo> {
    if (!accessToken) throw new Error("TikTok access token is required.");
    return this.fetchStatus(externalVideoId, accessToken);
  }

  private parseToken(body: unknown): OAuthTokenSet {
    const value = body as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!value.access_token) throw new Error("TikTok token response did not include an access token.");
    return { accessToken: value.access_token, refreshToken: value.refresh_token ?? null, expiresAt: value.expires_in ? new Date(Date.now() + value.expires_in * 1000) : null, scopes: value.scope ? value.scope.split(",").map((scope) => scope.trim()) : [] };
  }

  private async fetchStatus(publishId: string, accessToken: string): Promise<PublishedVideo> {
    const response = await withTimeout(this.fetchImplementation, "https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify({ publish_id: publishId }) }, this.timeoutMs);
    const body = await responseJson<{ data?: { status?: string; fail_reason?: string; publicly_available_post_id?: string[]; publicaly_available_post_id?: string[] }; error?: { code?: string } }>(response, "TikTok publication status");
    if (body.error?.code && body.error.code !== "ok") throw new Error(`TikTok publication status failed: ${body.error.code}.`);
    if (body.data?.status === "FAILED") throw new Error(`TikTok publication failed: ${body.data.fail_reason ?? "unknown"}.`);
    const postId = body.data?.publicly_available_post_id?.[0] ?? body.data?.publicaly_available_post_id?.[0];
    if (body.data?.status === "PUBLISH_COMPLETE") {
      if (!postId) throw new AmbiguousPublishError("TikTok post ID is not available; do not republish.", publishId);
      return { externalVideoId: postId, url: "", publishedAt: null, status: "published" };
    }
    return { externalVideoId: publishId, url: "", publishedAt: null, status: "uploaded" };
  }
}
