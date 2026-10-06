import { describe, expect, it, vi } from "vitest";
import { createSessionFetch } from "./session-fetch";

describe("expired browser sessions", () => {
  it("shares rotation and retries with the new CSRF token", async () => {
    let token = "old";
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => Promise.resolve(new Response(null, { status: new Headers(init?.headers).get("x-csrf-token") === "old" ? 401 : 200 })));
    const refresh = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); token = "new"; });
    const expired = vi.fn();
    const request = createSessionFetch(refresh, expired, fetcher);
    const init = () => ({ headers: { "x-csrf-token": token } });
    expect((await Promise.all([request("/content", init), request("/channels", init)])).map((result) => result.status)).toEqual([200, 200]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(expired).not.toHaveBeenCalled();
  });
  it("does not rotate on failed login and clears cached user data on failed rotation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const refresh = vi.fn(() => Promise.reject(new Error("Expired refresh")));
    const expired = vi.fn();
    const request = createSessionFetch(refresh, expired, fetcher);
    await request("/auth/login", () => ({}), false);
    expect(refresh).not.toHaveBeenCalled();
    await request("/content", () => ({}));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
