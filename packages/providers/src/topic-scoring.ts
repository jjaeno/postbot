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

export type TopicSelectionPolicy = { freshness?: "NEWS" | "EVERGREEN"; keywordMatch?: "REQUIRED" | "PREFER"; semanticDuplicateThreshold?: number; recentTopicDays?: number };
export const topicTokens = (text: string): Set<string> => new Set(text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/u).filter((word) => word.length > 1 && !["the", "a", "an", "and", "of", "to", "in", "for", "with", "new", "news"].includes(word)));
export const topicSimilarity = (left: string, right: string): number => {
  const a = topicTokens(left); const b = topicTokens(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared < 2 && (a.size > 1 || b.size > 1) ? 0 : shared / (a.size + b.size - shared);
};

export function scoreTopicCandidate(candidate: TopicSourceCandidate, settings: {
  selectionPolicy?: TopicSelectionPolicy; keywords: readonly string[]; excludedKeywords: readonly string[]; excludedTopics: readonly string[];
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
  const publishedAt = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
  const freshnessScore = Number.isFinite(publishedAt) ? clamp(1 - Math.max(0, now - publishedAt) / (settings.recencyHours * 3_600_000)) : 0.5;
  const reliabilityScore = clamp(candidate.reliabilityScore);
  const curiosityScore = /[?？]|how|why|explai|방법|이유|원리/i.test(candidate.title) ? 1 : 0.5;
  const visualizabilityScore = /rocket|sensor|process|compare|data|space|로켓|센서|과정|비교|우주/i.test(text) ? 1 : 0.5;
  const costScore = candidate.body.length <= 5000 ? 1 : 0.5;
  const components = { channelFit: suitabilityScore, freshness: freshnessScore, sourceReliability: reliabilityScore, explanationValue: curiosityScore, visualizability: visualizabilityScore, productionCost: costScore, historicalPerformance: null };
  const news = (settings.selectionPolicy?.freshness ?? "NEWS") === "NEWS";
  const stale = news && (!candidate.publishedAt || !Number.isFinite(Date.parse(candidate.publishedAt)) || now - Date.parse(candidate.publishedAt) > settings.recencyHours * 3_600_000 || Date.parse(candidate.publishedAt) > now + 300_000);
  return { ...candidate, canonicalUrl, urlHash: hash(canonicalUrl), contentHash: hash(`${candidate.title}\n${candidate.summary}\n${candidate.body}`.toLowerCase().trim()), suitabilityScore, freshnessScore, reliabilityScore,
    components, scoringMethod: "RULE_BASED_NOT_PROBABILITY" as const, expectedValueScore: clamp(suitabilityScore * 0.35 + (news ? freshnessScore : 0.7) * 0.15 + reliabilityScore * 0.2 + curiosityScore * 0.1 + visualizabilityScore * 0.1 + costScore * 0.1),
    rejectionReason: blocked ? `Blocked term: ${blocked}` : sourceBlocked ? "SOURCE_NOT_ALLOWED" : stale ? "OUTSIDE_FRESHNESS_POLICY" : settings.keywords.length > 0 && suitabilityScore === 0 && (settings.selectionPolicy?.keywordMatch ?? "REQUIRED") === "REQUIRED" ? "KEYWORD_MISMATCH" : null };
}
