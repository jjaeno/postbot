import type { ChannelCollectionProfile } from "@postbot/contracts";
import type { ResearchRequest, ResearchOutcome, TopicSourceCandidate, TopicSourceRequest } from "./index.js";
import { canonicalizeTopicUrl } from "./topic-scoring.js";
import { createHash } from "node:crypto";
const values = (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [];

export const processingLimit = (profile: ChannelCollectionProfile): number => profile.limits.processingCandidates ?? Math.min(400, Math.max(40, profile.limits.targetCandidates * 4));
export const researchQuery = (question: ResearchRequest): string => question.question.normalize("NFKC").trim().slice(0, 1000);
// Deterministic fair sharing first across source families, then queries/feeds.
// Completion order, popularity and YouTube statistics never affect this order.
export function fairCandidatePool(candidates: readonly TopicSourceCandidate[], limit: number): TopicSourceCandidate[] {
  const unique = new Map<string, TopicSourceCandidate>();
  for (const candidate of candidates) {
    let key: string; try { key = canonicalizeTopicUrl(candidate.url); } catch { continue; }
    const previous = unique.get(key);
    const requests = [...new Map([...values(previous?.reliabilityMetadata?.researchRequests), ...values(candidate.reliabilityMetadata?.researchRequests)].map((entry) => [JSON.stringify(entry), entry])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);
    const identity = (item: TopicSourceCandidate) => `${item.reliabilityMetadata?.contentScope === "FULL_TEXT" ? "0" : "1"}:${item.sourceName}:${item.sourceKind}:${item.title}:${item.body}:${item.summary}:${item.url}`;
    const winner = previous && identity(previous).localeCompare(identity(candidate)) <= 0 ? previous : candidate;
    const discoveryUrls = [...new Set([...(Array.isArray(previous?.reliabilityMetadata?.discoveryUrls) ? previous.reliabilityMetadata.discoveryUrls.filter((url): url is string => typeof url === "string") : []), ...(typeof previous?.reliabilityMetadata?.discoveryUrl === "string" ? [previous.reliabilityMetadata.discoveryUrl] : []), ...(typeof candidate.reliabilityMetadata?.discoveryUrl === "string" ? [candidate.reliabilityMetadata.discoveryUrl] : [])])].sort();
    unique.set(key, { ...winner, reliabilityMetadata: { ...winner.reliabilityMetadata, researchRequests: requests, ...(discoveryUrls.length ? { discoveryUrls, discoveryUrl: discoveryUrls[0] } : {}) } });
  }
  const families = new Map<string, Map<string, TopicSourceCandidate[]>>();
  for (const candidate of unique.values()) {
    const family = typeof candidate.reliabilityMetadata?.sourceFamily === "string" ? candidate.reliabilityMetadata.sourceFamily : candidate.sourceName === "YouTube" ? "YOUTUBE" : candidate.sourceKind === "RSS" ? "RSS" : candidate.sourceName;
    const query = typeof candidate.reliabilityMetadata?.searchQuery === "string" ? candidate.reliabilityMetadata.searchQuery : typeof candidate.reliabilityMetadata?.feedUrl === "string" ? candidate.reliabilityMetadata.feedUrl : candidate.sourceName;
    if (!families.has(family)) families.set(family, new Map());
    const groups = families.get(family)!; if (!groups.has(query)) groups.set(query, []); groups.get(query)!.push(candidate);
  }
  const queues = [...families].sort(([a], [b]) => a.localeCompare(b)).map(([, queries]) => {
    const groups = [...queries].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => values.sort((a, b) => a.url.localeCompare(b.url)));
    const queue: TopicSourceCandidate[] = []; while (groups.some((group) => group.length)) for (const group of groups) { const item = group.shift(); if (item) queue.push(item); } return queue;
  });
  const output: TopicSourceCandidate[] = []; const seen = new Set<string>();
  while (output.length < limit && queues.some((queue) => queue.length)) for (const queue of queues) {
    const item = queue.shift(); if (!item) continue;
    let key: string; try { key = canonicalizeTopicUrl(item.url); } catch { continue; }
    if (!seen.has(key) && output.length < limit) { output.push(item); seen.add(key); }
  }
  return output;
}
const questionTerms = (question: string): string[] => [...new Set(question.normalize("NFKC").toLowerCase().replace(/(?:했는가|했을까|하는가|만들었는가|무엇인가|왜|어떻게|무엇|인가|는가|었는가|\?)/gu, " ").split(/[^\p{L}\p{N}]+/u).map((term) => term.replace(/(?:에서는|에게|에서|으로|인은|이란|은|는|을|를|의|이|가)$/u, "")).filter((term) => term.length > 1 && !["why", "how", "what", "when", "where", "does", "did", "the", "was", "were", "and"].includes(term)))];
export function assessResearch(question: ResearchRequest, candidates: readonly TopicSourceCandidate[], context?: TopicSourceRequest["researchContext"]): ResearchOutcome {
  const terms = questionTerms(question.question); const causal = /왜|why|cause|원인|reason/i.test(question.question);
  const sources = candidates.flatMap((candidate): Record<string, unknown>[] => {
    const metadata = candidate.reliabilityMetadata;
    const searches = values(metadata?.researchRequests);
    if (!searches.some((entry) => entry && typeof entry === "object" && "questionId" in entry && entry.questionId === question.id)) return [];
    const body = candidate.body.normalize("NFKC").slice(0, 10000); const lower = body.toLowerCase();
    if (!terms.length || !terms.every((term) => lower.includes(term))) return [];
    if (context?.exclusions.some((term) => term && `${candidate.title} ${body}`.toLowerCase().includes(term.toLowerCase()))) return [];
    const sentences = body.split(/(?<=[.!?。])\s+|\n+/u);
    const quote = sentences.find((line) => terms.every((term) => line.toLowerCase().includes(term)) && (!causal || /because|due to|caus|reason|because|때문|원인|위해|위한|목적|이유/i.test(line)));
    const full = metadata?.contentScope === "FULL_TEXT";
    const conflict = /contradict|disput|conflict|not because|not due to|반박|반증|상충|논쟁|아니|않았|확정할 수 없/i.test(body);
    return [{ url: candidate.url, contentScope: metadata?.contentScope ?? "UNKNOWN", relationship: conflict ? "COUNTEREVIDENCE_OR_CONFLICT_REQUIRES_REVIEW" : quote && full ? "ANSWER_EVIDENCE_AVAILABLE" : "MATERIAL_FOUND", claim: question.question, quote: quote ?? null, start: quote ? body.indexOf(quote) : null, end: quote ? body.indexOf(quote) + quote.length : null, offsetBasis: "NFKC_NORMALIZED_SOURCE_TEXT", textSnapshot: body.slice(0, 10000), fingerprint: createHash("sha256").update(body).digest("hex"), requestTrace: searches.filter((entry) => entry && typeof entry === "object" && "questionId" in entry && entry.questionId === question.id), verification: "CLAIM_VERIFICATION_REQUIRED", untrustedExternalData: true }];
  }).slice(0, 8);
  const conflict = sources.some((source) => source.relationship === "COUNTEREVIDENCE_OR_CONFLICT_REQUIRES_REVIEW");
  const answer = sources.some((source) => source.relationship === "ANSWER_EVIDENCE_AVAILABLE");
  return { questionId: question.id, question: question.question, subtopic: question.subtopic, origin: question.origin, query: researchQuery(question), sources,
    state: conflict ? "CONFLICTING_EVIDENCE" : answer ? "ANSWER_EVIDENCE_AVAILABLE" : sources.length ? "MATERIAL_FOUND" : "INSUFFICIENT_EVIDENCE",
    reason: conflict ? "SOURCE_CONFLICT_REQUIRES_REVIEW" : answer ? "CLAIM_VERIFICATION_REQUIRED" : sources.length ? "MATERIAL_IS_NOT_A_VERIFIED_ANSWER" : "NO_QUESTION_SPECIFIC_EVIDENCE" };
}
