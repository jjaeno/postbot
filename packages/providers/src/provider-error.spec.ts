import { describe, expect, it } from "vitest";
import { httpProviderError } from "./provider-error.js";
describe("provider failure classification", () => {
  it("separates rejection from ambiguous server results and honors Retry-After", () => {
    const now = Date.parse("2026-11-18T00:00:00Z");
    const error = (status: number, retry?: string) => httpProviderError({ status, headers: new Headers(retry ? { "retry-after": retry } : {}) }, now);
    expect(error(400)).toMatchObject({ kind: "VALIDATION", rejected: true, retryable: false });
    expect(error(401)).toMatchObject({ kind: "AUTH", rejected: true, retryable: false });
    expect(error(429, "120")).toMatchObject({ kind: "RATE_LIMIT", retryAt: new Date(now + 120000) });
    expect(error(503, "Wed, 18 Nov 2026 00:05:00 GMT")).toMatchObject({ kind: "TRANSIENT", rejected: true, retryAt: new Date(now + 300000) });
    expect(error(500)).toMatchObject({ kind: "AMBIGUOUS", rejected: false, retryable: false });
    expect(error(504)).toMatchObject({ kind: "AMBIGUOUS", rejected: false });
  });
});
