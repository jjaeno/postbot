import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertPlatformEnabled, loadConfig, operationalIssues } from "./index.js";

const deployment = () => loadConfig({ APP_ENV: "production", NODE_ENV: "production", ENABLED_PLATFORMS: "youtube", S3_ENDPOINT: "https://media.postbot.example", WEB_BASE_URL: "https://postbot.example", API_BASE_URL: "https://postbot.example/api", PUBLIC_API_BASE_URL: "https://postbot.example/api", JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex"), OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex"), LLM_PROVIDER: "openai", OPENAI_API_KEY: "contract-test", IMAGE_PROVIDER: "google", GOOGLE_API_KEY: "contract-test", TTS_PROVIDER: "elevenlabs", ELEVENLABS_API_KEY: "contract-test", ELEVENLABS_VOICE_ID: "contract-voice", TOPIC_SOURCE_PROVIDER: "rss", TOPIC_SOURCE_FEED_URLS: "https://source.example/rss", LLM_INPUT_USD_PER_MILLION_TOKENS: "1", LLM_OUTPUT_USD_PER_MILLION_TOKENS: "1", IMAGE_USD_PER_OUTPUT: "1", TTS_USD_PER_THOUSAND_CHARACTERS: "1", RENDER_COST_MODE: "free", YOUTUBE_OAUTH_PROVIDER: "google", YOUTUBE_CLIENT_ID: "contract-test", YOUTUBE_CLIENT_SECRET: "contract-test", YOUTUBE_ANALYTICS_PROVIDER: "youtube" });

describe("operational preflight", () => {
  it("allows YouTube-only configuration without disabled platform credentials", () => { expect(operationalIssues(deployment())).toEqual([]); });
  it("fails production Fake, fixture, zero prices and cross-origin configuration without leaking values", () => {
    const config = { ...deployment(), OPENAI_API_KEY: "private-value-never-print", LLM_PROVIDER: "fake" as const, TOPIC_SOURCE_PROVIDER: "fixture" as const, IMAGE_USD_PER_OUTPUT: 0, PUBLIC_API_BASE_URL: "https://other.example/api" };
    const issues = operationalIssues(config);
    expect(issues.map((issue) => issue.key)).toEqual(expect.arrayContaining(["LLM_PROVIDER", "TOPIC_SOURCE_PROVIDER", "IMAGE_USD_PER_OUTPUT", "PUBLIC_API_BASE_URL"]));
    expect(JSON.stringify(issues)).not.toContain(config.OPENAI_API_KEY);
  });
  it("marks explicit staging canary and rejects it in production", () => {
    const config = { ...deployment(), APP_ENV: "staging" as const, STAGING_FAKE_CANARY: true, LLM_PROVIDER: "fake" as const, IMAGE_PROVIDER: "fake" as const, TTS_PROVIDER: "fake" as const, YOUTUBE_OAUTH_PROVIDER: "fake" as const, YOUTUBE_ANALYTICS_PROVIDER: "fake" as const, ENABLED_PLATFORMS: "youtube,instagram,tiktok" };
    expect(operationalIssues(config)).toEqual([]);
    expect(operationalIssues({ ...config, APP_ENV: "production" }).some((issue) => issue.key === "STAGING_FAKE_CANARY")).toBe(true);
  });
  it("rejects disabled platforms and real TikTok before external calls", () => {
    expect(() => assertPlatformEnabled(deployment(), "INSTAGRAM")).toThrow("PLATFORM_DISABLED");
    expect(() => assertPlatformEnabled({ ...deployment(), ENABLED_PLATFORMS: "tiktok", TIKTOK_OAUTH_PROVIDER: "tiktok" }, "TIKTOK")).toThrow("TIKTOK_DIRECT_POST_HELD");
  });
  it("distinguishes zero/unconfirmed render prices from explicit free rendering", () => {
    expect(operationalIssues({ ...deployment(), RENDER_COST_MODE: "priced" }).some((issue) => issue.key === "RENDER_USD_PER_MINUTE")).toBe(true);
  });
});
