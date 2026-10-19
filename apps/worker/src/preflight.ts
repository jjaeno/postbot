import "dotenv/config";
import { randomUUID } from "node:crypto";
import { loadConfig, operationalIssues, type PreflightIssue } from "@postbot/config";
import { createPrismaClient } from "@postbot/database";
import { createRedisConnection } from "@postbot/jobs";
import { S3StorageProvider } from "@postbot/providers";

const failures: PreflightIssue[] = [];
let config: ReturnType<typeof loadConfig> | undefined;
try { config = loadConfig(); } catch {
  failures.push({ key: "ENV_SCHEMA", cause: "Environment schema or deployment secret validation failed", remedy: "Check .env.example types and independent non-placeholder secrets of at least 32 characters", owner: "USER" });
}
if (config) failures.push(...operationalIssues(config));
const mode = config?.APP_ENV === "staging" && config.STAGING_FAKE_CANARY ? "STAGING_FAKE_CANARY" : config?.APP_ENV === "production" ? "PRODUCTION_CONFIG_ONLY" : "NON_PRODUCTION";
process.stdout.write(JSON.stringify({ check: "configuration", mode, status: failures.length ? "FAIL" : "PASS", issues: failures }) + "\n");
if (config && !failures.length && process.argv.includes("--network")) {
  const timeout = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DEPENDENCY_TIMEOUT")), 10_000);
    work.then(resolve, reject).finally(() => clearTimeout(timer)).catch(() => undefined);
  });
  const probes: Array<[string, () => Promise<void>]> = [
    ["DATABASE_URL", async () => { const db = createPrismaClient(); try { await timeout(db.$queryRaw`SELECT 1`); } finally { await db.$disconnect(); } }],
    ["REDIS_URL", async () => { const redis = createRedisConnection(config.REDIS_URL); redis.on("error", () => undefined); try { await timeout(redis.ping()); } finally { redis.disconnect(); } }],
    ["S3_ENDPOINT", async () => {
      const storage = new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY });
      const key = `_preflight/${randomUUID()}`;
      try { await timeout(storage.upload({ key, body: new Uint8Array([1, 2, 3]), mimeType: "application/octet-stream" })); await timeout(storage.download(key)); }
      finally { await timeout(storage.delete(key)); }
    }]
  ];
  for (const [key, probe] of probes) {
    try { await probe(); process.stdout.write(JSON.stringify({ check: "network", key, status: "PASS" }) + "\n"); }
    catch { failures.push({ key, cause: "Dependency connectivity/access probe failed", remedy: "Check DNS, credentials, firewall and read/write/delete access; remove orphan _preflight objects if cleanup failed", owner: "USER" }); }
  }
}
if (process.argv.includes("--network")) process.stdout.write(JSON.stringify({ check: "network-summary", status: failures.length ? "FAIL" : "PASS", issues: failures }) + "\n");
process.exitCode = failures.length ? 1 : 0;
