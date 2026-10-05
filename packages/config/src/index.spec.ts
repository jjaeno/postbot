import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

describe("deployment secret safety", () => {
  it("preserves local/test defaults", () => { expect(loadConfig({ APP_ENV: "test" }).APP_ENV).toBe("test"); });
  it.each(["staging", "production"])("rejects public defaults in %s", (APP_ENV) => { expect(() => loadConfig({ APP_ENV })).toThrow(); });
  it("accepts independent randomly generated deployment secrets", () => { expect(loadConfig({ APP_ENV: "production", JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex"), OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex") }).APP_ENV).toBe("production"); });
  it("rejects shared access and refresh secrets", () => { const key = randomBytes(32).toString("hex"); expect(() => loadConfig({ APP_ENV: "production", JWT_ACCESS_SECRET: key, JWT_REFRESH_SECRET: key, OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex") })).toThrow(); });
});
