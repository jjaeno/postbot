import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWebServer, validatePublicApiUrl } from "./server.mjs";

export const start = () => {
  const apiBaseUrl = validatePublicApiUrl(process.env.PUBLIC_API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? "http://localhost:3000");
  if (process.env.APP_ENV === "production" && !process.env.PUBLIC_API_BASE_URL) throw new Error("PUBLIC_API_BASE_URL is required in production");
  const port = Number(process.env.WEB_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("WEB_PORT is invalid");
  return createWebServer({ root: resolve("dist"), apiBaseUrl }).listen(port, "0.0.0.0", () => process.stdout.write(`Postbot web listening on ${port}\n`));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) start();
