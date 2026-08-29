import type { Platform, PlatformAccountListResponse, PlatformAccountResponse } from "@postbot/contracts";

export const PLATFORM_ACCOUNTS_REPOSITORY = Symbol("PLATFORM_ACCOUNTS_REPOSITORY");

export type StoredOAuthState = {
  id: string;
  workspaceId: string;
  channelId: string | null;
  platform: Platform;
  encryptedCodeVerifier: string;
  tokenCipher: "aes-256-gcm";
  tokenKeyVersion: number;
  scopes: string[];
  redirectUri: string;
  provider: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type OAuthStateInput = {
  workspaceId: string;
  channelId: string | null;
  platform: Platform;
  stateHash: string;
  encryptedCodeVerifier: string;
  tokenCipher: "aes-256-gcm";
  tokenKeyVersion: number;
  scopes: string[];
  redirectUri: string;
  provider: string;
  expiresAt: Date;
};

export type ConnectPlatformAccountInput = {
  workspaceId: string;
  channelId: string | null;
  platform: Platform;
  externalAccountId: string;
  handle: string | null;
  displayName: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenCipher: "aes-256-gcm";
  tokenKeyVersion: number;
  scopes: string[];
  scopeHash: string;
  expiresAt: Date | null;
};

export type ConnectPlatformAccountResult =
  | { ok: true; account: PlatformAccountResponse }
  | { ok: false; reason: "CHANNEL_NOT_FOUND" | "ACCOUNT_OWNED_BY_OTHER_WORKSPACE" | "ACCOUNT_ASSIGNED_TO_OTHER_CHANNEL" | "CHANNEL_PLATFORM_OCCUPIED" };

export type PlatformAccountsRepository = {
  list(workspaceId: string): Promise<PlatformAccountListResponse>;
  createOAuthState(input: OAuthStateInput): Promise<void>;
  consumeOAuthState(stateHash: string): Promise<StoredOAuthState | null>;
  connect(input: ConnectPlatformAccountInput): Promise<ConnectPlatformAccountResult>;
  findCredential(
    workspaceId: string,
    platformAccountId: string
  ): Promise<{
    account: PlatformAccountResponse;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenCipher: "aes-256-gcm";
    tokenKeyVersion: number;
  } | null>;
  disconnect(workspaceId: string, platformAccountId: string): Promise<PlatformAccountResponse | null>;
};
