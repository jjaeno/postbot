import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export type ExternalDocument = { url: string; text: string; contentType: string; collectedAt: string };
type Address = { address: string; family: number };
const abortable = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const aborted = () => reject(signal.reason instanceof Error ? signal.reason : new Error("SOURCE_ABORTED"));
  if (signal.aborted) { aborted(); return; }
  signal.addEventListener("abort", aborted, { once: true });
  operation.then((value) => { signal.removeEventListener("abort", aborted); resolve(value); }, (error: unknown) => { signal.removeEventListener("abort", aborted); reject(error instanceof Error ? error : new Error("SOURCE_DNS_FAILED")); });
});
type Transport = (url: URL, address: Address, limit: number, signal: AbortSignal, headers?: Readonly<Record<string, string>>) => Promise<{ status: number; location?: string; contentType: string; body: string }>;

export const isPublicAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(address === "168.63.129.16" || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
  }
  // Accept global unicast only; excludes mapped IPv4, local, multicast, metadata,
  // NAT64 and transition ranges that could otherwise embed private destinations.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:0:|db8:|10:|20:)/i.test(address) && !/^2002:/i.test(address);
};
const transport: Transport = (url, address, limit, signal, headers) => new Promise((resolve, reject) => {
  const req = request(url, { signal, headers: { accept: "application/json, text/html, application/xml, application/rss+xml, application/atom+xml, text/plain", "accept-encoding": "identity", ...headers },
    // Pin the validated address for this request, keeping TLS hostname checks.
    lookup: (_hostname, _options, callback) => callback(null, address.address, address.family) }, (res) => {
    const chunks: Buffer[] = []; let bytes = 0;
    res.on("error", reject);
    res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > limit) { res.destroy(new Error("SOURCE_RESPONSE_TOO_LARGE")); return; } chunks.push(chunk); });
    res.on("end", () => resolve({ status: res.statusCode ?? 0, ...(res.headers.location ? { location: res.headers.location } : {}), contentType: res.headers["content-type"] ?? "", body: Buffer.concat(chunks).toString("utf8") }));
  });
  req.on("error", reject); req.end();
});

export class SafeExternalReader {
  constructor(private readonly options: { hosts: readonly string[]; timeoutMs?: number; maxBytes?: number;
    resolve?: (host: string) => Promise<readonly Address[]>; transport?: Transport; headers?: Readonly<Record<string, string>> }) {}

  async read(rawUrl: string, signal?: AbortSignal): Promise<ExternalDocument> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let url = new URL(rawUrl);
    for (let redirect = 0; redirect <= 3; redirect++) {
      combined.throwIfAborted();
      if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        !this.options.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("SOURCE_URL_NOT_ALLOWED");
      const addresses = await abortable((this.options.resolve ?? ((host) => lookup(host, { all: true })))(url.hostname), combined);
      if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error("SOURCE_PRIVATE_ADDRESS");
      combined.throwIfAborted();
      const response = await (this.options.transport ?? transport)(url, addresses[0]!, this.options.maxBytes ?? 1_000_000, combined, this.options.headers);
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) { url = new URL(response.location, url); continue; }
      if (response.status !== 200) throw new Error(`SOURCE_HTTP_${response.status}`);
      if (!/^(?:application\/(?:json|[\w.+-]*xml)|text\/(?:html|plain|xml))(?:;|$)/i.test(response.contentType)) throw new Error("SOURCE_CONTENT_TYPE_UNSUPPORTED");
      if (Buffer.byteLength(response.body) > (this.options.maxBytes ?? 1_000_000)) throw new Error("SOURCE_RESPONSE_TOO_LARGE");
      return { url: url.href, text: response.body, contentType: response.contentType, collectedAt: new Date().toISOString() };
    }
    throw new Error("SOURCE_REDIRECT_LIMIT");
  }
}
