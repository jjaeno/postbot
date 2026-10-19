import type { Express } from "express";
import { isIPv4 } from "node:net";

// The production Compose ingress network assigns one fixed IPv4 address to Caddy.
// Neither arbitrary private networks nor forwarded hop counts are trusted.
export const configureTrustedProxy = (app: Express, proxyIp = process.env.API_TRUSTED_PROXY): void => {
  if (!proxyIp) {
    app.set("trust proxy", false);
    return;
  }
  if (!isIPv4(proxyIp)) throw new Error("API_TRUSTED_PROXY must be a single IPv4 address");
  app.set("trust proxy", (address: string, hop: number) =>
    hop === 0 && (address === proxyIp || address === `::ffff:${proxyIp}`));
};
