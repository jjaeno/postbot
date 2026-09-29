import { loadConfig } from "@postbot/config";
import type { PrismaClient } from "@postbot/database";
import { assertRequiredScopes, decryptOAuthToken, encryptOAuthToken, FakeInstagramPublisherProvider, FakeTikTokPublisherProvider, FakeYouTubePublisherProvider, GoogleYouTubePublisherProvider, MetaInstagramPublisherProvider, TikTokPublisherProvider, type PublisherProvider } from "@postbot/publishers";
import { createHash } from "node:crypto";

type AccountWithCredential = {
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
    ? new GoogleYouTubePublisherProvider(config.YOUTUBE_CLIENT_ID, config.YOUTUBE_CLIENT_SECRET)
    : new FakeYouTubePublisherProvider();
};

export const resolveOAuthAccessToken = async (prisma: PrismaClient, account: AccountWithCredential): Promise<string> => {
  const config = loadConfig();
  if (!account.credential) return "fake-access-token";
  const previousKeys = config.OAUTH_ENCRYPTION_PREVIOUS_KEYS.split(",").map((key) => key.trim()).filter(Boolean);
  const accessToken = decryptOAuthToken(account.credential.encryptedAccessToken, account.credential.tokenCipher, config.OAUTH_ENCRYPTION_KEY, previousKeys);
  if (!account.credential.expiresAt || account.credential.expiresAt.getTime() > Date.now() + 5 * 60_000) return accessToken;
  if (!account.credential.encryptedRefreshToken) throw new Error("OAUTH_REFRESH_TOKEN_MISSING");
  const provider = providerFor(account.platform);
  if (!provider.refreshAccessToken) throw new Error("OAUTH_REFRESH_NOT_SUPPORTED");
  const refreshToken = decryptOAuthToken(account.credential.encryptedRefreshToken, account.credential.tokenCipher, config.OAUTH_ENCRYPTION_KEY, previousKeys);
  const refreshed = await provider.refreshAccessToken(refreshToken);
  const scopes = refreshed.scopes.length > 0 ? refreshed.scopes : stringList(account.credential.scopes);
  assertRequiredScopes(scopes, provider.capabilities.requiredScopes);
  await prisma.oAuthCredential.update({
    where: { id: account.credential.id },
    data: {
      encryptedAccessToken: encryptOAuthToken(refreshed.accessToken, config.OAUTH_ENCRYPTION_KEY),
      encryptedRefreshToken: refreshed.refreshToken ? encryptOAuthToken(refreshed.refreshToken, config.OAUTH_ENCRYPTION_KEY) : account.credential.encryptedRefreshToken,
      tokenCipher: "aes-256-gcm",
      tokenKeyVersion: config.OAUTH_ENCRYPTION_KEY_VERSION,
      scopes,
      scopeHash: createScopeHash(scopes),
      expiresAt: refreshed.expiresAt,
      lastRefreshedAt: new Date()
    }
  });
  return refreshed.accessToken;
};

const createScopeHash = (scopes: readonly string[]): string => {
  return createHash("sha256").update([...scopes].sort().join(" ")).digest("hex");
};
