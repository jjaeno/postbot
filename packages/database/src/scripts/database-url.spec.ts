import { describe, expect, it } from "vitest";
import { getTestDatabaseName, getTestDatabaseUrl } from "./database-url.js";

describe("dedicated test database URLs", () => {
  it("adds the safety suffix once for regular databases", () => { expect(getTestDatabaseName("mysql://localhost/postbot")).toBe("postbot_test"); });
  it("keeps already isolated database names idempotently", () => { expect(getTestDatabaseName("mysql://localhost/postbot_test")).toBe("postbot_test"); expect(new URL(getTestDatabaseUrl("mysql://localhost/postbot_test")).pathname).toBe("/postbot_test"); });
  it("rejects URLs without a database", () => { expect(() => getTestDatabaseUrl("mysql://localhost/")).toThrow("database name"); });
});
