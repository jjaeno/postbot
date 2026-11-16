import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
  STAGING_FAKE_CANARY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  ENABLED_PLATFORMS: z.string().default("youtube,instagram,tiktok").refine((value) => value.split(",").every((part) => ["youtube", "instagram", "tiktok"].includes(part.trim())), "Use comma-separated youtube,instagram,tiktok"),
  RENDER_COST_MODE: z.enum(["priced", "free"]).default("priced"),
  WEB_PORT: z.coerce.number().int().positive().default(5173),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_BASE_URL: z.string().url().default("http://localhost:3000"),
  PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .url()
    .default("mysql://postbot:postbot@localhost:3307/postbot"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("postbot-local"),
  S3_ACCESS_KEY_ID: z.string().min(1).default("postbot"),
  S3_SECRET_ACCESS_KEY: z.string().min(1).default("postbot-password"),
  STORAGE_PROVIDER: z.enum(["fake", "s3"]).default("s3"),
  TOPIC_SOURCE_PROVIDER: z.enum(["fixture", "rss"]).default("fixture"),
  TOPIC_SOURCE_FEED_URLS: z.string().default(""),
  TOPIC_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(15_000),
  TOPIC_SOURCE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  JWT_ACCESS_SECRET: z.string().min(16).default("local-access-secret-change-me"),
  JWT_REFRESH_SECRET: z.string().min(16).default("local-refresh-secret-change-me"),
  OAUTH_ENCRYPTION_KEY: z.string().min(16).default("local-oauth-encryption-key-change-me"),
  OAUTH_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  OAUTH_ENCRYPTION_PREVIOUS_KEYS: z.string().default(""),
  YOUTUBE_OAUTH_PROVIDER: z.enum(["fake", "google"]).default("fake"),
  YOUTUBE_CLIENT_ID: z.string().default(""),
  YOUTUBE_CLIENT_SECRET: z.string().default(""),
  YOUTUBE_UPLOAD_PRIVACY: z.enum(["public", "unlisted", "private"]).default("private"),
  YOUTUBE_ANALYTICS_PROVIDER: z.enum(["fake", "youtube"]).default("fake"),
  INSTAGRAM_OAUTH_PROVIDER: z.enum(["fake", "meta"]).default("fake"),
  INSTAGRAM_CLIENT_ID: z.string().default(""),
  INSTAGRAM_CLIENT_SECRET: z.string().default(""),
  INSTAGRAM_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v24.0"),
  INSTAGRAM_ANALYTICS_PROVIDER: z.enum(["fake", "instagram"]).default("fake"),
  TIKTOK_OAUTH_PROVIDER: z.enum(["fake", "tiktok"]).default("fake"),
  TIKTOK_CLIENT_KEY: z.string().default(""),
  TIKTOK_CLIENT_SECRET: z.string().default(""),
  TIKTOK_ANALYTICS_PROVIDER: z.enum(["fake", "tiktok"]).default("fake"),
  SOCIAL_PUBLISH_TIMEOUT_MS: z.coerce.number().int().positive().max(1_800_000).default(180_000),
  SOCIAL_PUBLISH_POLL_INTERVAL_MS: z.coerce.number().int().positive().max(60_000).default(2_000),
  PROVIDER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(30_000),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AUTOMATION_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  ANALYTICS_COLLECTION_HOURS: z.string().default("24,72,168").refine((value) => value.split(",").every((part) => Number.isInteger(Number(part)) && Number(part) > 0 && Number(part) <= 8760), "Use positive collection hours up to one year"),
  WORKER_QUEUES: z.string().default("collect,script,asset,tts,render,policy,publish,analytics"),
  MAINTENANCE_WORKER_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  QUEUE_RECOVERY_STALE_AFTER_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  WEB_BASE_URL: z.string().url().default("http://localhost:5173"),
  LLM_PROVIDER: z.enum(["fake", "openai"]).default("fake"),
  LLM_MODEL: z.string().min(1).default("gpt-5-mini"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(60_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32768).default(4096),
  LLM_INPUT_USD_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  LLM_OUTPUT_USD_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  AUTOMATION_EXPECTED_INPUT_TOKENS: z.coerce.number().int().positive().default(2_000),
  AUTOMATION_EXPECTED_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1_500),
  IMAGE_PROVIDER: z.enum(["fake", "google"]).default("fake"),
  IMAGE_MODEL: z.string().min(1).default("gemini-3.1-flash-lite-image"),
  GOOGLE_API_KEY: z.string().default(""),
  IMAGE_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(60_000),
  IMAGE_USD_PER_OUTPUT: z.coerce.number().nonnegative().default(0),
  TTS_PROVIDER: z.enum(["fake", "elevenlabs"]).default("fake"),
  TTS_MODEL: z.string().min(1).default("eleven_flash_v2_5"),
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_VOICE_ID: z.string().default(""),
  TTS_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(60_000),
  TTS_USD_PER_THOUSAND_CHARACTERS: z.coerce.number().nonnegative().default(0),
  RENDER_TIMEOUT_MS: z.coerce.number().int().positive().max(1_800_000).default(900_000),
  RENDER_USD_PER_MINUTE: z.coerce.number().nonnegative().default(0),
  SENTRY_DSN: z.string().default(""),
  SENTRY_ENVIRONMENT: z.string().min(1).default("local")
}).superRefine((config, context) => {
  if (config.APP_ENV !== "production" && config.APP_ENV !== "staging") return;
  for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "OAUTH_ENCRYPTION_KEY"] as const) {
    const value = config[name];
    if (value.length < 32 || /^(local|test|ci|acceptance|replace|change)[-_:]/i.test(value) || value.includes("change-me")) {
      context.addIssue({ code: "custom", path: [name], message: "A non-placeholder secret of at least 32 characters is required outside local/test" });
    }
  }
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) context.addIssue({ code: "custom", path: ["JWT_REFRESH_SECRET"], message: "Access and refresh secrets must differ" });
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig =>
  EnvSchema.parse(source);

export type PreflightIssue = { key: string; cause: string; remedy: string; owner: "USER" | "CODEX" };

// The deployment CLI and runtime use the same fail-closed contract. No secret
// values or parser messages containing input values leave this boundary.
export const operationalIssues = (config: AppConfig): PreflightIssue[] => {
  const issues: PreflightIssue[] = [];
  const add = (key: string, cause: string, remedy: string): void => { issues.push({ key, cause, remedy, owner: "USER" }); };
  const deployment = config.APP_ENV === "production" || config.APP_ENV === "staging";
  if (!deployment) return issues;
  if (config.NODE_ENV !== "production") add("NODE_ENV", "Deployment must use production runtime", "Set NODE_ENV=production");
  if (config.APP_ENV === "production" && config.STAGING_FAKE_CANARY) add("STAGING_FAKE_CANARY", "Fake canary is staging-only", "Disable canary in production");
  const canary = config.APP_ENV === "staging" && config.STAGING_FAKE_CANARY;
  const require = (key: keyof AppConfig): void => { if (typeof config[key] === "string" && !String(config[key]).trim()) add(key, "Required setting missing", `Supply ${key} through the deployment secret/config store`); };
  for (const key of ["WEB_BASE_URL", "API_BASE_URL", "PUBLIC_API_BASE_URL"] as const) {
    const url = new URL(config[key]);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) add(key, "Public address must be credential-free HTTPS", "Set the public HTTPS reverse-proxy address");
  }
  const web = new URL(config.WEB_BASE_URL);
  const publicApi = new URL(config.PUBLIC_API_BASE_URL);
  if (web.origin !== publicApi.origin) add("PUBLIC_API_BASE_URL", "This deployment preflight certifies same-origin cookies only", "Use the supplied reverse proxy with API at /api");
  if (config.API_BASE_URL.replace(/\/$/, "") !== config.PUBLIC_API_BASE_URL.replace(/\/$/, "")) add("API_BASE_URL", "OAuth callback base and browser API base differ", "Use the same public API base; register /platform-accounts/<platform>/callback under that base");
  if (canary) {
    for (const key of ["LLM_PROVIDER", "IMAGE_PROVIDER", "TTS_PROVIDER"] as const) if (config[key] !== "fake") add(key, "Fake canary must not call paid providers", "Use fake providers in the isolated canary environment");
    for (const platform of ["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const) if (config[`${platform}_OAUTH_PROVIDER`] !== "fake" || config[`${platform}_ANALYTICS_PROVIDER`] !== "fake") add(`${platform}_OAUTH_PROVIDER`, "Fake canary must not use real SNS accounts", "Use fake OAuth and analytics providers");
  }
  if (config.STORAGE_PROVIDER !== "s3") add("STORAGE_PROVIDER", "Process-local fake storage cannot serve a distributed deployment", "Use persistent S3/MinIO");
  for (const key of ["DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) require(key);
  if (!canary) {
    if (new URL(config.S3_ENDPOINT).protocol !== "https:") add("S3_ENDPOINT", "Signed media URLs must use public HTTPS", "Use externally resolvable S3/MinIO HTTPS DNS reachable by browsers and renderer");
    for (const [selector, real, keys] of [
      ["LLM_PROVIDER", "openai", ["OPENAI_API_KEY", "LLM_MODEL"]],
      ["IMAGE_PROVIDER", "google", ["GOOGLE_API_KEY", "IMAGE_MODEL"]],
      ["TTS_PROVIDER", "elevenlabs", ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "TTS_MODEL"]]
    ] as const) {
      if (config[selector] !== real) add(selector, "Fake results are not production evidence", `Select ${real}; use explicit STAGING_FAKE_CANARY=true only in isolated staging`);
      for (const key of keys) require(key);
    }
    if (config.TOPIC_SOURCE_PROVIDER !== "rss") add("TOPIC_SOURCE_PROVIDER", "Fixture sources are not live input", "Select rss and configure real feeds");
    const feeds = config.TOPIC_SOURCE_FEED_URLS.split(",").map((feed) => feed.trim()).filter(Boolean);
    if (!feeds.length || feeds.some((feed) => { try { const u = new URL(feed); return u.protocol !== "https:" || !!u.username || !!u.password; } catch { return true; } })) add("TOPIC_SOURCE_FEED_URLS", "Valid HTTPS RSS feeds required", "Supply comma-separated real feed URLs");
    for (const key of ["LLM_INPUT_USD_PER_MILLION_TOKENS", "LLM_OUTPUT_USD_PER_MILLION_TOKENS", "IMAGE_USD_PER_OUTPUT", "TTS_USD_PER_THOUSAND_CHARACTERS"] as const) if (config[key] <= 0) add(key, "Provider price is unconfirmed", "Enter your verified contract price before paid work");
  }
  if (config.RENDER_COST_MODE === "priced" && config.RENDER_USD_PER_MINUTE <= 0) add("RENDER_USD_PER_MINUTE", "Render cost is unconfirmed", "Set measured cost or explicitly select RENDER_COST_MODE=free");
  for (const platform of config.ENABLED_PLATFORMS.split(",").map((part) => part.trim())) {
    if (platform === "tiktok" && !canary) { add("ENABLED_PLATFORMS", "TikTok Direct Post is held pending compliant consent UX and app review", "Disable tiktok; produce/export videos and post manually"); continue; }
    if (canary) continue;
    const prefix = platform.toUpperCase() as "YOUTUBE" | "INSTAGRAM";
    const selector = `${prefix}_OAUTH_PROVIDER` as const;
    const analytics = `${prefix}_ANALYTICS_PROVIDER` as const;
    if (config[selector] === "fake" || config[analytics] === "fake") add(selector, "Enabled platform requires real OAuth and analytics", `Configure real ${platform} providers or remove platform from ENABLED_PLATFORMS`);
    require(`${prefix}_CLIENT_ID`); require(`${prefix}_CLIENT_SECRET`);
  }
  return issues;
};

export const assertOperationalConfig = (config: AppConfig): void => {
  const issues = operationalIssues(config);
  if (issues.length) throw new Error(`OPERATIONAL_CONFIG_INVALID: ${issues.map((issue) => issue.key).join(", ")}`);
};

export const assertPlatformEnabled = (config: AppConfig, platform: string): void => {
  if (!config.ENABLED_PLATFORMS.split(",").map((part) => part.trim()).includes(platform.toLowerCase())) throw new Error("PLATFORM_DISABLED");
  if (platform.toLowerCase() === "tiktok" && config.TIKTOK_OAUTH_PROVIDER === "tiktok") throw new Error("TIKTOK_DIRECT_POST_HELD");
};
