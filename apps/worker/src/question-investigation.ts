import { assessResearch, canonicalizeTopicUrl, fairCandidatePool, researchQuery, sourceDigest, sourceRecord, type ResearchRequest, type TopicSourceCandidate, type TopicSourceRequest } from "@postbot/providers";
import type { ChannelCollectionProfile } from "@postbot/contracts";
import { z } from "zod";
const ResumeCandidate = z.object({ title: z.string().max(255), summary: z.string().max(2000), body: z.string().max(10000), url: z.string().url().refine((url) => new URL(url).protocol === "https:"), sourceName: z.string(), sourceKind: z.enum(["NEWS", "OFFICIAL", "PAPER", "RSS", "PUBLIC_DATA", "MANUAL"]), publishedAt: z.string().nullable(), reliabilityScore: z.number(), reliabilityMetadata: z.record(z.string(), z.unknown()).optional() });
const list = (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [];
export const questionIds = (candidate: TopicSourceCandidate): string[] => list(candidate.reliabilityMetadata?.researchRequests).map(sourceRecord).flatMap((entry) => typeof entry.questionId === "string" ? [entry.questionId] : []);
const key = (candidate: TopicSourceCandidate) => sourceDigest({ url: canonicalizeTopicUrl(candidate.url), body: candidate.body, summary: candidate.summary });
type Attempt = { key: string; url: string; state: string; reason: string };
export class QuestionInvestigation {
  private readonly work = new Map<string, { question: ResearchRequest; signature: string; attempts: Map<string, Attempt>; attempted: number; enriched: number; seen: Set<string>; processed: Set<string>; limited: boolean; candidates: Map<string, TopicSourceCandidate>; requiresSearch: boolean; sources: Record<string, unknown>[] }>();
  constructor(private readonly request: TopicSourceRequest, profile: ChannelCollectionProfile) {
    for (const question of (request.researchQuestions ?? []).slice(0, 5)) {
      const signature = sourceDigest({ question: question.question, subtopic: question.subtopic, context: request.researchContext ?? null, sources: profile.sources, allowed: request.allowedSources, excluded: request.excludedSources });
      const progress = sourceRecord(question.progress);
      const attempts = question.status !== "INVESTIGATE" && progress.signature === signature ? list(progress.attempts).map(sourceRecord).flatMap((entry): Attempt[] => typeof entry.key === "string" && typeof entry.url === "string" && typeof entry.state === "string" && typeof entry.reason === "string" ? [{ key: entry.key, url: entry.url, state: entry.state, reason: entry.reason }] : []) : [];
      const resumable = question.status !== "INVESTIGATE" && progress.signature === signature;
      const pending = resumable ? list(progress.pendingCandidates).slice(0, 2).flatMap((value) => { const parsed = ResumeCandidate.safeParse(value); return parsed.success ? [parsed.data] : []; }) : [];
      this.work.set(question.id, { question, signature, attempts: new Map(attempts.map((attempt) => [attempt.key, attempt])), attempted: 0, enriched: 0, seen: new Set(), processed: new Set(), limited: false, candidates: new Map(pending.map((candidate) => [key(candidate), candidate])), requiresSearch: resumable && progress.requiresSearch === true, sources: resumable ? list(progress.sources).map(sourceRecord) : [] });
    }
  }
  resume(id: string): TopicSourceCandidate[] { return [...(this.work.get(id)?.candidates.values() ?? [])]; }
  pending(candidate: TopicSourceCandidate): boolean {
    return questionIds(candidate).some((id) => { const work = this.work.get(id); return work && work.attempts.get(key(candidate))?.state !== "COMPLETED"; });
  }
  pool(candidates: TopicSourceCandidate[], limit: number): TopicSourceCandidate[] {
    const all = fairCandidatePool(candidates, candidates.length);
    for (const candidate of all) for (const id of questionIds(candidate)) { const work = this.work.get(id); work?.seen.add(key(candidate)); work?.candidates.set(key(candidate), candidate); }
    const chosen = new Set<TopicSourceCandidate>();
    // Two finite rounds per question, with source/query round-robin inherited from the pool.
    for (let round = 0; round < 2; round++) for (const [id, work] of this.work) {
      const next = all.find((candidate) => questionIds(candidate).includes(id) && work.attempts.get(key(candidate))?.state !== "COMPLETED" && !chosen.has(candidate));
      if (next && chosen.size < limit) chosen.add(next);
    }
    for (const candidate of all) if (chosen.size < limit) chosen.add(candidate);
    return all.filter((candidate) => chosen.has(candidate));
  }
  claim(candidate: TopicSourceCandidate, selectedIds: Set<string>): string[] {
    const ids: string[] = [];
    for (const id of questionIds(candidate)) {
      const work = this.work.get(id); if (!work || !selectedIds.has(id)) continue;
      const attempt = work.attempts.get(key(candidate));
      if (attempt?.state === "COMPLETED") { work.processed.add(key(candidate)); continue; }
      if (work.attempted >= 2) { work.limited = true; continue; }
      work.attempted++; work.processed.add(key(candidate)); ids.push(id);
    }
    return ids;
  }
  record(original: TopicSourceCandidate, candidate: TopicSourceCandidate, ids: string[]) {
    const metadata = candidate.reliabilityMetadata;
    const failures = list(metadata?.researchFailures).map(sourceRecord);
    const reason = typeof metadata?.evidenceFailure === "string" ? metadata.evidenceFailure : failures.find((entry) => typeof entry.code === "string")?.code ?? metadata?.researchState ?? "ORIGINAL_NOT_CONFIGURED_OR_UNAVAILABLE";
    const completed = metadata?.contentScope === "FULL_TEXT" && !metadata.evidenceFailure;
    for (const id of ids) {
      const work = this.work.get(id)!; if (completed) work.enriched++;
      work.attempts.set(key(original), { key: key(original), url: original.url, state: completed ? "COMPLETED" : "RETRY_PENDING", reason: completed ? "ORIGINAL_EXAMINED_CLAIMS_STILL_REQUIRE_REVIEW" : typeof reason === "string" ? reason : "ORIGINAL_UNAVAILABLE" });
    }
  }
  outcomes(candidates: TopicSourceCandidate[], failures: readonly { source: string; code: string }[], processingStopped: boolean, selectedIds: Set<string>, searchedIds: Set<string>) {
    return [...this.work.values()].map((work) => {
      const outcome = assessResearch(work.question, candidates, this.request.researchContext);
      outcome.sources = [...new Map([...work.sources, ...outcome.sources].map((source) => [`${String(source.url)}:${String(source.fingerprint)}`, source])).values()].slice(-8);
      outcome.state = outcome.sources.some((source) => source.relationship === "COUNTEREVIDENCE_OR_CONFLICT_REQUIRES_REVIEW") ? "CONFLICTING_EVIDENCE" : outcome.sources.some((source) => source.relationship === "ANSWER_EVIDENCE_AVAILABLE") ? "ANSWER_EVIDENCE_AVAILABLE" : outcome.sources.length ? "MATERIAL_FOUND" : "INSUFFICIENT_EVIDENCE";
      outcome.reason = outcome.state === "CONFLICTING_EVIDENCE" ? "SOURCE_CONFLICT_REQUIRES_REVIEW" : outcome.state === "ANSWER_EVIDENCE_AVAILABLE" ? "CLAIM_VERIFICATION_REQUIRED" : outcome.state === "MATERIAL_FOUND" ? "MATERIAL_IS_NOT_A_VERIFIED_ANSWER" : "NO_QUESTION_SPECIFIC_EVIDENCE";
      const outstanding = [...work.seen].some((entry) => work.attempts.get(entry)?.state !== "COMPLETED");
      const searchFailure = failures.find((failure) => failure.source.endsWith(`:${researchQuery(work.question)}`) || failure.source === "PROFILE" || failure.source.startsWith("RSS:"));
      const blocked = [...work.attempts.values()].find((attempt) => attempt.state !== "COMPLETED");
      const sufficient = ["ANSWER_EVIDENCE_AVAILABLE", "CONFLICTING_EVIDENCE"].includes(outcome.state);
      const requiresSearch = !selectedIds.has(work.question.id) || !searchedIds.has(work.question.id) && (work.requiresSearch || !work.candidates.size) || processingStopped || Boolean(searchFailure);
      const incomplete = !sufficient && (requiresSearch || outstanding || work.limited);
      const stopReason = sufficient ? "QUESTION_EVIDENCE_OBTAINED_REVIEW_REQUIRED" : !selectedIds.has(work.question.id) ? "QUESTION_BUDGET_TURN_DEFERRED" : processingStopped ? "PROCESSING_LIMIT_REACHED" : searchFailure?.code ?? (outstanding ? blocked?.reason ?? "QUESTION_ATTEMPT_LIMIT_REACHED" : requiresSearch ? "SEARCH_RESUME_REQUIRED" : "CONFIGURED_SEARCH_EXAMINED");
      const pendingCandidates = [...work.candidates].filter(([entry]) => work.attempts.get(entry)?.state !== "COMPLETED").map(([, candidate]) => candidate).slice(0, 2);
      return { ...outcome, state: incomplete ? work.attempted || work.attempts.size ? "RESEARCH_PARTIAL" : "RESEARCH_PENDING" : outcome.state, reason: incomplete ? stopReason : outcome.reason,
        investigation: { state: incomplete ? work.attempted || work.attempts.size ? "PARTIAL" : "NOT_STARTED" : "COMPLETE", evidenceState: outcome.state, stopReason, discovered: work.seen.size, processed: work.processed.size, attempted: work.attempted, enriched: work.enriched,
          progress: { version: "question-progress-v1", signature: work.signature, attempts: [...work.attempts.values()].sort((a, b) => a.key.localeCompare(b.key)), sources: outcome.sources, pendingCandidates, requiresSearch: requiresSearch || [...work.seen].filter((entry) => work.attempts.get(entry)?.state !== "COMPLETED").length > pendingCandidates.length } } };
    });
  }
}
