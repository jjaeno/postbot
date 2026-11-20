import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type {
  CollectIdeasResponse,
  ContentIdea,
  IdeaStatus,
  UpdateIdeaStatusRequest
} from "@postbot/contracts";
import type { TopicSourceCandidate, TopicSourceProvider, TopicSourceRequest, TopicSourceResult } from "@postbot/providers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChannelCollectionSettings, IdeasRepository, SaveIdeasResult, ScoredIdeaCandidate } from "./ideas.repository.js";
import { canonicalizeUrl, IdeasService } from "./ideas.service.js";
import { TopicSourceProviderFactory } from "./topic-source-provider.factory.js";

class FailingTopicSourceProvider implements TopicSourceProvider {
  collect(): Promise<TopicSourceResult> {
    return Promise.reject(new Error("source failed"));
  }
}

class StaticTopicSourceProvider implements TopicSourceProvider {
  constructor(private readonly candidates: readonly TopicSourceCandidate[]) {}

  collect(request: TopicSourceRequest): Promise<TopicSourceResult> {
    return Promise.resolve({
      provider: "static",
      idempotencyKey: request.idempotencyKey,
      createdAt: new Date().toISOString(),
      candidates: this.candidates
    });
  }
}

class TestProviderFactory extends TopicSourceProviderFactory {
  constructor(private readonly provider: TopicSourceProvider) {
    super();
  }

  override fixture(): TopicSourceProvider {
    return this.provider;
  }
}

class MemoryIdeasRepository implements IdeasRepository {
  readonly settings = new Map<string, { workspaceId: string; settings: ChannelCollectionSettings }>();
  readonly ideas = new Map<string, ContentIdea>();
  readonly collectionResults = new Map<string, CollectIdeasResponse>();
  private sequence = 0;

  addSettings(workspaceId: string, settings: ChannelCollectionSettings): void {
    this.settings.set(settings.channelId, { workspaceId, settings });
  }

  getChannelSettings(workspaceId: string, channelId: string): Promise<ChannelCollectionSettings | null> {
    const entry = this.settings.get(channelId);
    return Promise.resolve(entry?.workspaceId === workspaceId ? entry.settings : null);
  }

  saveCandidates(channelId: string, provider: string, candidates: readonly ScoredIdeaCandidate[]): Promise<SaveIdeasResult> {
    let created = 0;
    let duplicates = 0;
    let rejected = 0;
    const ideas: ContentIdea[] = [];
    for (const candidate of candidates) {
      if (candidate.rejectionReason) {
        rejected += 1;
        continue;
      }
      const duplicate = [...this.ideas.values()].some(
        (idea) =>
          idea.channelId === channelId &&
          (idea.canonicalUrl === candidate.canonicalUrl || `${idea.title}:${idea.summary}` === `${candidate.title}:${candidate.summary}`)
      );
      if (duplicate) {
        duplicates += 1;
        continue;
      }
      const now = new Date().toISOString();
      const idea: ContentIdea = {
        id: `idea-${++this.sequence}`,
        channelId,
        status: "CANDIDATE",
        title: candidate.title,
        summary: candidate.summary,
        canonicalUrl: candidate.canonicalUrl,
        sourceName: candidate.sourceName,
        sourceKind: candidate.sourceKind,
        provider,
        publishedAt: candidate.publishedAt,
        collectedAt: now,
        suitabilityScore: candidate.suitabilityScore,
        freshnessScore: candidate.freshnessScore,
        reliabilityScore: candidate.reliabilityScore,
        expectedValueScore: candidate.expectedValueScore,
        rejectionReason: null,
        createdAt: now,
        updatedAt: now
      };
      this.ideas.set(idea.id, idea);
      ideas.push(idea);
      created += 1;
    }
    return Promise.resolve({ created, duplicates, rejected, ideas });
  }

  list(workspaceId: string, channelId: string, status: IdeaStatus | null): Promise<ContentIdea[]> {
    const entry = this.settings.get(channelId);
    if (entry?.workspaceId !== workspaceId) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      [...this.ideas.values()].filter((idea) => idea.channelId === channelId && (!status || idea.status === status))
    );
  }

  updateStatus(workspaceId: string, ideaId: string, input: UpdateIdeaStatusRequest): Promise<ContentIdea | null> {
    const idea = this.ideas.get(ideaId);
    if (!idea || this.settings.get(idea.channelId)?.workspaceId !== workspaceId) {
      return Promise.resolve(null);
    }
    const updated: ContentIdea = {
      ...idea,
      status: input.status,
      rejectionReason: input.status === "REJECTED" ? input.rejectionReason ?? "Rejected by user." : null,
      updatedAt: new Date().toISOString()
    };
    this.ideas.set(ideaId, updated);
    return Promise.resolve(updated);
  }

  findCollectionByIdempotencyKey(idempotencyKey: string): Promise<CollectIdeasResponse | null> {
    return Promise.resolve(this.collectionResults.get(idempotencyKey) ?? null);
  }

  saveCollectionResult(idempotencyKey: string, result: CollectIdeasResponse): Promise<void> {
    this.collectionResults.set(idempotencyKey, result);
    return Promise.resolve();
  }
}

const baseSettings = (channelId = "channel-1"): ChannelCollectionSettings => ({
  channelId,
  topic: "rocket science",
  excludedTopics: ["medical advice"],
  keywords: ["rocket", "ocean"],
  excludedKeywords: ["investment"],
  allowedSources: [],
  excludedSources: [],
  recencyHours: 72
});

const candidate = (overrides: Partial<TopicSourceCandidate> = {}): TopicSourceCandidate => ({
  title: "Reusable rocket test",
  summary: "Reusable rocket performance improved.",
  url: "https://Example.org/science/rocket?utm_source=test#section",
  sourceName: "Example Science",
  sourceKind: "RSS",
  publishedAt: new Date().toISOString(),
  body: "rocket booster recovery",
  reliabilityScore: 0.8,
  ...overrides
});

const createService = (provider: TopicSourceProvider = new StaticTopicSourceProvider([candidate()])) => {
  const repository = new MemoryIdeasRepository();
  repository.addSettings("workspace-1", baseSettings());
  repository.addSettings("workspace-2", baseSettings("channel-2"));
  return {
    repository,
    service: new IdeasService(repository, new TestProviderFactory(provider))
  };
};

describe("IdeasService", () => {
  it("uses the common preview predicate for API collection and retains unapproved NASA references", async () => {
    const refs = [{ href: "https://images-assets.nasa.gov/image/SPACE/SPACE~thumb.jpg", rel: "preview", render: "image" }];
    const { service, repository } = createService(new StaticTopicSourceProvider([candidate({ url: "https://example.org/good", reliabilityMetadata: { media: { references: refs, rights: "ITEM_REVIEW_REQUIRED" } } }), candidate({ url: "https://example.org/bad", reliabilityMetadata: { media: { references: [{ url: "https://images.nasa.gov/details/SPACE" }] } } })]));
    repository.addSettings("workspace-1", { ...baseSettings(), requireVisualEvidence: true });
    const result = await service.collect("workspace-1", { channelId: "channel-1", idempotencyKey: "api-nasa-visual", source: "auto" });
    expect(result.created).toBe(1); expect(result.rejected).toBe(1);
  });
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("canonicalizes URLs before hashing and storage", () => {
    expect(canonicalizeUrl("https://Example.org/path/?utm_source=x&b=2&a=1#top")).toBe("https://example.org/path?a=1&b=2");
  });

  it("deduplicates collected candidates by canonical URL", async () => {
    const { service } = createService(new StaticTopicSourceProvider([candidate(), candidate({ title: "Same URL" })]));

    const result = await service.collect("workspace-1", {
      channelId: "channel-1",
      idempotencyKey: "collect-deduplication",
      source: "auto"
    });

    expect(result.created).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it("rejects forbidden topics and excluded keywords", async () => {
    const { service } = createService(
      new StaticTopicSourceProvider([
        candidate({ title: "Medical advice rocket", body: "medical advice" }),
        candidate({ title: "Rocket investment tip", body: "investment" })
      ])
    );

    const result = await service.collect("workspace-1", {
      channelId: "channel-1",
      idempotencyKey: "collect-blocked-topics",
      source: "auto"
    });

    expect(result.created).toBe(0);
    expect(result.rejected).toBe(2);
  });

  it("keeps channel ideas separated", async () => {
    const { service } = createService();

    await service.collect("workspace-1", {
      channelId: "channel-1",
      idempotencyKey: "collect-channel-one",
      source: "auto"
    });
    await service.collect("workspace-2", {
      channelId: "channel-2",
      idempotencyKey: "collect-channel-two",
      source: "auto"
    });

    await expect(service.list("workspace-1", "channel-2", undefined)).resolves.toEqual({ ideas: [] });
    await expect(service.list("workspace-1", "channel-1", "CANDIDATE")).resolves.toHaveProperty("ideas.length", 1);
  });

  it("returns cached result for repeated idempotency keys", async () => {
    const { service } = createService();
    const input = {
      channelId: "channel-1",
      idempotencyKey: "collect-idempotent",
      source: "auto"
    };

    const first = await service.collect("workspace-1", input);
    const second = await service.collect("workspace-1", input);

    expect(second).toEqual(first);
  });

  it("surfaces source failures for queue retry", async () => {
    const { service } = createService(new FailingTopicSourceProvider());

    await expect(
      service.collect("workspace-1", {
        channelId: "channel-1",
        idempotencyKey: "collect-failure",
        source: "auto"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("supports idea status management", async () => {
    const { service } = createService();
    const result = await service.collect("workspace-1", {
      channelId: "channel-1",
      idempotencyKey: "collect-status",
      source: "auto"
    });

    const updated = await service.updateStatus("workspace-1", result.ideas[0]?.id ?? "", {
      status: "SHORTLISTED"
    });

    expect(updated.status).toBe("SHORTLISTED");
  });

  it("blocks collection for channels outside the workspace", async () => {
    const { service } = createService();

    await expect(
      service.collect("workspace-1", {
        channelId: "channel-2",
        idempotencyKey: "collect-wrong-workspace",
        source: "auto"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
