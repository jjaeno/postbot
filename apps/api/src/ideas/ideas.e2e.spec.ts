import "reflect-metadata";
import type { CanActivate, ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CollectIdeasResponseSchema, ContentIdeaListResponseSchema, ContentIdeaSchema, type ContentIdea } from "@postbot/contracts";
import type { Server } from "node:http";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { HttpExceptionResponseFilter } from "../http-exception.filter.js";
import { IdeasController } from "./ideas.controller.js";
import { IDEAS_REPOSITORY, type ChannelCollectionSettings, type IdeasRepository, type SaveIdeasResult, type ScoredIdeaCandidate } from "./ideas.repository.js";
import { IdeasService } from "./ideas.service.js";
import { TopicSourceProviderFactory } from "./topic-source-provider.factory.js";

class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ auth?: unknown }>();
    req.auth = {
      userId: "user-1",
      workspaceId: "workspace-1",
      user: { id: "user-1", email: "owner@example.com", displayName: "Owner", timezone: "Asia/Seoul" },
      workspace: { id: "workspace-1", name: "Workspace", slug: "workspace", role: "OWNER" }
    };
    return true;
  }
}

class E2eIdeasRepository implements IdeasRepository {
  readonly ideas: ContentIdea[] = [];

  getChannelSettings(workspaceId: string, channelId: string): Promise<ChannelCollectionSettings | null> {
    if (workspaceId !== "workspace-1" || channelId !== "channel-1") {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      channelId,
      topic: "rocket",
      excludedTopics: [],
      keywords: ["rocket"],
      excludedKeywords: [],
      allowedSources: [],
      excludedSources: [],
      recencyHours: 72
    });
  }

  saveCandidates(channelId: string, provider: string, candidates: readonly ScoredIdeaCandidate[]): Promise<SaveIdeasResult> {
    const now = new Date().toISOString();
    const created = candidates
      .filter((candidate) => !candidate.rejectionReason)
      .map<ContentIdea>((candidate, index) => ({
        id: `idea-${this.ideas.length + index + 1}`,
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
      }));
    this.ideas.push(...created);
    return Promise.resolve({ created: created.length, duplicates: 0, rejected: candidates.length - created.length, ideas: created });
  }

  list(): Promise<ContentIdea[]> {
    return Promise.resolve(this.ideas);
  }

  updateStatus(_workspaceId: string, ideaId: string): Promise<ContentIdea | null> {
    const idea = this.ideas.find((item) => item.id === ideaId);
    if (!idea) {
      return Promise.resolve(null);
    }
    idea.status = "SHORTLISTED";
    return Promise.resolve(idea);
  }

  findCollectionByIdempotencyKey(): Promise<null> {
    return Promise.resolve(null);
  }

  saveCollectionResult(): Promise<void> {
    return Promise.resolve();
  }
}

describe("IdeasController", () => {
  let app: INestApplication;
  let server: Server;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdeasController],
      providers: [
        IdeasService,
        TopicSourceProviderFactory,
        {
          provide: IDEAS_REPOSITORY,
          useClass: E2eIdeasRepository
        }
      ]
    })
      .overrideGuard(AccessTokenGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionResponseFilter());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it("collects, lists, and updates ideas over HTTP", async () => {
    const collect = await request(server)
      .post("/ideas/collect")
      .send({
        channelId: "channel-1",
        idempotencyKey: "api-e2e-collect",
        source: "manual",
        manualCandidates: [
          {
            title: "Rocket explainer",
            summary: "Reusable rocket story",
            url: "https://example.org/rocket?utm_source=e2e",
            sourceName: "Manual",
            sourceKind: "MANUAL",
            publishedAt: new Date().toISOString(),
            body: "rocket",
            reliabilityScore: 0.7
          }
        ]
      })
      .expect(201);

    const parsedCollect = CollectIdeasResponseSchema.parse(collect.body);
    expect(parsedCollect.created).toBe(1);

    const list = await request(server).get("/ideas/channels/channel-1").expect(200);
    const parsedList = ContentIdeaListResponseSchema.parse(list.body);
    expect(parsedList.ideas).toHaveLength(1);

    const update = await request(server)
      .patch(`/ideas/${parsedList.ideas[0]?.id ?? ""}/status`)
      .send({ status: "SHORTLISTED" })
      .expect(200);

    expect(ContentIdeaSchema.parse(update.body).status).toBe("SHORTLISTED");
  });
});
