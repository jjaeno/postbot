import "reflect-metadata";
import type { CanActivate, ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  ChannelListResponseSchema,
  ChannelResponseSchema,
  ErrorResponseSchema,
  type ChannelResponse,
  type ChannelStatus,
  type CreateChannelRequest,
  type Platform,
  type UpdateChannelRequest
} from "@postbot/contracts";
import type { Server } from "node:http";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { HttpExceptionResponseFilter } from "../http-exception.filter.js";
import { ChannelsController } from "./channels.controller.js";
import {
  CHANNELS_REPOSITORY,
  type AssignPlatformAccountResult,
  type ChannelsRepository
} from "./channels.repository.js";
import { ChannelsService } from "./channels.service.js";

const channelInput = (): CreateChannelRequest => ({
  name: "1분 과학",
  description: "과학 뉴스를 숏폼으로 설명합니다.",
  language: "ko",
  targetAudience: "과학에 관심 있는 성인",
  topic: "우주 과학",
  excludedTopics: ["의학 조언"],
  platforms: ["YOUTUBE"],
  collectionRule: {
    keywords: ["우주", "천문학"],
    excludedKeywords: ["투자"],
    allowedSources: ["https://www.nasa.gov"],
    excludedSources: [],
    recencyHours: 72,
    collectionFrequencyMinutes: 360
  },
  template: {
    name: "기본 세로형",
    tone: "명확하고 차분함",
    voiceProfile: "neutral-ko",
    subtitleStyle: { size: "large" },
    visualStyle: { aspectRatio: "9:16" },
    aiStockRatio: 0.5
  },
  outputProfiles: [
    {
      platform: "YOUTUBE",
      minDurationSeconds: 30,
      maxDurationSeconds: 90,
      hookStyle: "question",
      captionStyle: "readable",
      metadataRules: { hashtags: ["science"] },
      publicSetting: "PUBLIC"
    }
  ],
  scheduleRules: [
    {
      platform: "YOUTUBE",
      dayOfWeek: 1,
      timeOfDayLocal: "09:00",
      timezone: "Asia/Seoul",
      maxPosts: 1
    }
  ],
  automation: {
    mode: "APPROVAL",
    minInventoryCount: 3,
    dailyPublishLimit: 1,
    errorAction: {
      onPolicyFailure: "hold",
      onAssetLicenseUnknown: "hold",
      onConsecutiveFailures: "pause_channel"
    }
  }
});

class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ auth?: unknown }>();
    req.auth = {
      userId: "user-1",
      workspaceId: "workspace-1",
      user: { id: "user-1", email: "owner@example.com", displayName: "Owner", timezone: "Asia/Seoul" },
      workspace: { id: "workspace-1", name: "Owner workspace", slug: "owner", role: "OWNER" }
    };
    return true;
  }
}

class FakeChannelsRepository implements ChannelsRepository {
  private channels = new Map<string, ChannelResponse>();
  private platformAccounts = new Map<string, { workspaceId: string; platform: Platform; channelId: string | null }>();

  list(workspaceId: string): Promise<ChannelResponse[]> {
    return Promise.resolve([...this.channels.values()].filter((channel) => channel.workspaceId === workspaceId));
  }

  find(workspaceId: string, channelId: string): Promise<ChannelResponse | null> {
    const channel = this.channels.get(channelId);
    return Promise.resolve(channel?.workspaceId === workspaceId ? channel : null);
  }

  create(workspaceId: string, input: CreateChannelRequest): Promise<ChannelResponse> {
    const id = `channel-${this.channels.size + 1}`;
    const now = new Date().toISOString();
    const channel: ChannelResponse = {
      id,
      workspaceId,
      name: input.name,
      slug: input.name,
      description: input.description,
      language: input.language,
      targetAudience: input.targetAudience,
      topic: input.topic,
      excludedTopics: input.excludedTopics,
      status: "ACTIVE",
      automationMode: input.automation.mode,
      minInventoryCount: input.automation.minInventoryCount,
      dailyPublishLimit: input.automation.dailyPublishLimit,
      errorAction: input.automation.errorAction,
      collectionRule: input.collectionRule,
      template: input.template,
      outputProfiles: input.outputProfiles,
      scheduleRules: input.scheduleRules,
      platformConnections: input.platforms.map((platform) => ({
        platform,
        status: "PLANNED",
        handle: null,
        displayName: null
      })),
      createdAt: now,
      updatedAt: now
    };
    this.channels.set(id, channel);
    return Promise.resolve(channel);
  }

  update(workspaceId: string, channelId: string, input: UpdateChannelRequest): Promise<ChannelResponse | null> {
    const channel = this.channels.get(channelId);
    if (!channel || channel.workspaceId !== workspaceId) {
      return Promise.resolve(null);
    }
    const updated: ChannelResponse = {
      ...channel,
      ...input,
      automationMode: input.automation?.mode ?? channel.automationMode,
      minInventoryCount: input.automation?.minInventoryCount ?? channel.minInventoryCount,
      dailyPublishLimit: input.automation?.dailyPublishLimit ?? channel.dailyPublishLimit,
      errorAction: input.automation?.errorAction ?? channel.errorAction,
      updatedAt: new Date().toISOString()
    };
    this.channels.set(channelId, updated);
    return Promise.resolve(updated);
  }

  setStatus(workspaceId: string, channelId: string, status: ChannelStatus): Promise<ChannelResponse | null> {
    return this.update(workspaceId, channelId, { status });
  }

  assignPlatformAccount(
    workspaceId: string,
    channelId: string,
    platformAccountId: string
  ): Promise<AssignPlatformAccountResult> {
    const channel = this.channels.get(channelId);
    const account = this.platformAccounts.get(platformAccountId);
    if (!channel || channel.workspaceId !== workspaceId) {
      return Promise.resolve({ ok: false, reason: "CHANNEL_NOT_FOUND" });
    }
    if (!account || account.workspaceId !== workspaceId) {
      return Promise.resolve({ ok: false, reason: "ACCOUNT_NOT_FOUND" });
    }
    if (account.channelId && account.channelId !== channelId) {
      return Promise.resolve({ ok: false, reason: "ACCOUNT_ALREADY_ASSIGNED" });
    }
    account.channelId = channelId;
    return Promise.resolve({ ok: true });
  }

  createFakePlatformAccount(workspaceId: string, platform: Platform, externalAccountId: string): Promise<string> {
    const id = `account-${this.platformAccounts.size + 1}`;
    this.platformAccounts.set(id, { workspaceId, platform, channelId: null });
    void externalAccountId;
    return Promise.resolve(id);
  }
}

describe("Channels API", () => {
  let app: INestApplication;
  let repository: FakeChannelsRepository;
  const httpServer = (): Server => app.getHttpServer() as Server;

  beforeEach(async () => {
    repository = new FakeChannelsRepository();
    const moduleRef = await Test.createTestingModule({
      controllers: [ChannelsController],
      providers: [ChannelsService, { provide: CHANNELS_REPOSITORY, useValue: repository }]
    })
      .overrideGuard(AccessTokenGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionResponseFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates, lists, updates, pauses, and resumes a channel", async () => {
    const created = await request(httpServer()).post("/channels").send(channelInput()).expect(201);
    const channel = ChannelResponseSchema.parse(created.body);
    expect(channel.platformConnections[0]?.status).toBe("PLANNED");

    await request(httpServer()).get("/channels").expect(200).expect(({ body }) => {
      expect(ChannelListResponseSchema.parse(body).channels).toHaveLength(1);
    });

    await request(httpServer())
      .patch(`/channels/${channel.id}`)
      .send({ name: "오늘의 과학" })
      .expect(200)
      .expect(({ body }) => {
        expect(ChannelResponseSchema.parse(body).name).toBe("오늘의 과학");
      });

    await request(httpServer()).post(`/channels/${channel.id}/pause`).expect(201).expect(({ body }) => {
      expect(ChannelResponseSchema.parse(body).status).toBe("PAUSED");
    });
    await request(httpServer()).post(`/channels/${channel.id}/resume`).expect(201).expect(({ body }) => {
      expect(ChannelResponseSchema.parse(body).status).toBe("ACTIVE");
    });
  });

  it("rejects invalid schedules", async () => {
    await request(httpServer())
      .post("/channels")
      .send({ ...channelInput(), scheduleRules: [{ ...channelInput().scheduleRules[0], dayOfWeek: 8 }] })
      .expect(400)
      .expect(({ body }) => {
        expect(ErrorResponseSchema.parse(body).code).toBe("BAD_REQUEST");
      });
  });

  it("blocks duplicate platform account assignment", async () => {
    const first = ChannelResponseSchema.parse((await request(httpServer()).post("/channels").send(channelInput())).body);
    const second = ChannelResponseSchema.parse(
      (await request(httpServer()).post("/channels").send({ ...channelInput(), name: "과학 브리핑" })).body
    );
    const accountId = await repository.createFakePlatformAccount("workspace-1", "YOUTUBE", "yt-1");

    await request(httpServer()).put(`/channels/${first.id}/platform-accounts/${accountId}`).expect(200);
    await request(httpServer()).put(`/channels/${second.id}/platform-accounts/${accountId}`).expect(409);
  });

  it("does not expose channels from another workspace", async () => {
    const channel = await repository.create("workspace-2", channelInput());
    await request(httpServer()).get(`/channels/${channel.id}`).expect(404);
  });
});
