import { loadConfig } from "@postbot/config";
import { CollectAutomationJobPayloadSchema } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { FixtureTopicSourceProvider, RssTopicSourceProvider, scoreTopicCandidate, type TopicSourceCandidate, type TopicSourceProvider } from "@postbot/providers";
import { createHash } from "node:crypto";

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
    const input = CollectAutomationJobPayloadSchema.parse(payload).collect;
    const provider = this.providerOverride ?? this.provider();
    const result = await provider.collect({ channelId: input.channelId, topic: input.topic, keywords: input.keywords, allowedSources: input.allowedSources, excludedSources: input.excludedSources, recencyHours: input.recencyHours, idempotencyKey: input.idempotencyKey });
    const eligible = result.candidates.map((candidate) => scoreTopicCandidate(candidate, input))
      .filter((candidate) => !candidate.rejectionReason)
      .sort((left, right) => right.expectedValueScore - left.expectedValueScore);
    for (const candidate of eligible) await this.save(input.channelId, candidate, result.provider);
    const idea = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${input.channelId} FOR UPDATE`;
      const candidates = await tx.contentIdea.findMany({ where: { channelId: input.channelId, status: { in: ["CANDIDATE", "SHORTLISTED"] }, usedContentItemId: null }, orderBy: [{ expectedValueScore: "desc" }, { collectedAt: "desc" }] });
      for (const candidate of candidates) {
        const snapshot = candidate.rawSnapshot && typeof candidate.rawSnapshot === "object" && !Array.isArray(candidate.rawSnapshot) ? candidate.rawSnapshot : {};
        if (typeof snapshot.reservationRunId === "string" && snapshot.reservationRunId !== CollectAutomationJobPayloadSchema.parse(payload).automation.runId) continue;
        // Reapply current filters to stored unused candidates as well.
        const scored = scoreTopicCandidate({ ...candidate, url: candidate.canonicalUrl, summary: candidate.summary ?? "", body: typeof snapshot.body === "string" ? snapshot.body : "", reliabilityScore: Number(candidate.reliabilityScore), publishedAt: candidate.publishedAt?.toISOString() ?? null }, input);
        if (scored.rejectionReason) continue;
        return tx.contentIdea.update({ where: { id: candidate.id }, data: { status: "SHORTLISTED", rawSnapshot: { ...snapshot, reservationRunId: CollectAutomationJobPayloadSchema.parse(payload).automation.runId } } });
      }
      return null;
    });
    if (!idea) throw new Error("NO_UNUSED_SOURCE_CANDIDATE_WAIT_FOR_NEXT_COLLECTION");
    return { provider: result.provider, idea: { id: idea.id, channelId: idea.channelId, title: idea.title, summary: idea.summary ?? "", canonicalUrl: idea.canonicalUrl, sourceName: idea.sourceName, sourceKind: idea.sourceKind, publishedAt: idea.publishedAt?.toISOString() ?? null, topic: input.topic, language: input.language }, contentHash: idea.contentHash };
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
      rawSnapshot: { body: candidate.body.slice(0, 10_000), eventAt: candidate.eventAt ?? null, reliability: candidate.reliabilityMetadata ? JSON.parse(JSON.stringify(candidate.reliabilityMetadata)) as Prisma.InputJsonObject : null }
    };
    const existing = await this.prisma.contentIdea.findFirst({ where: { channelId, OR: [{ urlHash: data.urlHash }, { contentHash }] } });
    if (existing) return existing;
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
