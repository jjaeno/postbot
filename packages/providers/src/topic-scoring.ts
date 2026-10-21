import { createHash } from "node:crypto";
import type { TopicSourceCandidate } from "./index.js";

export const canonicalizeTopicUrl = (raw: string): string => {
  const url = new URL(raw); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid"].includes(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort(); url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
};
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export function scoreTopicCandidate(candidate: TopicSourceCandidate, settings: {
  keywords: readonly string[]; excludedKeywords: readonly string[]; excludedTopics: readonly string[];
  allowedSources: readonly string[]; excludedSources: readonly string[]; recencyHours: number;
}, now = Date.now()) {
  const text = `${candidate.title} ${candidate.summary} ${candidate.body}`.toLowerCase();
  const canonicalUrl = canonicalizeTopicUrl(candidate.url);
  const host = new URL(canonicalUrl).hostname;
  const sourceMatches = (source: string): boolean => {
    if (/^https?:\/\//i.test(source)) {
      const allowed = new URL(source);
      return host === allowed.hostname && (new URL(canonicalUrl).pathname === allowed.pathname || new URL(canonicalUrl).pathname.startsWith(allowed.pathname.endsWith("/") ? allowed.pathname : `${allowed.pathname}/`));
    }
    return host === source.toLowerCase() || host.endsWith(`.${source.toLowerCase()}`) || candidate.sourceName.toLowerCase() === source.toLowerCase();
  };
  const blocked = ["politics", "medical advice", "financial advice", "legal advice", ...settings.excludedKeywords, ...settings.excludedTopics].find((term) => term && text.includes(term.toLowerCase()));
  const sourceBlocked = settings.excludedSources.some(sourceMatches) || (settings.allowedSources.length > 0 && !settings.allowedSources.some(sourceMatches));
  const suitabilityScore = settings.keywords.length ? settings.keywords.filter((term) => text.includes(term.toLowerCase())).length / settings.keywords.length : 0.5;
  // Freshness describes publication age, never the date of the historical event.
  const freshnessScore = candidate.publishedAt ? clamp(1 - Math.max(0, now - new Date(candidate.publishedAt).getTime()) / (settings.recencyHours * 3_600_000)) : 0.5;
  const reliabilityScore = clamp(candidate.reliabilityScore);
  return { ...candidate, canonicalUrl, urlHash: hash(canonicalUrl), contentHash: hash(`${candidate.title}\n${candidate.summary}\n${candidate.body}`.toLowerCase().trim()), suitabilityScore, freshnessScore, reliabilityScore,
    expectedValueScore: clamp(suitabilityScore * 0.4 + freshnessScore * 0.25 + reliabilityScore * 0.25 + 0.1),
    rejectionReason: blocked ? `Blocked term: ${blocked}` : sourceBlocked ? "SOURCE_NOT_ALLOWED" : null };
}
