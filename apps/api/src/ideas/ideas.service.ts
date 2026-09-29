import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CollectIdeasRequestSchema,
  IdeaStatusSchema,
  UpdateIdeaStatusRequestSchema,
  type CollectIdeasRequest,
  type CollectIdeasResponse,
  type ContentIdea,
  type UpdateIdeaStatusRequest
} from "@postbot/contracts";
import type { TopicSourceCandidate, TopicSourceProvider } from "@postbot/providers";
import { createHash } from "node:crypto";
import { IDEAS_REPOSITORY, type ChannelCollectionSettings, type IdeasRepository, type ScoredIdeaCandidate } from "./ideas.repository.js";
import { TopicSourceProviderFactory } from "./topic-source-provider.factory.js";

const blockedTopicTerms = ["politics", "medical advice", "financial advice", "legal advice"];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const canonicalizeUrl = (rawUrl: string): string => {
  const url = new URL(rawUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "fbclid" || key.toLowerCase() === "gclid") {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
};

const textContainsAny = (text: string, terms: readonly string[]): string | null => {
  const lowerText = text.toLowerCase();
  return terms.find((term) => lowerText.includes(term.toLowerCase())) ?? null;
};

const freshnessScore = (publishedAt: string | null, recencyHours: number): number => {
  if (!publishedAt) {
    return 0.5;
  }
  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 3_600_000);
  return clamp01(1 - ageHours / recencyHours);
};

const keywordScore = (candidate: TopicSourceCandidate, settings: ChannelCollectionSettings): number => {
  const text = `${candidate.title} ${candidate.summary} ${candidate.body}`.toLowerCase();
  const matches = settings.keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
  return settings.keywords.length === 0 ? 0.5 : clamp01(matches / settings.keywords.length);
};

@Injectable()
export class IdeasService {
  constructor(
    @Inject(IDEAS_REPOSITORY) private readonly repository: IdeasRepository,
    private readonly providers: TopicSourceProviderFactory
  ) {}

  async collect(workspaceId: string, rawInput: unknown): Promise<CollectIdeasResponse> {
    const input = this.parseCollectInput(rawInput);
    const existing = await this.repository.findCollectionByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    const settings = await this.repository.getChannelSettings(workspaceId, input.channelId);
    if (!settings) {
      throw new ForbiddenException({ code: "CHANNEL_NOT_FOUND", message: "Channel was not found in this workspace." });
    }

    const providerResult =
      input.source === "manual"
        ? {
            provider: "manual",
            candidates: input.manualCandidates
          }
        : await this.collectFromProvider(this.providers.automatic(), settings, input);

    const scored = providerResult.candidates.map((candidate) => this.scoreCandidate(candidate, settings));
    const saved = await this.repository.saveCandidates(settings.channelId, providerResult.provider, scored);
    const response: CollectIdeasResponse = {
      channelId: settings.channelId,
      ...saved
    };
    await this.repository.saveCollectionResult(input.idempotencyKey, response);
    return response;
  }

  async list(workspaceId: string, channelId: string, rawStatus: string | undefined): Promise<{ ideas: ContentIdea[] }> {
    const status = rawStatus ? IdeaStatusSchema.parse(rawStatus) : null;
    return { ideas: await this.repository.list(workspaceId, channelId, status) };
  }

  async updateStatus(workspaceId: string, ideaId: string, rawInput: unknown): Promise<ContentIdea> {
    const input = UpdateIdeaStatusRequestSchema.parse(rawInput) satisfies UpdateIdeaStatusRequest;
    const idea = await this.repository.updateStatus(workspaceId, ideaId, input);
    if (!idea) {
      throw new NotFoundException({ code: "IDEA_NOT_FOUND", message: "Idea was not found." });
    }
    return idea;
  }

  private async collectFromProvider(
    provider: TopicSourceProvider,
    settings: ChannelCollectionSettings,
    input: CollectIdeasRequest
  ) {
    try {
      return await provider.collect({
        channelId: settings.channelId,
        topic: settings.topic,
        keywords: settings.keywords,
        allowedSources: settings.allowedSources,
        excludedSources: settings.excludedSources,
        recencyHours: settings.recencyHours,
        idempotencyKey: input.idempotencyKey
      });
    } catch {
      throw new BadRequestException({ code: "SOURCE_COLLECTION_FAILED", message: "Topic source collection failed." });
    }
  }

  private scoreCandidate(candidate: TopicSourceCandidate, settings: ChannelCollectionSettings): ScoredIdeaCandidate {
    const text = `${candidate.title} ${candidate.summary} ${candidate.body}`;
    const blockedTerm = textContainsAny(text, [...blockedTopicTerms, ...settings.excludedTopics, ...settings.excludedKeywords]);
    const canonicalUrl = canonicalizeUrl(candidate.url);
    const freshness = freshnessScore(candidate.publishedAt, settings.recencyHours);
    const suitability = keywordScore(candidate, settings);
    const expectedValue = clamp01(suitability * 0.4 + freshness * 0.25 + candidate.reliabilityScore * 0.25 + 0.1);
    return {
      ...candidate,
      canonicalUrl,
      urlHash: sha256(canonicalUrl),
      contentHash: sha256(`${candidate.title}\n${candidate.summary}\n${candidate.body}`.toLowerCase().trim()),
      suitabilityScore: suitability,
      freshnessScore: freshness,
      reliabilityScore: clamp01(candidate.reliabilityScore),
      expectedValueScore: expectedValue,
      rejectionReason: blockedTerm ? `Blocked term: ${blockedTerm}` : null
    };
  }

  private parseCollectInput(rawInput: unknown): CollectIdeasRequest {
    try {
      return CollectIdeasRequestSchema.parse(rawInput);
    } catch {
      throw new BadRequestException({ code: "INVALID_COLLECT_IDEAS_INPUT", message: "Invalid idea collection request." });
    }
  }
}
