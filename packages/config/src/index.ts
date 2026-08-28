import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
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
  JWT_ACCESS_SECRET: z.string().min(16).default("local-access-secret-change-me"),
  JWT_REFRESH_SECRET: z.string().min(16).default("local-refresh-secret-change-me"),
  OAUTH_ENCRYPTION_KEY: z.string().min(16).default("local-oauth-encryption-key-change-me"),
  LLM_PROVIDER: z.enum(["fake", "openai"]).default("fake"),
  LLM_MODEL: z.string().min(1).default("gpt-5-mini"),
  IMAGE_PROVIDER: z.enum(["fake", "google"]).default("fake"),
  IMAGE_MODEL: z.string().min(1).default("gemini-3.1-flash-lite-image"),
  TTS_PROVIDER: z.enum(["fake", "elevenlabs"]).default("fake"),
  TTS_MODEL: z.string().min(1).default("eleven_flash_v2_5")
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig =>
  EnvSchema.parse(source);
