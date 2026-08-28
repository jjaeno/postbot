import { Inject, Injectable } from "@nestjs/common";
import type {
  ChannelResponse,
  ChannelStatus,
  CreateChannelRequest,
  Platform,
  PlatformConnection,
  UpdateChannelRequest
} from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import type { AssignPlatformAccountResult, ChannelsRepository } from "./channels.repository.js";

type ChannelWithSettings = Prisma.ChannelGetPayload<{
  include: {
    collectionRules: true;
    templates: true;
    outputProfiles: true;
    scheduleRules: true;
    platformAccounts: true;
  };
}>;

const channelInclude = {
  collectionRules: { where: { isActive: true }, orderBy: { version: "desc" as const }, take: 1 },
  templates: { where: { isActive: true }, orderBy: { version: "desc" as const }, take: 1 },
  outputProfiles: { where: { isActive: true }, orderBy: { platform: "asc" as const } },
  scheduleRules: { where: { isActive: true }, orderBy: [{ dayOfWeek: "asc" as const }, { timeOfDayUtc: "asc" as const }] },
  platformAccounts: true
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

const jsonArray = (value: Prisma.JsonValue | null | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const jsonObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const inputJsonObject = (value: Record<string, unknown>): Prisma.InputJsonObject =>
  value as Prisma.InputJsonObject;

const toPlatformConnections = (
  selectedPlatforms: Platform[],
  accounts: ChannelWithSettings["platformAccounts"]
): PlatformConnection[] =>
  selectedPlatforms.map((platform) => {
    const account = accounts.find((item) => item.platform === platform);
    return account
      ? {
          platform,
          status: account.status === "DISCONNECTED" ? "PLANNED" : account.status,
          handle: account.handle,
          displayName: account.displayName
        }
      : {
          platform,
          status: "PLANNED",
          handle: null,
          displayName: null
        };
  });

const toResponse = (channel: ChannelWithSettings): ChannelResponse => {
  const collectionRule = channel.collectionRules[0];
  const template = channel.templates[0];
  const outputProfiles = channel.outputProfiles.map((profile) => ({
    platform: profile.platform,
    minDurationSeconds: profile.minDurationSeconds,
    maxDurationSeconds: profile.maxDurationSeconds,
    hookStyle: profile.hookStyle ?? "question",
    captionStyle: profile.captionStyle ?? "readable",
    metadataRules: jsonObject(profile.metadataRules),
    publicSetting: profile.publicSetting as "PUBLIC" | "UNLISTED" | "PRIVATE"
  }));
  const platforms = outputProfiles.map((profile) => profile.platform);

  return {
    id: channel.id,
    workspaceId: channel.workspaceId,
    name: channel.name,
    slug: channel.slug,
    description: channel.description ?? "",
    language: channel.language,
    targetAudience: channel.targetAudience ?? "",
    topic: channel.topic ?? "",
    excludedTopics: jsonArray(channel.excludedTopics),
    status: channel.status,
    automationMode: channel.automationMode,
    minInventoryCount: channel.minInventoryCount,
    dailyPublishLimit: channel.dailyPublishLimit,
    errorAction: {
      onPolicyFailure: (jsonObject(channel.errorAction).onPolicyFailure as "hold" | "regenerate" | undefined) ?? "hold",
      onAssetLicenseUnknown: "hold",
      onConsecutiveFailures:
        (jsonObject(channel.errorAction).onConsecutiveFailures as "pause_channel" | "notify_only" | undefined) ??
        "pause_channel"
    },
    collectionRule: {
      keywords: collectionRule ? jsonArray(collectionRule.keywords) : [],
      excludedKeywords: collectionRule ? jsonArray(collectionRule.excludedKeywords) : [],
      allowedSources: collectionRule ? jsonArray(collectionRule.allowedSources) : [],
      excludedSources: collectionRule ? jsonArray(collectionRule.excludedSources) : [],
      recencyHours: collectionRule?.recencyHours ?? 72,
      collectionFrequencyMinutes: collectionRule?.collectionFrequencyMinutes ?? 360
    },
    template: {
      name: template?.name ?? "Default vertical short",
      tone: template?.tone ?? "clear",
      voiceProfile: template?.voiceProfile ?? "neutral",
      subtitleStyle: jsonObject(template?.subtitleStyle),
      visualStyle: jsonObject(template?.visualStyle),
      aiStockRatio: template ? Number(template.aiStockRatio) : 0.5
    },
    outputProfiles,
    scheduleRules: channel.scheduleRules.map((rule) => ({
      platform: rule.platform,
      dayOfWeek: rule.dayOfWeek,
      timeOfDayLocal: rule.timeOfDayUtc.slice(0, 5),
      timezone: rule.timezone,
      maxPosts: rule.maxPosts
    })),
    platformConnections: toPlatformConnections(platforms, channel.platformAccounts),
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString()
  };
};

@Injectable()
export class PrismaChannelsRepository implements ChannelsRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async list(workspaceId: string): Promise<ChannelResponse[]> {
    const channels = await this.prisma.channel.findMany({
      where: { workspaceId },
      include: channelInclude,
      orderBy: { createdAt: "desc" }
    });
    return channels.map(toResponse);
  }

  async find(workspaceId: string, channelId: string): Promise<ChannelResponse | null> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, workspaceId },
      include: channelInclude
    });
    return channel ? toResponse(channel) : null;
  }

  async create(workspaceId: string, input: CreateChannelRequest): Promise<ChannelResponse> {
    const channelId = await this.prisma.$transaction(async (tx) => {
      const channel = await tx.channel.create({
        data: {
          workspaceId,
          name: input.name,
          slug: slugify(input.name),
          description: input.description,
          language: input.language,
          targetAudience: input.targetAudience,
          topic: input.topic,
          excludedTopics: input.excludedTopics,
          automationMode: input.automation.mode,
          minInventoryCount: input.automation.minInventoryCount,
          dailyPublishLimit: input.automation.dailyPublishLimit,
          errorAction: input.automation.errorAction
        }
      });
      await this.replaceSettings(tx, channel.id, input);
      return channel.id;
    });
    const created = await this.find(workspaceId, channelId);
    if (!created) {
      throw new Error("created channel missing");
    }
    return created;
  }

  async update(workspaceId: string, channelId: string, input: UpdateChannelRequest): Promise<ChannelResponse | null> {
    const existing = await this.find(workspaceId, channelId);
    if (!existing) {
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          name: input.name,
          description: input.description,
          language: input.language,
          targetAudience: input.targetAudience,
          topic: input.topic,
          excludedTopics: input.excludedTopics,
          status: input.status,
          automationMode: input.automation?.mode,
          minInventoryCount: input.automation?.minInventoryCount,
          dailyPublishLimit: input.automation?.dailyPublishLimit,
          errorAction: input.automation?.errorAction
        }
      });
      await this.replaceSettings(tx, channelId, {
        ...existing,
        ...input,
        platforms: input.platforms ?? existing.outputProfiles.map((profile) => profile.platform),
        collectionRule: input.collectionRule ?? existing.collectionRule,
        template: input.template ?? existing.template,
        outputProfiles: input.outputProfiles ?? existing.outputProfiles,
        scheduleRules: input.scheduleRules ?? existing.scheduleRules,
        automation: input.automation ?? {
          mode: existing.automationMode,
          minInventoryCount: existing.minInventoryCount,
          dailyPublishLimit: existing.dailyPublishLimit,
          errorAction: existing.errorAction
        }
      });
    });
    return this.find(workspaceId, channelId);
  }

  async setStatus(workspaceId: string, channelId: string, status: ChannelStatus): Promise<ChannelResponse | null> {
    const updated = await this.prisma.channel.updateMany({
      where: { id: channelId, workspaceId },
      data: { status }
    });
    return updated.count === 0 ? null : this.find(workspaceId, channelId);
  }

  async assignPlatformAccount(
    workspaceId: string,
    channelId: string,
    platformAccountId: string
  ): Promise<AssignPlatformAccountResult> {
    const [channel, account] = await Promise.all([
      this.prisma.channel.findFirst({ where: { id: channelId, workspaceId } }),
      this.prisma.platformAccount.findFirst({ where: { id: platformAccountId, workspaceId } })
    ]);
    if (!channel) {
      return { ok: false, reason: "CHANNEL_NOT_FOUND" };
    }
    if (!account) {
      return { ok: false, reason: "ACCOUNT_NOT_FOUND" };
    }
    if (account.channelId && account.channelId !== channelId) {
      return { ok: false, reason: "ACCOUNT_ALREADY_ASSIGNED" };
    }
    const occupied = await this.prisma.platformAccount.findFirst({
      where: { channelId, platform: account.platform, id: { not: platformAccountId } }
    });
    if (occupied) {
      return { ok: false, reason: "CHANNEL_PLATFORM_OCCUPIED" };
    }
    await this.prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: { channelId }
    });
    return { ok: true };
  }

  async createFakePlatformAccount(workspaceId: string, platform: Platform, externalAccountId: string): Promise<string> {
    const account = await this.prisma.platformAccount.create({
      data: {
        workspaceId,
        platform,
        externalAccountId,
        handle: externalAccountId,
        status: "DISCONNECTED"
      }
    });
    return account.id;
  }

  private async replaceSettings(
    tx: Prisma.TransactionClient,
    channelId: string,
    input: CreateChannelRequest
  ): Promise<void> {
    const [collectionRule, template, outputProfile, scheduleRule] = await Promise.all([
      tx.collectionRule.findFirst({ where: { channelId }, orderBy: { version: "desc" } }),
      tx.channelTemplate.findFirst({ where: { channelId }, orderBy: { version: "desc" } }),
      tx.platformOutputProfile.findFirst({ where: { channelId }, orderBy: { version: "desc" } }),
      tx.scheduleRule.findFirst({ where: { channelId }, orderBy: { createdAt: "desc" } })
    ]);
    const nextVersion =
      Math.max(
        collectionRule?.version ?? 0,
        template?.version ?? 0,
        outputProfile?.version ?? 0,
        scheduleRule ? 1 : 0
      ) + 1;
    await Promise.all([
      tx.collectionRule.updateMany({ where: { channelId }, data: { isActive: false } }),
      tx.channelTemplate.updateMany({ where: { channelId }, data: { isActive: false } }),
      tx.platformOutputProfile.updateMany({ where: { channelId }, data: { isActive: false } }),
      tx.scheduleRule.updateMany({ where: { channelId }, data: { isActive: false } })
    ]);
    await tx.collectionRule.create({
      data: {
        channelId,
        version: nextVersion,
        keywords: input.collectionRule.keywords,
        excludedKeywords: input.collectionRule.excludedKeywords,
        allowedSources: input.collectionRule.allowedSources,
        excludedSources: input.collectionRule.excludedSources,
        recencyHours: input.collectionRule.recencyHours,
        collectionFrequencyMinutes: input.collectionRule.collectionFrequencyMinutes,
        isActive: true
      }
    });
    await tx.channelTemplate.create({
      data: {
        channelId,
        version: nextVersion,
        name: input.template.name,
        tone: input.template.tone,
        voiceProfile: input.template.voiceProfile,
        subtitleStyle: inputJsonObject(input.template.subtitleStyle),
        visualStyle: inputJsonObject(input.template.visualStyle),
        aiStockRatio: new Prisma.Decimal(input.template.aiStockRatio),
        isActive: true
      }
    });
    await tx.platformOutputProfile.createMany({
      data: input.outputProfiles.map((profile) => ({
        channelId,
        platform: profile.platform,
        version: nextVersion,
        minDurationSeconds: profile.minDurationSeconds,
        maxDurationSeconds: profile.maxDurationSeconds,
        hookStyle: profile.hookStyle,
        captionStyle: profile.captionStyle,
        metadataRules: inputJsonObject(profile.metadataRules),
        publicSetting: profile.publicSetting,
        isActive: true
      }))
    });
    await tx.scheduleRule.createMany({
      data: input.scheduleRules.map((rule) => ({
        channelId,
        platform: rule.platform,
        dayOfWeek: rule.dayOfWeek,
        timeOfDayUtc: `${rule.timeOfDayLocal}:00`,
        timezone: rule.timezone,
        maxPosts: rule.maxPosts,
        isActive: true
      }))
    });
  }
}
