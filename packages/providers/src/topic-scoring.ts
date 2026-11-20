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

export type TopicSelectionPolicy = { freshness?: "NEWS" | "EVERGREEN" | "MIXED"; keywordMatch?: "REQUIRED" | "PREFER"; semanticDuplicateThreshold?: number; recentTopicDays?: number };
export function topicSourceAllowed(raw: string, name: string, settings: { allowedSources: readonly string[]; excludedSources: readonly string[] }, discovery = false): boolean {
  try {
    const url = new URL(raw);
    const matches = (source: string, allow: boolean) => {
      if (/^https?:\/\//i.test(source)) { const scope = new URL(source); return url.hostname === scope.hostname && (discovery && allow || url.pathname === scope.pathname || url.pathname.startsWith(scope.pathname.endsWith("/") ? scope.pathname : `${scope.pathname}/`)); }
      return url.hostname === source.toLowerCase() || url.hostname.endsWith(`.${source.toLowerCase()}`) || name.toLowerCase() === source.toLowerCase();
    };
    return !settings.excludedSources.some((source) => matches(source, false)) && (!settings.allowedSources.length || settings.allowedSources.some((source) => matches(source, true)));
  } catch { return false; }
}
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
  if (candidate.reliabilityMetadata?.role === "DISCOVERY") return { ...candidate, canonicalUrl, urlHash: hash(canonicalUrl), contentHash: hash(`${candidate.title}\n${candidate.summary}\n${candidate.body}`),
    suitabilityScore: 0, freshnessScore: 0, reliabilityScore: 0, expectedValueScore: 0,
    components: { channelFit: null, freshness: null, sourceReliability: null, explanationValue: null, visualizability: null, productionCost: null, historicalPerformance: null },
    scoringMethod: "DISCOVERY_ONLY_UNSCORED" as const, rejectionReason: "DISCOVERY_REQUIRES_EVIDENCE" };
  const blocked = ["politics", "medical advice", "financial advice", "legal advice", ...settings.excludedKeywords, ...settings.excludedTopics].find((term) => term && text.includes(term.toLowerCase()));
  const sourceBlocked = !topicSourceAllowed(canonicalUrl, candidate.sourceName, settings);
  const suitabilityScore = settings.keywords.length ? settings.keywords.filter((term) => text.includes(term.toLowerCase())).length / settings.keywords.length : 0.5;
  // Freshness describes publication age, never the date of the historical event.
  const publishedAt = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
  const freshnessScore = Number.isFinite(publishedAt) ? clamp(1 - Math.max(0, now - publishedAt) / (settings.recencyHours * 3_600_000)) : 0.5;
  const reliabilityScore = clamp(candidate.reliabilityScore);
  const curiosityScore = /[?？]|how|why|explai|방법|이유|원리/i.test(candidate.title) ? 1 : 0.5;
  const visualizabilityScore = /rocket|sensor|process|compare|data|space|로켓|센서|과정|비교|우주/i.test(text) ? 1 : 0.5;
  const costScore = candidate.body.length <= 5000 ? 1 : 0.5;
  const components = { channelFit: suitabilityScore, freshness: freshnessScore, sourceReliability: reliabilityScore, explanationValue: curiosityScore, visualizability: visualizabilityScore, productionCost: costScore, historicalPerformance: null };
  const freshness = settings.selectionPolicy?.freshness ?? "NEWS";
  const news = freshness === "NEWS" || (freshness === "MIXED" && candidate.publishedAt !== null && now - Date.parse(candidate.publishedAt) <= settings.recencyHours * 3600000);
  const stale = news && (!candidate.publishedAt || !Number.isFinite(Date.parse(candidate.publishedAt)) || now - Date.parse(candidate.publishedAt) > settings.recencyHours * 3_600_000 || Date.parse(candidate.publishedAt) > now + 300_000);
  return { ...candidate, canonicalUrl, urlHash: hash(canonicalUrl), contentHash: hash(`${candidate.title}\n${candidate.summary}\n${candidate.body}`.toLowerCase().trim()), suitabilityScore, freshnessScore, reliabilityScore,
    components, scoringMethod: "RULE_BASED_NOT_PROBABILITY" as const, expectedValueScore: clamp(suitabilityScore * 0.35 + (news ? freshnessScore : 0.7) * 0.15 + reliabilityScore * 0.2 + curiosityScore * 0.1 + visualizabilityScore * 0.1 + costScore * 0.1),
    rejectionReason: candidate.reliabilityMetadata?.role === "DISCOVERY" ? "DISCOVERY_REQUIRES_EVIDENCE" : blocked ? `Blocked term: ${blocked}` : sourceBlocked ? "SOURCE_NOT_ALLOWED" : stale ? "OUTSIDE_FRESHNESS_POLICY" : settings.keywords.length > 0 && suitabilityScore === 0 && (settings.selectionPolicy?.keywordMatch ?? "REQUIRED") === "REQUIRED" ? "KEYWORD_MISMATCH" : null };
}
