import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { startWorkerHealthServer } from "./health-server.js";

describe("worker readiness", () => {
  it("reports live workers and dependency failures independently of render completion time", async () => {
    let healthy = true;
    const server = startWorkerHealthServer(() => Promise.resolve(healthy), 0);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_MISSING");
    const url = `http://127.0.0.1:${address.port}/ready`;
    try { expect((await fetch(url)).status).toBe(200); healthy = false; expect((await fetch(url)).status).toBe(503); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
