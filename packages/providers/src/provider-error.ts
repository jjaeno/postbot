export type ProviderFailureKind = "VALIDATION" | "AUTH" | "RATE_LIMIT" | "TRANSIENT" | "AMBIGUOUS" | "QUALITY" | "BUDGET";
export class ProviderCallError extends Error {
  constructor(readonly kind: ProviderFailureKind, readonly rejected: boolean, readonly retryable: boolean, readonly status: number | null = null, readonly retryAt: Date | null = null) {
    super(`PROVIDER_${kind}${status === null ? "" : `_HTTP_${status}`}`); this.name = "ProviderCallError";
  }
}
export function httpProviderError(response: Pick<Response, "status" | "headers">, now = Date.now()): ProviderCallError {
  const raw = response.headers.get("retry-after");
  const retryTime = raw ? /^\d+$/.test(raw) ? now + Number(raw) * 1000 : Date.parse(raw) : NaN;
  const retryAt = Number.isFinite(retryTime) && retryTime > now && retryTime < 8640000000000000 ? new Date(retryTime) : null;
  if ([401, 403].includes(response.status)) return new ProviderCallError("AUTH", true, false, response.status);
  if (response.status === 402) return new ProviderCallError("BUDGET", true, false, response.status);
  if (response.status === 429) return new ProviderCallError("RATE_LIMIT", true, true, response.status, retryAt);
  if (response.status === 503) return new ProviderCallError("TRANSIENT", true, true, response.status, retryAt);
  if (response.status >= 400 && response.status < 500 && response.status !== 408) return new ProviderCallError("VALIDATION", true, false, response.status);
  return new ProviderCallError("AMBIGUOUS", false, false, response.status);
}
