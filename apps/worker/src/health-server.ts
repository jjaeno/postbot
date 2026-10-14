import { createServer, type Server } from "node:http";

export const startWorkerHealthServer = (probe: () => Promise<boolean>, port = 3002): Server => {
  let stopping = false;
  let pending: Promise<boolean> | null = null;
  const server = createServer((request, response) => {
    if (request.url !== "/ready" && request.url !== "/health") { response.writeHead(404).end(); return; }
    const timer = setTimeout(() => { if (!response.writableEnded) response.writeHead(503).end("DEPENDENCY_TIMEOUT"); }, 4_000);
    pending ??= probe().finally(() => { pending = null; });
    void pending.then((healthy) => {
      if (!response.writableEnded) response.writeHead(healthy && !stopping ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ status: healthy && !stopping ? "ready" : "unavailable", heartbeatAt: new Date().toISOString() }));
    }, () => { if (!response.writableEnded) response.writeHead(503).end("DEPENDENCY_UNAVAILABLE"); }).finally(() => clearTimeout(timer));
  });
  server.on("close", () => { stopping = true; });
  return server.listen(port, "0.0.0.0");
};
