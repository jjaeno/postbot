import type {
  ChannelResponse,
  ChannelStatus,
  CreateChannelRequest,
  Platform,
  UpdateChannelRequest
} from "@postbot/contracts";

export const CHANNELS_REPOSITORY = Symbol("CHANNELS_REPOSITORY");

export type AssignPlatformAccountResult =
  | { ok: true }
  | { ok: false; reason: "CHANNEL_NOT_FOUND" | "ACCOUNT_NOT_FOUND" | "ACCOUNT_ALREADY_ASSIGNED" | "CHANNEL_PLATFORM_OCCUPIED" };

export type ChannelsRepository = {
  list(workspaceId: string): Promise<ChannelResponse[]>;
  find(workspaceId: string, channelId: string): Promise<ChannelResponse | null>;
  create(workspaceId: string, input: CreateChannelRequest): Promise<ChannelResponse>;
  update(workspaceId: string, channelId: string, input: UpdateChannelRequest): Promise<ChannelResponse | null>;
  setStatus(workspaceId: string, channelId: string, status: ChannelStatus): Promise<ChannelResponse | null>;
  assignPlatformAccount(
    workspaceId: string,
    channelId: string,
    platformAccountId: string
  ): Promise<AssignPlatformAccountResult>;
  createFakePlatformAccount(workspaceId: string, platform: Platform, externalAccountId: string): Promise<string>;
};
