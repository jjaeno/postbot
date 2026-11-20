import { ChannelCollectionProfileSchema, TopicSelectionPolicySchema } from "@postbot/contracts";
import { Inject, Injectable } from "@nestjs/common";
import type { CollectIdeasResponse, ContentIdea, IdeaStatus, UpdateIdeaStatusRequest } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import type { ChannelCollectionSettings, IdeasRepository, SaveIdeasResult, ScoredIdeaCandidate } from "./ideas.repository.js";

type ContentIdeaRecord = Prisma.ContentIdeaGetPayload<object>;

const jsonArray = (value: Prisma.JsonValue | null | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const decimalToNumber = (value: Prisma.Decimal): number => Number(value.toFixed(6));

const toIdea = (idea: ContentIdeaRecord): ContentIdea => ({
  id: idea.id,
  channelId: idea.channelId,
  status: idea.status,
  title: idea.title,
  summary: idea.summary ?? "",
  canonicalUrl: idea.canonicalUrl,
  sourceName: idea.sourceName,
  sourceKind: idea.sourceKind,
  provider: idea.provider,
  publishedAt: idea.publishedAt?.toISOString() ?? null,
  collectedAt: idea.collectedAt.toISOString(),
  suitabilityScore: decimalToNumber(idea.suitabilityScore),
  freshnessScore: decimalToNumber(idea.freshnessScore),
  reliabilityScore: decimalToNumber(idea.reliabilityScore),
  expectedValueScore: decimalToNumber(idea.expectedValueScore),
  rejectionReason: idea.rejectionReason,
  createdAt: idea.createdAt.toISOString(),
  updatedAt: idea.updatedAt.toISOString()
});

@Injectable()
export class PrismaIdeasRepository implements IdeasRepository {
  private readonly collectionResults = new Map<string, CollectIdeasResponse>();

  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async getChannelSettings(workspaceId: string, channelId: string): Promise<ChannelCollectionSettings | null> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, workspaceId },
      include: {
        collectionRules: {
          where: { isActive: true },
          orderBy: { version: "desc" },
          take: 1
        }
      }
    });
    if (!channel) {
      return null;
    }
    const collectionRule = channel.collectionRules[0];
    const parsed = ChannelCollectionProfileSchema.safeParse(collectionRule?.profile);
    const profile = parsed.success ? parsed.data : null;
    return {
      channelId: channel.id,
      topic: channel.topic ?? channel.name,
      excludedTopics: jsonArray(channel.excludedTopics),
      keywords: profile?.subtopics ?? jsonArray(collectionRule?.keywords),
      excludedKeywords: profile?.exclusions ?? jsonArray(collectionRule?.excludedKeywords),
      allowedSources: jsonArray(collectionRule?.allowedSources),
      excludedSources: jsonArray(collectionRule?.excludedSources),
      selectionPolicy: TopicSelectionPolicySchema.parse(profile ? { freshness: profile.freshness } : collectionRule?.selectionPolicy ?? {}),
      requireVisualEvidence: profile?.production.requireVisualEvidence ?? false,
      recencyHours: collectionRule?.recencyHours ?? 72
    };
  }

  async saveCandidates(channelId: string, provider: string, candidates: readonly ScoredIdeaCandidate[]): Promise<SaveIdeasResult> {
    let created = 0;
    let duplicates = 0;
    let rejected = 0;
    const ideas: ContentIdea[] = [];

    for (const candidate of candidates) {
      if (candidate.rejectionReason) {
        rejected += 1;
        continue;
      }
      try {
        const idea = await this.prisma.contentIdea.create({
          data: {
            channelId,
            status: "CANDIDATE",
            title: candidate.title,
            summary: candidate.summary,
            canonicalUrl: candidate.canonicalUrl,
            urlHash: candidate.urlHash,
            contentHash: candidate.contentHash,
            sourceName: candidate.sourceName,
            sourceKind: candidate.sourceKind,
            provider,
            publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null,
            suitabilityScore: new Prisma.Decimal(candidate.suitabilityScore.toFixed(6)),
            freshnessScore: new Prisma.Decimal(candidate.freshnessScore.toFixed(6)),
            reliabilityScore: new Prisma.Decimal(candidate.reliabilityScore.toFixed(6)),
            expectedValueScore: new Prisma.Decimal(candidate.expectedValueScore.toFixed(6)),
            rawSnapshot: {
              url: candidate.url,
              bodyHash: candidate.contentHash,
              body: candidate.body.slice(0, 10_000),
              contentScope: candidate.reliabilityMetadata?.contentScope === "FULL_TEXT" && candidate.body.length <= 10_000 ? "FULL_TEXT" : "SUMMARY",
              eventAt: candidate.eventAt ?? null,
              reliability: candidate.reliabilityMetadata ? JSON.parse(JSON.stringify(candidate.reliabilityMetadata)) as Prisma.InputJsonObject : null
            }
          }
        });
        created += 1;
        ideas.push(toIdea(idea));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }
    return { created, duplicates, rejected, ideas };
  }

  async list(workspaceId: string, channelId: string, status: IdeaStatus | null): Promise<ContentIdea[]> {
    const ideas = await this.prisma.contentIdea.findMany({
      where: {
        channelId,
        channel: { workspaceId },
        status: status ?? undefined
      },
      orderBy: [{ status: "asc" }, { expectedValueScore: "desc" }, { collectedAt: "desc" }]
    });
    return ideas.map(toIdea);
  }

  async updateStatus(workspaceId: string, ideaId: string, input: UpdateIdeaStatusRequest): Promise<ContentIdea | null> {
    const existing = await this.prisma.contentIdea.findFirst({
      where: {
        id: ideaId,
        channel: { workspaceId }
      }
    });
    if (!existing) {
      return null;
    }
    const updated = await this.prisma.contentIdea.update({
      where: { id: ideaId },
      data: {
        status: input.status,
        rejectionReason: input.status === "REJECTED" ? input.rejectionReason ?? "Rejected by user." : null
      }
    });
    return toIdea(updated);
  }

  findCollectionByIdempotencyKey(idempotencyKey: string): Promise<CollectIdeasResponse | null> {
    return Promise.resolve(this.collectionResults.get(idempotencyKey) ?? null);
  }

  saveCollectionResult(idempotencyKey: string, result: CollectIdeasResponse): Promise<void> {
    this.collectionResults.set(idempotencyKey, result);
    return Promise.resolve();
  }
}
