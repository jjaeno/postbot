import { loadConfig } from "@postbot/config";
import { resolveSharedOAuthCredential, OAuthReauthenticationRequired, type PrismaClient } from "@postbot/database";
import { OAuthRefreshError, OAuthScopeError, assertRequiredScopes, decryptOAuthToken, encryptOAuthToken, FakeInstagramPublisherProvider, FakeTikTokPublisherProvider, FakeYouTubePublisherProvider, GoogleYouTubePublisherProvider, MetaInstagramPublisherProvider, TikTokPublisherProvider, type PublisherProvider } from "@postbot/publishers";
import { createHash } from "node:crypto";

type AccountWithCredential = {
  id: string;
  platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK";
  credential: {
    id: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenCipher: string;
    scopes: unknown;
    expiresAt: Date | null;
  } | null;
};

const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const providerFor = (platform: AccountWithCredential["platform"]): PublisherProvider => {
  const config = loadConfig();
  if (platform === "INSTAGRAM") return config.INSTAGRAM_OAUTH_PROVIDER === "meta"
    ? new MetaInstagramPublisherProvider({ clientId: config.INSTAGRAM_CLIENT_ID, clientSecret: config.INSTAGRAM_CLIENT_SECRET, graphVersion: config.INSTAGRAM_GRAPH_VERSION, timeoutMs: config.PROVIDER_HTTP_TIMEOUT_MS, pollIntervalMs: config.SOCIAL_PUBLISH_POLL_INTERVAL_MS })
    : new FakeInstagramPublisherProvider();
  if (platform === "TIKTOK") return config.TIKTOK_OAUTH_PROVIDER === "tiktok"
    ? new TikTokPublisherProvider({ clientId: config.TIKTOK_CLIENT_KEY, clientSecret: config.TIKTOK_CLIENT_SECRET, timeoutMs: config.PROVIDER_HTTP_TIMEOUT_MS, pollIntervalMs: config.SOCIAL_PUBLISH_POLL_INTERVAL_MS })
    : new FakeTikTokPublisherProvider();
  return config.YOUTUBE_OAUTH_PROVIDER === "google"
    ? new GoogleYouTubePublisherProvider(config.YOUTUBE_CLIENT_ID, config.YOUTUBE_CLIENT_SECRET, { timeoutMs: config.PROVIDER_HTTP_TIMEOUT_MS })
    : new FakeYouTubePublisherProvider();
};

export const resolveOAuthAccessToken = async (prisma: PrismaClient, account: AccountWithCredential): Promise<string> => {
  const config = loadConfig();
  const provider = providerFor(account.platform);
  const latest = await prisma.platformAccount.findUnique({ where: { id: account.id }, include: { credential: true } });
  if (!latest || latest.status !== "CONNECTED") throw new OAuthReauthenticationRequired();
  if (!latest.credential) {
    if (provider.capabilities.provider === "fake") return "fake-access-token";
    await prisma.platformAccount.updateMany({ where: { id: account.id, status: "CONNECTED" }, data: { status: "EXPIRED" } });
    throw new OAuthReauthenticationRequired();
  }
  const previousKeys = config.OAUTH_ENCRYPTION_PREVIOUS_KEYS.split(",").map((key) => key.trim()).filter(Boolean);
  const credential = await resolveSharedOAuthCredential(prisma, account.id, async (current) => {
    if (!provider.refreshAccessToken || !current.encryptedRefreshToken) throw new OAuthReauthenticationRequired();
    const refreshToken = decryptOAuthToken(current.encryptedRefreshToken, current.tokenCipher, config.OAUTH_ENCRYPTION_KEY, previousKeys);
    try {
      const refreshed = await provider.refreshAccessToken(refreshToken);
      const scopes = refreshed.scopes.length > 0 || provider.capabilities.provider !== "google" ? refreshed.scopes : stringList(current.scopes);
      assertRequiredScopes(scopes, provider.capabilities.requiredScopes);
      return { encryptedAccessToken: encryptOAuthToken(refreshed.accessToken, config.OAUTH_ENCRYPTION_KEY), encryptedRefreshToken: refreshed.refreshToken ? encryptOAuthToken(refreshed.refreshToken, config.OAUTH_ENCRYPTION_KEY) : current.encryptedRefreshToken,
        tokenCipher: "aes-256-gcm", tokenKeyVersion: config.OAUTH_ENCRYPTION_KEY_VERSION, scopes, scopeHash: createScopeHash(scopes), expiresAt: refreshed.expiresAt };
    } catch (error) {
      if (error instanceof OAuthScopeError || error instanceof OAuthRefreshError && error.reauthenticationRequired) throw new OAuthReauthenticationRequired();
      throw new Error("OAUTH_REFRESH_TRANSIENT");
    }
  }, { leaseMs: Math.max(60000, config.PROVIDER_HTTP_TIMEOUT_MS + 30000) });
  try { assertRequiredScopes(stringList(credential.scopes), provider.capabilities.requiredScopes); }
  catch {
    await prisma.platformAccount.updateMany({ where: { id: account.id, status: "CONNECTED", credential: { credentialVersion: credential.credentialVersion } }, data: { status: "EXPIRED" } });
    throw new OAuthReauthenticationRequired();
  }
  return decryptOAuthToken(credential.encryptedAccessToken, credential.tokenCipher, config.OAUTH_ENCRYPTION_KEY, previousKeys);
};

const createScopeHash = (scopes: readonly string[]): string => {
  return createHash("sha256").update([...scopes].sort().join(" ")).digest("hex");
};
