import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const types = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"], [".woff2", "font/woff2"]]);
export const validatePublicApiUrl = (value) => {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Public API URL must be an HTTP(S) URL without credentials, query or fragment");
  return url.toString().replace(/\/$/, "");
};
const contained = (root, path) => { const child = relative(root, path); return child === "" || (!child.startsWith("..") && !isAbsolute(child)); };

export const createWebServer = ({ root, apiBaseUrl }) => {
  const directory = resolve(root);
  const publicUrl = validatePublicApiUrl(apiBaseUrl);
  const handle = async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    if (!["GET", "HEAD"].includes(request.method)) { response.setHeader("allow", "GET, HEAD"); response.writeHead(405).end(); return; }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (pathname.includes("\0") || pathname.includes("\\")) throw new Error("Invalid path");
    } catch { response.writeHead(400).end("Bad request"); return; }
    if (pathname === "/runtime-config.js") {
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(request.method === "HEAD" ? undefined : `window.__POSTBOT_CONFIG__=${JSON.stringify({ apiBaseUrl: publicUrl }).replace(/</g, "\\u003c")};`);
      return;
    }
    let path = resolve(directory, `.${pathname}`);
    if (!contained(directory, path)) { response.writeHead(400).end("Bad request"); return; }
    try {
      if (!contained(await realpath(directory), await realpath(path))) { response.writeHead(400).end("Bad request"); return; }
      if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    }
    catch {
      if (pathname.startsWith("/assets/") || extname(pathname)) { response.writeHead(404).end("Not found"); return; }
      path = join(directory, "index.html");
    }
    try {
      const [resolvedRoot, resolvedFile] = await Promise.all([realpath(directory), realpath(path)]);
      if (!contained(resolvedRoot, resolvedFile)) { response.writeHead(400).end("Bad request"); return; }
      const info = await stat(resolvedFile);
      if (!info.isFile()) { response.writeHead(404).end("Not found"); return; }
      response.setHeader("content-type", `${types.get(extname(path)) ?? "application/octet-stream"}; charset=utf-8`);
      response.setHeader("content-length", info.size);
      response.setHeader("cache-control", path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
      if (request.method === "HEAD") { response.end(); return; }
      const stream = createReadStream(resolvedFile);
      stream.on("error", () => { if (!response.headersSent) response.writeHead(404).end("Not found"); else response.destroy(); });
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch { response.writeHead(404).end("Not found"); }
  };
  return createServer((request, response) => { void handle(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end("Request failed"); else response.destroy(); }); });
};
