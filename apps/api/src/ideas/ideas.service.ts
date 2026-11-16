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
import { canonicalizeTopicUrl, scoreTopicCandidate } from "@postbot/providers";
import { IDEAS_REPOSITORY, type ChannelCollectionSettings, type IdeasRepository, type ScoredIdeaCandidate } from "./ideas.repository.js";
import { TopicSourceProviderFactory } from "./topic-source-provider.factory.js";

export const canonicalizeUrl = canonicalizeTopicUrl;

@Injectable()
export class IdeasService {
  constructor(
    @Inject(IDEAS_REPOSITORY) private readonly repository: IdeasRepository,
    private readonly providers: TopicSourceProviderFactory
  ) {}

  async collect(workspaceId: string, rawInput: unknown): Promise<CollectIdeasResponse> {
    const input = this.parseCollectInput(rawInput);
    const settings = await this.repository.getChannelSettings(workspaceId, input.channelId);
    if (!settings) throw new ForbiddenException({ code: "CHANNEL_NOT_FOUND", message: "Channel was not found in this workspace." });
    const scopedKey = `${workspaceId}:${input.channelId}:${input.idempotencyKey}`;
    const existing = await this.repository.findCollectionByIdempotencyKey(scopedKey);
    if (existing) return existing;

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
    await this.repository.saveCollectionResult(scopedKey, response);
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
    return scoreTopicCandidate(candidate, settings);
  }

  private parseCollectInput(rawInput: unknown): CollectIdeasRequest {
    try {
      return CollectIdeasRequestSchema.parse(rawInput);
    } catch {
      throw new BadRequestException({ code: "INVALID_COLLECT_IDEAS_INPUT", message: "Invalid idea collection request." });
    }
  }
}
