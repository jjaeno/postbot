import { loadConfig } from "@postbot/config";
import { ChannelCollectionProfileSchema, CollectAutomationJobPayloadSchema, TopicSelectionPolicySchema } from "@postbot/contracts";
import { assertExecutionOwner, Prisma, type PrismaClient } from "@postbot/database";
import { FixtureTopicSourceProvider, RssTopicSourceProvider, scoreTopicCandidate, topicSimilarity, type TopicSourceCandidate, type TopicSourceProvider } from "@postbot/providers";
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
    if (profile) {
      for (const subtopic of profile.subtopics) await this.prisma.researchQuestion.upsert({ where: { channelId_idempotencyKey: { channelId: input.channelId, idempotencyKey: `subtopic:${sha256(subtopic)}` } },
        create: { channelId: input.channelId, idempotencyKey: `subtopic:${sha256(subtopic)}`, question: `${subtopic}?`, subtopic, origin: "EDITORIAL" }, update: {} });
    }
    const questions = profile ? await this.prisma.researchQuestion.findMany({ where: { channelId: input.channelId, status: "INVESTIGATE" }, orderBy: { createdAt: "asc" }, take: 5 }) : [];
    if (profile && questions.length) profile = { ...profile, subtopics: [...new Set([...profile.subtopics, ...questions.map((question) => question.subtopic)])].slice(0, 40) };
    if (profile) input = { ...input, topic: profile.subtopics.join(" "), language: profile.language, keywords: profile.subtopics, excludedKeywords: profile.exclusions,
      selectionPolicy: { ...input.selectionPolicy, freshness: profile.freshness, recentTopicDays: profile.limits.recentTopicDays } };
    const provider = this.providerOverride ?? this.provider();
    const request = { channelId: input.channelId, topic: input.topic, keywords: input.keywords, allowedSources: input.allowedSources, excludedSources: input.excludedSources, recencyHours: input.recencyHours, idempotencyKey: input.idempotencyKey, freshness: profile?.freshness ?? input.selectionPolicy?.freshness };
    const result = !this.providerOverride && profile && loadConfig().TOPIC_SOURCE_PROVIDER === "profile"
      ? await new SourceCollection(this.prisma, input.channelId, profile, loadConfig().YOUTUBE_DISCOVERY_API_KEY).collect(request)
      : await provider.collect(request);
    const eligible = result.candidates.map((candidate) => scoreTopicCandidate(candidate, input))
      .sort((left, right) => right.expectedValueScore - left.expectedValueScore);
    for (const candidate of eligible) await this.save(input.channelId, candidate, result.provider);
    for (const question of questions) {
      const evidence = eligible.filter((candidate) => candidate.reliabilityMetadata?.contentScope === "FULL_TEXT" && topicSimilarity(question.subtopic, `${candidate.title} ${candidate.body}`) > 0).map((candidate) => ({ url: candidate.url, scope: "FULL_TEXT", fingerprint: sha256(candidate.body) }));
      await this.prisma.researchQuestion.update({ where: { id: question.id }, data: { status: evidence.length ? "SUPPORTED" : "NEEDS_REVIEW", evidence, reason: evidence.length ? "SOURCE_AVAILABLE_CLAIMS_REQUIRE_VERIFICATION" : "NO_ORIGINAL_EVIDENCE" } });
    }
    const idea = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${input.channelId} FOR UPDATE`;
      const rule = await tx.collectionRule.findFirst({ where: { channelId: input.channelId, isActive: true }, orderBy: { version: "desc" } });
      profile = rule?.profile ? ChannelCollectionProfileSchema.parse(rule.profile) : null;
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: input.channelId } });
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
        const rejectionReason = score.rejectionReason ?? repeat ?? (duplicateScore >= (input.selectionPolicy?.semanticDuplicateThreshold ?? 0.65) ? "RECENT_TOPIC_DUPLICATE" : null);
        snapshot = { ...snapshot, evaluation: { components: { ...score.components, recentTopicNovelty: 1 - duplicateScore }, method: score.scoringMethod, evaluatedAt: new Date().toISOString(), duplicateScore, duplicateThreshold: input.selectionPolicy?.semanticDuplicateThreshold ?? 0.65, reason: rejectionReason ?? "CURRENT_POLICY_ELIGIBLE" } };
        await tx.contentIdea.update({ where: { id: candidate.id }, data: { suitabilityScore: score.suitabilityScore, freshnessScore: score.freshnessScore, expectedValueScore: score.expectedValueScore, rejectionReason, rawSnapshot: snapshot } });
        if (!rejectionReason) ranked.push({ candidate, snapshot, score, duplicateScore });
      }
      ranked.sort((left, right) => Number(right.snapshot.reservationRunId === runId) - Number(left.snapshot.reservationRunId === runId) || right.score.expectedValueScore - left.score.expectedValueScore || left.candidate.id.localeCompare(right.candidate.id));
      const selected = ranked[0];
      if (selected) return tx.contentIdea.update({ where: { id: selected.candidate.id }, data: { status: "SHORTLISTED", rawSnapshot: { ...selected.snapshot, reservationRunId: runId, selectedReason: "BEST_CURRENT_RULE_SCORE" } } });

      return null;
    }, { timeout: 30_000 });
    if (!idea) throw new Error("NO_UNUSED_SOURCE_CANDIDATE_WAIT_FOR_NEXT_COLLECTION");
    return { provider: result.provider, sourceFailures: result.failures ?? [], idea: { id: idea.id, channelId: idea.channelId, title: idea.title, summary: idea.summary ?? "", canonicalUrl: idea.canonicalUrl, sourceName: idea.sourceName, sourceKind: idea.sourceKind, publishedAt: idea.publishedAt?.toISOString() ?? null, topic: input.topic, language: input.language }, contentHash: idea.contentHash };
  }

  private async save(channelId: string, candidate: TopicSourceCandidate & { suitabilityScore: number; freshnessScore: number; expectedValueScore: number }, provider: string) {
    const canonicalUrl = canonicalizeUrl(candidate.url);
    const contentHash = candidate.contentHash ?? sha256(`${candidate.title}\n${candidate.summary}\n${candidate.body}`.toLowerCase().trim());
    const data = {
      channelId, status: "SHORTLISTED" as const, title: candidate.title, summary: candidate.summary,
      canonicalUrl, urlHash: sha256(canonicalUrl), contentHash, sourceName: candidate.sourceName, sourceKind: candidate.sourceKind,
      provider, publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null,
      suitabilityScore: new Prisma.Decimal(candidate.suitabilityScore), freshnessScore: new Prisma.Decimal(candidate.freshnessScore),
      reliabilityScore: new Prisma.Decimal(candidate.reliabilityScore.toFixed(6)), expectedValueScore: new Prisma.Decimal(candidate.expectedValueScore.toFixed(6)),
      rawSnapshot: { contentScope: candidate.reliabilityMetadata?.contentScope === "FULL_TEXT" && candidate.body.length <= 10_000 ? "FULL_TEXT" : candidate.body ? "SUMMARY" : "UNKNOWN", body: candidate.body.slice(0, 10_000), collectedAt: new Date().toISOString(), eventAt: candidate.eventAt ?? null, reliability: candidate.reliabilityMetadata ? JSON.parse(JSON.stringify(candidate.reliabilityMetadata)) as Prisma.InputJsonObject : null }
    };
    const existing = await this.prisma.contentIdea.findFirst({ where: { channelId, OR: [{ urlHash: data.urlHash }, { contentHash }] } });
    if (existing) return existing;
    // Link related event coverage without merging their separate claims/text.
    const peers = candidate.publishedAt ? await this.prisma.contentIdea.findMany({ where: { channelId, publishedAt: { gte: new Date(Date.parse(candidate.publishedAt) - 86400000), lte: new Date(Date.parse(candidate.publishedAt) + 86400000) } }, orderBy: { collectedAt: "desc" }, take: 100 }) : [];
    const peer = peers.find((peer) => topicSimilarity(candidate.title, peer.title) >= 0.6);
    const peerSnapshot = peer?.rawSnapshot && typeof peer.rawSnapshot === "object" && !Array.isArray(peer.rawSnapshot) ? peer.rawSnapshot : {};
    const cluster = typeof peerSnapshot.eventClusterKey === "string" ? peerSnapshot.eventClusterKey : peer ? `event:${peer.id}` : `event:${data.contentHash}`;
    Object.assign(data.rawSnapshot, { eventClusterKey: cluster, clusterMethod: "TITLE_SIMILARITY_WITHIN_ONE_DAY_ASSOCIATION_ONLY", question: typeof candidate.reliabilityMetadata?.question === "string" ? candidate.reliabilityMetadata.question : `${candidate.title}?`,
      angle: candidate.reliabilityMetadata?.angle ?? "SOURCE_EXPLANATION", evidence: candidate.reliabilityMetadata?.evidence ?? [], visualReferences: candidate.reliabilityMetadata?.media ?? null });
    try { return await this.prisma.contentIdea.create({ data }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await this.prisma.contentIdea.findFirst({ where: { channelId, OR: [{ urlHash: data.urlHash }, { contentHash }] } });
        if (duplicate) return duplicate;
      }
      throw error;
    }
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
