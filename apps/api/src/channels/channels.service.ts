import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CreateChannelRequestSchema,
  UpdateChannelRequestSchema,
  type ChannelListResponse,
  type ChannelResponse,
  type ChannelStatus,
  type CreateChannelRequest,
  type Platform,
  type UpdateChannelRequest
} from "@postbot/contracts";
import type { z } from "zod";
import { CHANNELS_REPOSITORY, type ChannelsRepository } from "./channels.repository.js";

const parseBody = <Schema extends z.ZodType>(schema: Schema, rawInput: unknown): z.infer<Schema> => {
  const result = schema.safeParse(rawInput);
  if (!result.success) {
    throw new BadRequestException(result.error.issues[0]?.message ?? "채널 설정값을 확인해 주세요.");
  }
  return result.data;
};

@Injectable()
export class ChannelsService {
  constructor(@Inject(CHANNELS_REPOSITORY) private readonly repository: ChannelsRepository) {}

  async list(workspaceId: string): Promise<ChannelListResponse> {
    return { channels: await this.repository.list(workspaceId) };
  }

  async get(workspaceId: string, channelId: string): Promise<ChannelResponse> {
    const channel = await this.repository.find(workspaceId, channelId);
    if (!channel) {
      throw new NotFoundException("채널을 찾을 수 없습니다.");
    }
    return channel;
  }

  create(workspaceId: string, rawInput: unknown): Promise<ChannelResponse> {
    const input: CreateChannelRequest = parseBody(CreateChannelRequestSchema, rawInput);
    if (input.automation.errorAction.onPolicyFailure === "regenerate") throw new BadRequestException("POLICY_AUTO_REGENERATION_UNSUPPORTED_USE_HOLD");
    return this.repository.create(workspaceId, input);
  }

  async update(workspaceId: string, channelId: string, rawInput: unknown): Promise<ChannelResponse> {
    const input: UpdateChannelRequest = parseBody(UpdateChannelRequestSchema, rawInput);
    if (input.automation?.errorAction.onPolicyFailure === "regenerate") throw new BadRequestException("POLICY_AUTO_REGENERATION_UNSUPPORTED_USE_HOLD");
    const channel = await this.repository.update(workspaceId, channelId, input);
    if (!channel) {
      throw new NotFoundException("채널을 찾을 수 없습니다.");
    }
    return channel;
  }

  async setStatus(workspaceId: string, channelId: string, status: ChannelStatus): Promise<ChannelResponse> {
    const channel = await this.repository.setStatus(workspaceId, channelId, status);
    if (!channel) {
      throw new NotFoundException("채널을 찾을 수 없습니다.");
    }
    return channel;
  }

  async assignPlatformAccount(
    workspaceId: string,
    channelId: string,
    platformAccountId: string
  ): Promise<{ ok: true }> {
    const result = await this.repository.assignPlatformAccount(workspaceId, channelId, platformAccountId);
    if (result.ok) {
      return result;
    }
    if (result.reason === "CHANNEL_NOT_FOUND" || result.reason === "ACCOUNT_NOT_FOUND") {
      throw new NotFoundException("채널 또는 플랫폼 계정을 찾을 수 없습니다.");
    }
    throw new ConflictException("이미 다른 채널에 연결된 플랫폼 계정입니다.");
  }

  createFakePlatformAccount(workspaceId: string, platform: Platform, externalAccountId: string): Promise<string> {
    return this.repository.createFakePlatformAccount(workspaceId, platform, externalAccountId);
  }
}
