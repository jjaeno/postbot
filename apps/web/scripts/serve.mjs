import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("dist");
const port = Number(process.env.WEB_PORT ?? 5173);
const types = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"], [".woff2", "font/woff2"]]);

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relative = normalize(pathname).replace(/^(?:\.\.[/\\])+|^[/\\]+/u, "");
  let path = resolve(join(root, relative));
  if (!path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`) && path !== root) {
    response.writeHead(400).end("Bad request");
    return;
  }
  try {
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
  } catch {
    path = join(root, "index.html");
  }
  response.setHeader("content-type", `${types.get(extname(path)) ?? "application/octet-stream"}; charset=utf-8`);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("cache-control", path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
  createReadStream(path).on("error", () => response.writeHead(404).end("Not found")).pipe(response);
}).listen(port, "0.0.0.0", () => process.stdout.write(`Postbot web listening on ${port}\n`));
