import type {
  CollectIdeasResponse,
  ContentIdea,
  IdeaStatus,
  UpdateIdeaStatusRequest
} from "@postbot/contracts";
import type { TopicSourceCandidate, TopicSelectionPolicy } from "@postbot/providers";

export const IDEAS_REPOSITORY = Symbol("IDEAS_REPOSITORY");

export type ChannelCollectionSettings = {
  selectionPolicy?: TopicSelectionPolicy;
  channelId: string;
  topic: string;
  excludedTopics: readonly string[];
  keywords: readonly string[];
  excludedKeywords: readonly string[];
  allowedSources: readonly string[];
  excludedSources: readonly string[];
  recencyHours: number;
};

export type ScoredIdeaCandidate = TopicSourceCandidate & {
  canonicalUrl: string;
  urlHash: string;
  contentHash: string;
  suitabilityScore: number;
  freshnessScore: number;
  expectedValueScore: number;
  rejectionReason: string | null;
};

export type SaveIdeasResult = Pick<CollectIdeasResponse, "created" | "duplicates" | "rejected" | "ideas">;

export type IdeasRepository = {
  getChannelSettings(workspaceId: string, channelId: string): Promise<ChannelCollectionSettings | null>;
  saveCandidates(channelId: string, provider: string, candidates: readonly ScoredIdeaCandidate[]): Promise<SaveIdeasResult>;
  list(workspaceId: string, channelId: string, status: IdeaStatus | null): Promise<ContentIdea[]>;
  updateStatus(
    workspaceId: string,
    ideaId: string,
    input: UpdateIdeaStatusRequest
  ): Promise<ContentIdea | null>;
  findCollectionByIdempotencyKey(idempotencyKey: string): Promise<CollectIdeasResponse | null>;
  saveCollectionResult(idempotencyKey: string, result: CollectIdeasResponse): Promise<void>;
};
