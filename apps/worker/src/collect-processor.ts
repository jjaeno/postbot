import { loadConfig } from "@postbot/config";
import { hasHttpsVisualReference, ChannelCollectionProfileSchema, CollectAutomationJobPayloadSchema, TopicSelectionPolicySchema } from "@postbot/contracts";
import { assertExecutionOwner, Prisma, type PrismaClient } from "@postbot/database";
import { assessResearch, sourceDigest, sourceRecord, sourceObservation, FixtureTopicSourceProvider, RssTopicSourceProvider, scoreTopicCandidate, topicSimilarity, type TopicSourceCandidate, type TopicSourceProvider, type TopicSourceResult } from "@postbot/providers";
import { createHash } from "node:crypto";
import { SourceCollection } from "./source-collection.js";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const canonicalizeUrl = (rawUrl: string): string => {
  const url = new URL(rawUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid"].includes(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort(); url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
};

export class CollectProcessor {
  constructor(private readonly prisma: PrismaClient, private readonly providerOverride?: TopicSourceProvider) {}

  async process(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let input = CollectAutomationJobPayloadSchema.parse(payload).collect;
    const currentRule = await this.prisma.collectionRule.findFirst({ where: { channelId: input.channelId, isActive: true }, orderBy: { version: "desc" } });
    let profile = currentRule?.profile ? ChannelCollectionProfileSchema.parse(currentRule.profile) : null;
    if (!this.providerOverride && loadConfig().TOPIC_SOURCE_PROVIDER === "profile" && !profile) throw new Error("CHANNEL_COLLECTION_PROFILE_REQUIRED");
    const discovers = input.mode === "DISCOVER" || input.mode === "COLLECT_SELECT";
    const questions = profile && discovers ? await this.prisma.researchQuestion.findMany({ where: { channelId: input.channelId, status: { in: ["INVESTIGATE", "RESEARCH_PENDING", "RESEARCH_PARTIAL"] } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 5 }) : [];
    const channelContext = await this.prisma.channel.findUniqueOrThrow({ where: { id: input.channelId }, select: { language: true, targetAudience: true, excludedTopics: true } });
    if (profile) input = { ...input, topic: profile.subtopics.join(" "), language: profile.language, keywords: profile.subtopics, excludedKeywords: profile.exclusions,
      selectionPolicy: { ...input.selectionPolicy, freshness: profile.freshness, recentTopicDays: profile.limits.recentTopicDays } };
    const provider = this.providerOverride ?? this.provider();
    const exclusions = [...(profile?.exclusions ?? []), ...(Array.isArray(channelContext.excludedTopics) ? channelContext.excludedTopics.filter((term): term is string => typeof term === "string") : [])];
    input = { ...input, excludedTopics: Array.isArray(channelContext.excludedTopics) ? channelContext.excludedTopics.filter((term): term is string => typeof term === "string") : [] };
    const request = { channelId: input.channelId, topic: input.topic, keywords: input.keywords, allowedSources: input.allowedSources, excludedSources: input.excludedSources, recencyHours: input.recencyHours, idempotencyKey: input.idempotencyKey, freshness: profile?.freshness ?? input.selectionPolicy?.freshness,
      researchQuestions: questions.map(({ id, question, subtopic, origin, status, evidence }) => ({ id, question, subtopic, origin, status, progress: sourceRecord(sourceRecord(evidence).investigation).progress })),
      researchContext: { language: profile?.language ?? channelContext.language, audience: profile?.audience || channelContext.targetAudience || "", exclusions, storyStyles: profile?.storyStyles ?? [] } };
    const result: Pick<TopicSourceResult, "provider" | "candidates" | "failures" | "research" | "diagnostics"> = !discovers ? { provider: "stored-candidates", candidates: [], failures: [] }
      : !this.providerOverride && profile && loadConfig().TOPIC_SOURCE_PROVIDER === "profile"
      ? await new SourceCollection(this.prisma, input.channelId, profile, loadConfig().YOUTUBE_DISCOVERY_API_KEY).collect(request)
      : await provider.collect(request);
    const researchOutcomes = questions.map((question) => result.research?.find((entry) => entry.questionId === question.id) ?? assessResearch(question, result.candidates, request.researchContext));
    const conflictUrls = new Set(researchOutcomes.flatMap((outcome) => outcome.sources.filter((source) => source.relationship === "COUNTEREVIDENCE_OR_CONFLICT_REQUIRES_REVIEW" && typeof source.url === "string").map((source) => canonicalizeUrl(source.url as string))));
    const eligible = result.candidates.map((candidate) => scoreTopicCandidate(conflictUrls.has(canonicalizeUrl(candidate.url)) ? { ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, researchState: "CONFLICTING_EVIDENCE" } } : candidate, input))
      .sort((left, right) => right.expectedValueScore - left.expectedValueScore || left.url.localeCompare(right.url));
    const observations = new Map<string, { ideaId: string; versionId: string; fingerprint: string }>();
    const observationKey = (url: string, fingerprint: string, scope: unknown) => JSON.stringify([canonicalizeUrl(url), fingerprint, scope]);
    for (const candidate of eligible) {
      const saved = await this.save(input.channelId, candidate, result.provider);
      const versions = sourceRecord(sourceRecord(saved.rawSnapshot).sourceVersions);
      for (const value of Object.values(versions)) {
        const version = sourceRecord(value);
        if (typeof version.url === "string" && typeof version.id === "string" && typeof version.fingerprint === "string") observations.set(observationKey(version.url, version.fingerprint, sourceRecord(version.snapshot).contentScope), { ideaId: saved.id, versionId: version.id, fingerprint: version.fingerprint });
      }
      observations.set(observationKey(candidate.url, saved.observedFingerprint, sourceRecord(sourceRecord(versions[saved.observedVersionId]).snapshot).contentScope), { ideaId: saved.id, versionId: saved.observedVersionId, fingerprint: saved.observedFingerprint });
    }
    for (const question of questions) {
      const outcome = researchOutcomes.find((entry) => entry.questionId === question.id)!;
      outcome.sources = outcome.sources.map((entry) => ({ ...entry, sourceObservation: entry.sourceObservation ?? (typeof entry.url === "string" && typeof entry.fingerprint === "string" ? observations.get(observationKey(entry.url, entry.fingerprint, entry.contentScope)) ?? null : null) }));
      if (outcome.investigation) sourceRecord(outcome.investigation.progress).sources = outcome.sources;
      const previous = question.evidence && typeof question.evidence === "object" && !Array.isArray(question.evidence) ? question.evidence : {};
      const history = Array.isArray(previous.history) ? previous.history.slice(-4) : [];
      const signature = sourceDigest({ state: outcome.state, sources: outcome.sources, progress: outcome.investigation?.progress ?? null });
      const updatedHistory = sourceRecord(history.at(-1)).signature === signature ? history : [...history, { signature, observedAt: new Date().toISOString(), state: outcome.state, sources: outcome.sources }];
      const evidence = JSON.parse(JSON.stringify({ version: "research-v2", ...outcome, context: request.researchContext, claimsVerified: false, history: updatedHistory })) as Prisma.InputJsonObject;
      await this.prisma.researchQuestion.updateMany({ where: { id: question.id, status: question.status, updatedAt: question.updatedAt }, data: { status: outcome.state === "ANSWER_EVIDENCE_AVAILABLE" ? "CLAIM_REVIEW_REQUIRED" : outcome.state, evidence, reason: outcome.reason } });
    }
    if (profile && discovers) for (const candidate of eligible.filter((entry) => entry.reliabilityMetadata?.role !== "DISCOVERY").slice(0, 3)) {
      const question = profile.language.startsWith("ko") ? `${candidate.title}의 원인과 결과는 무엇이며, 어떤 원문 자료로 확인할 수 있는가?` : `What caused ${candidate.title}, and which original records support its consequences?`;
      await this.prisma.researchQuestion.upsert({ where: { channelId_idempotencyKey: { channelId: input.channelId, idempotencyKey: `discovery:${sha256(candidate.url)}` } }, create: { channelId: input.channelId, idempotencyKey: `discovery:${sha256(candidate.url)}`, question, subtopic: profile.subtopics[0]!, origin: "AI_HYPOTHESIS", reason: "DISCOVERED_TOPIC_UNVERIFIED_HYPOTHESIS" }, update: {} });
    }
    if (input.mode === "DISCOVER") return { provider: result.provider, discovered: eligible.length, sourceFailures: result.failures ?? [], externalCollection: result.diagnostics ?? null, research: result.research ?? [] };
    let rankedCount = 0;
    const idea = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${input.channelId} FOR UPDATE`;
      const rule = await tx.collectionRule.findFirst({ where: { channelId: input.channelId, isActive: true }, orderBy: { version: "desc" } });
      profile = rule?.profile ? ChannelCollectionProfileSchema.parse(rule.profile) : null;
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: input.channelId } });
      const owningRun = await tx.automationRun.findUnique({ where: { id: CollectAutomationJobPayloadSchema.parse(payload).automation.runId } });
      const sample = owningRun?.checkpoint && typeof owningRun.checkpoint === "object" && !Array.isArray(owningRun.checkpoint) && owningRun.checkpoint.sample === true;
      if (channel.status !== "ACTIVE" && !(sample && channel.status === "PAUSED")) throw new Error("CHANNEL_NOT_ACTIVE");
      const list = (value: Prisma.JsonValue | null): string[] => Array.isArray(value) ? value.filter((term): term is string => typeof term === "string") : [];
      if (rule) input = { ...input, keywords: profile?.subtopics ?? list(rule.keywords), allowedSources: list(rule.allowedSources), excludedSources: list(rule.excludedSources), excludedKeywords: profile?.exclusions ?? list(rule.excludedKeywords), recencyHours: rule.recencyHours,
        selectionPolicy: profile ? { ...TopicSelectionPolicySchema.parse(rule.selectionPolicy ?? {}), freshness: profile.freshness, recentTopicDays: profile.limits.recentTopicDays } : TopicSelectionPolicySchema.parse(rule.selectionPolicy ?? {}) };
      input = { ...input, excludedTopics: list(channel.excludedTopics) };
      const candidates = await tx.contentIdea.findMany({ where: { channelId: input.channelId, status: { in: ["CANDIDATE", "SHORTLISTED"] }, usedContentItemId: null }, orderBy: [{ expectedValueScore: "desc" }, { collectedAt: "desc" }] });
      const runId = CollectAutomationJobPayloadSchema.parse(payload).automation.runId;
      const recent = await tx.contentItem.findMany({ where: { channelId: input.channelId, status: { not: "FAILED" }, createdAt: { gte: new Date(Date.now() - (input.selectionPolicy?.recentTopicDays ?? 30) * 86_400_000) } }, select: { title: true, summary: true } });
      const priorIdeas = profile ? await tx.contentIdea.findMany({ where: { channelId: input.channelId, usedContentItem: { createdAt: { gte: new Date(Date.now() - profile.limits.recentTopicDays * 86400000) }, status: { not: "FAILED" } } }, select: { rawSnapshot: true } }) : [];
      const record = (value: Prisma.JsonValue | undefined): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const ranked: Array<{ candidate: typeof candidates[number]; snapshot: Prisma.JsonObject; score: ReturnType<typeof scoreTopicCandidate>; duplicateScore: number }> = [];
      for (const candidate of candidates) {
        let snapshot: Prisma.JsonObject = candidate.rawSnapshot && typeof candidate.rawSnapshot === "object" && !Array.isArray(candidate.rawSnapshot) ? candidate.rawSnapshot : {};
        if (typeof snapshot.reservationRunId === "string" && snapshot.reservationRunId !== runId) {
          const owner = await tx.automationRun.findUnique({ where: { id: snapshot.reservationRunId }, select: { status: true } });
          if (owner && !["FAILED", "CANCELLED", "SUCCEEDED"].includes(owner.status)) continue;
          const uncertain = await tx.productionJob.count({ where: { type: "SCRIPT", status: { in: ["RUNNING", "NEEDS_REVIEW"] }, payload: { path: "$.automation.runId", equals: snapshot.reservationRunId } } });
          if (uncertain) continue;
          snapshot = { ...snapshot, reservationRunId: null, reservationReleasedReason: owner?.status ?? "OWNER_NOT_FOUND" };
        }
        const reliability = snapshot.reliability && typeof snapshot.reliability === "object" && !Array.isArray(snapshot.reliability) ? snapshot.reliability : {};
        const score = scoreTopicCandidate({ ...candidate, reliabilityMetadata: reliability, url: candidate.canonicalUrl, summary: candidate.summary ?? "", body: typeof snapshot.body === "string" ? snapshot.body : "", reliabilityScore: Number(candidate.reliabilityScore), publishedAt: candidate.publishedAt?.toISOString() ?? null }, input);
        const duplicateScore = recent.reduce((max, item) => Math.max(max, topicSimilarity(`${candidate.title} ${candidate.summary ?? ""}`, `${item.title} ${item.summary ?? ""}`)), 0);
        const prior = priorIdeas.map((idea) => record(record(idea.rawSnapshot ?? undefined).reliability));
        const people = list(reliability.persons ?? null);
        const limits = profile?.limits;
        const repeat = !limits ? null : people.some((person) => prior.filter((old) => list(old.persons ?? null).includes(person)).length >= limits.maxPersonRepeats) ? "PERSON_REPEAT_LIMIT"
          : typeof reliability.subtopic === "string" && prior.filter((old) => old.subtopic === reliability.subtopic).length >= limits.maxSubtopicRepeats ? "SUBTOPIC_REPEAT_LIMIT"
          : typeof snapshot.eventClusterKey === "string" && priorIdeas.filter((idea) => record(idea.rawSnapshot ?? undefined).eventClusterKey === snapshot.eventClusterKey).length >= limits.maxEventRepeats ? "EVENT_REPEAT_LIMIT" : null;
        const hasVisualReference = hasHttpsVisualReference(snapshot);
        const visualReason = profile?.production.requireVisualEvidence && !hasVisualReference ? "VISUAL_REFERENCE_REQUIRED" : null;
        const rejectionReason = score.rejectionReason ?? (snapshot.sourceObservationConflict ? "SOURCE_EVIDENCE_CONFLICT_REVIEW_REQUIRED" : null) ?? repeat ?? visualReason ?? (duplicateScore >= (input.selectionPolicy?.semanticDuplicateThreshold ?? 0.65) ? "RECENT_TOPIC_DUPLICATE" : null);
        snapshot = { ...snapshot, evaluation: { components: { ...score.components, recentTopicNovelty: 1 - duplicateScore }, method: score.scoringMethod, evaluatedAt: new Date().toISOString(), duplicateScore, duplicateThreshold: input.selectionPolicy?.semanticDuplicateThreshold ?? 0.65, reason: rejectionReason ?? "CURRENT_POLICY_ELIGIBLE" } };
        await tx.contentIdea.update({ where: { id: candidate.id }, data: { suitabilityScore: score.suitabilityScore, freshnessScore: score.freshnessScore, expectedValueScore: score.expectedValueScore, rejectionReason, rawSnapshot: snapshot } });
        if (!rejectionReason) ranked.push({ candidate, snapshot, score, duplicateScore });
      }
      ranked.sort((left, right) => Number(right.snapshot.reservationRunId === runId) - Number(left.snapshot.reservationRunId === runId) || right.score.expectedValueScore - left.score.expectedValueScore || left.candidate.id.localeCompare(right.candidate.id));
      if (profile) ranked.splice(profile.limits.targetCandidates);
      rankedCount = ranked.length;
      if (input.mode === "RANK") return null;
      const selected = ranked[0];
      if (selected) return tx.contentIdea.update({ where: { id: selected.candidate.id }, data: { status: "SHORTLISTED", rawSnapshot: { ...selected.snapshot, reservationRunId: runId, selectedReason: "BEST_CURRENT_RULE_SCORE" } } });

      return null;
    }, { timeout: 30_000 });
    if (input.mode === "RANK") return { provider: result.provider, ranked: rankedCount, rankedAt: new Date().toISOString() };
    if (!idea) throw new Error("NO_UNUSED_SOURCE_CANDIDATE_WAIT_FOR_NEXT_COLLECTION");
    return { provider: result.provider, discovered: eligible.length, externalCollection: result.diagnostics ?? null, sourceFailures: result.failures ?? [], idea: { id: idea.id, channelId: idea.channelId, title: idea.title, summary: idea.summary ?? "", canonicalUrl: idea.canonicalUrl, sourceName: idea.sourceName, sourceKind: idea.sourceKind, publishedAt: idea.publishedAt?.toISOString() ?? null, topic: input.topic, language: input.language }, contentHash: idea.contentHash };
  }

  private async save(channelId: string, candidate: TopicSourceCandidate & { suitabilityScore: number; freshnessScore: number; expectedValueScore: number; rejectionReason?: string | null }, provider: string) {
    const canonicalUrl = canonicalizeUrl(candidate.url);
    const contentHash = candidate.contentHash ?? sha256(`${candidate.title}\n${candidate.summary}\n${candidate.body}`.toLowerCase().trim());
    const evaluation = candidate.reliabilityMetadata?.collectionEvaluation;
    const collectionReason = evaluation && typeof evaluation === "object" && "reason" in evaluation && typeof evaluation.reason === "string" && evaluation.reason !== "ELIGIBLE" ? evaluation.reason : null;
    const data = {
      channelId, status: "CANDIDATE" as const, title: candidate.title, summary: candidate.summary,
      canonicalUrl, urlHash: sha256(canonicalUrl), contentHash, sourceName: candidate.sourceName, sourceKind: candidate.sourceKind,
      provider, publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null, rejectionReason: candidate.rejectionReason ?? collectionReason,
      suitabilityScore: new Prisma.Decimal(candidate.suitabilityScore), freshnessScore: new Prisma.Decimal(candidate.freshnessScore),
      reliabilityScore: new Prisma.Decimal(candidate.reliabilityScore.toFixed(6)), expectedValueScore: new Prisma.Decimal(candidate.expectedValueScore.toFixed(6)),
      rawSnapshot: { contentScope: candidate.reliabilityMetadata?.contentScope === "FULL_TEXT" && candidate.body.length <= 10_000 ? "FULL_TEXT" : candidate.body ? "SUMMARY" : "UNKNOWN", body: candidate.body.slice(0, 10_000), collectedAt: typeof candidate.reliabilityMetadata?.collectedAt === "string" && Number.isFinite(Date.parse(candidate.reliabilityMetadata.collectedAt)) ? candidate.reliabilityMetadata.collectedAt : new Date().toISOString(), eventAt: candidate.eventAt ?? null, reliability: candidate.reliabilityMetadata ? JSON.parse(JSON.stringify(candidate.reliabilityMetadata)) as Prisma.InputJsonObject : null }
    };
    const cluster = `source:${data.urlHash}`;
    Object.assign(data.rawSnapshot, { eventClusterKey: cluster, clusterMethod: "SOURCE_RECORD_IDENTITY_NOT_TITLE_SIMILARITY", question: typeof candidate.reliabilityMetadata?.question === "string" ? candidate.reliabilityMetadata.question : `${candidate.title}?`,
      angle: candidate.reliabilityMetadata?.angle ?? "SOURCE_EXPLANATION", evidence: candidate.reliabilityMetadata?.evidence ?? [], visualReferences: candidate.reliabilityMetadata?.media ?? null });
    const observation = sourceObservation({ url: canonicalUrl, title: candidate.title, summary: candidate.summary, sourceName: candidate.sourceName, sourceKind: candidate.sourceKind, snapshot: data.rawSnapshot });
    const conflict = candidate.reliabilityMetadata?.researchState === "CONFLICTING_EVIDENCE" || candidate.reliabilityMetadata?.claimVerification === "CONFLICTING_EVIDENCE";
    const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
    const saved = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const existing = await tx.contentIdea.findUnique({ where: { channelId_urlHash: { channelId, urlHash: data.urlHash } } }) ?? await tx.contentIdea.findUnique({ where: { channelId_contentHash: { channelId, contentHash } } });
      if (!existing) return tx.contentIdea.create({ data: { ...data, ...(conflict ? { rejectionReason: "SOURCE_EVIDENCE_CONFLICT_REVIEW_REQUIRED" } : {}), rawSnapshot: json({ ...observation.snapshot, sourceVersionId: observation.id, sourceFingerprint: observation.fingerprint, sourceObservationConflict: conflict ? observation.id : null, sourceVersions: { [observation.id]: { ...observation, changeReason: "FIRST_OBSERVATION" } } }) } });
      const current = sourceRecord(existing.rawSnapshot); const versions = { ...sourceRecord(current.sourceVersions) };
      const previous = sourceObservation({ url: existing.canonicalUrl, title: existing.title, summary: existing.summary ?? "", sourceName: existing.sourceName, sourceKind: existing.sourceKind, snapshot: current });
      const activeId = typeof current.sourceVersionId === "string" ? current.sourceVersionId : previous.id;
      if (!versions[activeId]) versions[activeId] = { ...previous, id: activeId, changeReason: "LEGACY_SNAPSHOT" };
      const sameSource = canonicalizeUrl(existing.canonicalUrl) === canonicalUrl;
      const pinned = existing.status === "USED" || existing.usedContentItemId !== null || typeof current.reservationRunId === "string" || current.evidencePinned === true;
      const downgrade = current.contentScope === "FULL_TEXT" && observation.snapshot.contentScope !== "FULL_TEXT";
      const failure = Boolean(candidate.reliabilityMetadata?.evidenceFailure);
      const stale = typeof current.collectedAt === "string" && Date.parse(data.rawSnapshot.collectedAt) < Date.parse(current.collectedAt);
      const activate = sameSource && !pinned && !downgrade && !failure && !conflict && !stale && ["CANDIDATE", "SHORTLISTED"].includes(existing.status);
      if (versions[observation.id] && (!activate || activeId === observation.id && !current.sourceObservationConflict)) return existing;
      if (!versions[observation.id]) versions[observation.id] = { ...observation, previousVersionId: activeId, changeReason: !sameSource ? "ALTERNATE_SOURCE_SAME_CONTENT" : conflict ? "CONFLICT_REQUIRES_REVIEW" : pinned ? "PINNED_PRODUCTION_EVIDENCE" : stale ? "OLDER_COLLECTION_OBSERVATION" : downgrade || failure ? "LOWER_QUALITY_OBSERVATION" : "SOURCE_CONTENT_OR_EVIDENCE_CHANGED" };
      const snapshot = activate ? { ...current, ...observation.snapshot, sourceVersionId: observation.id, sourceFingerprint: observation.fingerprint, sourceVersions: versions, sourceObservationConflict: null } : { ...current, sourceVersionId: activeId, sourceFingerprint: previous.fingerprint, sourceVersions: versions, ...(conflict && sameSource ? { sourceObservationConflict: observation.id } : {}) };
      return tx.contentIdea.update({ where: { id: existing.id }, data: { rawSnapshot: json(snapshot), ...(activate ? { title: candidate.title, summary: candidate.summary, rejectionReason: data.rejectionReason, suitabilityScore: data.suitabilityScore, freshnessScore: data.freshnessScore, reliabilityScore: data.reliabilityScore, expectedValueScore: data.expectedValueScore } : {}) } });
    }, { timeout: 30_000 });
    return { ...saved, observedVersionId: observation.id, observedFingerprint: observation.fingerprint };
  }

  private provider(): TopicSourceProvider {
    const config = loadConfig();
    if (config.TOPIC_SOURCE_PROVIDER === "rss") {
      const feedUrls = config.TOPIC_SOURCE_FEED_URLS.split(",").map((value) => value.trim()).filter(Boolean);
      return new RssTopicSourceProvider({ feedUrls, timeoutMs: config.TOPIC_SOURCE_TIMEOUT_MS, maxRetries: config.TOPIC_SOURCE_MAX_RETRIES });
    }
    return new FixtureTopicSourceProvider();
  }
}
