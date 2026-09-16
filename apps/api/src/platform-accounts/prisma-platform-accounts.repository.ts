import { Inject, Injectable } from "@nestjs/common";
import { type PlatformAccountResponse } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import type {
  ConnectPlatformAccountInput,
  ConnectPlatformAccountResult,
  OAuthStateInput,
  PlatformAccountsRepository,
  StoredOAuthState
} from "./platform-accounts.repository.js";

type AccountWithCredential = Prisma.PlatformAccountGetPayload<{
  include: { credential: true };
}>;

const jsonArray = (value: Prisma.JsonValue | null | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const toConnectionStatus = (account: AccountWithCredential): PlatformAccountResponse["status"] => {
  if (account.status === "CONNECTED" && account.credential?.expiresAt && account.credential.expiresAt <= new Date()) {
    return "EXPIRED";
  }
  if (account.status === "DISCONNECTED") {
    return "PLANNED";
  }
  return account.status;
};

const toAccountResponse = (account: AccountWithCredential): PlatformAccountResponse => ({
  id: account.id,
  workspaceId: account.workspaceId,
  channelId: account.channelId,
  platform: account.platform,
  externalAccountId: account.externalAccountId,
  handle: account.handle,
  displayName: account.displayName,
  status: toConnectionStatus(account),
  scopes: jsonArray(account.credential?.scopes),
  expiresAt: account.credential?.expiresAt?.toISOString() ?? null,
  connectedAt: account.connectedAt?.toISOString() ?? null,
  disconnectedAt: account.disconnectedAt?.toISOString() ?? null
});

@Injectable()
export class PrismaPlatformAccountsRepository implements PlatformAccountsRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async list(workspaceId: string): Promise<{ accounts: PlatformAccountResponse[] }> {
    const accounts = await this.prisma.platformAccount.findMany({
      where: { workspaceId },
      include: { credential: true },
      orderBy: { updatedAt: "desc" }
    });
    return { accounts: accounts.map(toAccountResponse) };
  }

  async createOAuthState(input: OAuthStateInput): Promise<void> {
    await this.prisma.oAuthConnectionState.create({
      data: {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        platform: input.platform,
        stateHash: input.stateHash,
        encryptedCodeVerifier: input.encryptedCodeVerifier,
        tokenCipher: input.tokenCipher,
        tokenKeyVersion: input.tokenKeyVersion,
        scopes: input.scopes,
        redirectUri: input.redirectUri,
        provider: input.provider,
        expiresAt: input.expiresAt
      }
    });
  }

  async consumeOAuthState(stateHash: string): Promise<StoredOAuthState | null> {
    const state = await this.prisma.oAuthConnectionState.findUnique({ where: { stateHash } });
    if (!state || state.usedAt || state.expiresAt <= new Date()) {
      return null;
    }
    const consumed = await this.prisma.oAuthConnectionState.updateMany({
      where: { id: state.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) {
      return null;
    }
    return {
      id: state.id,
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      platform: state.platform,
      encryptedCodeVerifier: state.encryptedCodeVerifier,
      tokenCipher: state.tokenCipher as "aes-256-gcm",
      tokenKeyVersion: state.tokenKeyVersion,
      scopes: jsonArray(state.scopes),
      redirectUri: state.redirectUri,
      provider: state.provider,
      expiresAt: state.expiresAt,
      usedAt: new Date()
    };
  }

  async connect(input: ConnectPlatformAccountInput): Promise<ConnectPlatformAccountResult> {
    return this.prisma.$transaction(async (tx) => {
      if (input.channelId) {
        const channel = await tx.channel.findFirst({
          where: { id: input.channelId, workspaceId: input.workspaceId }
        });
        if (!channel) {
          return { ok: false, reason: "CHANNEL_NOT_FOUND" };
        }
      }

      const existing = await tx.platformAccount.findUnique({
        where: {
          platform_externalAccountId: {
            platform: input.platform,
            externalAccountId: input.externalAccountId
          }
        },
        include: { credential: true }
      });

      if (existing && existing.workspaceId !== input.workspaceId) {
        return { ok: false, reason: "ACCOUNT_OWNED_BY_OTHER_WORKSPACE" };
      }
      if (existing?.channelId && existing.channelId !== input.channelId) {
        return { ok: false, reason: "ACCOUNT_ASSIGNED_TO_OTHER_CHANNEL" };
      }
      if (input.channelId) {
        const occupied = await tx.platformAccount.findFirst({
          where: {
            channelId: input.channelId,
            platform: input.platform,
            id: existing ? { not: existing.id } : undefined
          }
        });
        if (occupied) {
          return { ok: false, reason: "CHANNEL_PLATFORM_OCCUPIED" };
        }
      }

      const account = existing
        ? await tx.platformAccount.update({
            where: { id: existing.id },
            data: {
              channelId: input.channelId,
              handle: input.handle,
              displayName: input.displayName,
              status: "CONNECTED",
              connectedAt: new Date(),
              disconnectedAt: null
            },
            include: { credential: true }
          })
        : await tx.platformAccount.create({
            data: {
              workspaceId: input.workspaceId,
              channelId: input.channelId,
              platform: input.platform,
              externalAccountId: input.externalAccountId,
              handle: input.handle,
              displayName: input.displayName,
              status: "CONNECTED",
              connectedAt: new Date()
            },
            include: { credential: true }
          });

      await tx.oAuthCredential.upsert({
        where: { platformAccountId: account.id },
        create: {
          platformAccountId: account.id,
          encryptedAccessToken: input.encryptedAccessToken,
          encryptedRefreshToken: input.encryptedRefreshToken,
          tokenCipher: input.tokenCipher,
          tokenKeyVersion: input.tokenKeyVersion,
          scopeHash: input.scopeHash,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
          lastRefreshedAt: new Date()
        },
        update: {
          encryptedAccessToken: input.encryptedAccessToken,
          encryptedRefreshToken: input.encryptedRefreshToken,
          tokenCipher: input.tokenCipher,
          tokenKeyVersion: input.tokenKeyVersion,
          scopeHash: input.scopeHash,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
          lastRefreshedAt: new Date()
        }
      });

      const saved = await tx.platformAccount.findUniqueOrThrow({
        where: { id: account.id },
        include: { credential: true }
      });
      return { ok: true, account: toAccountResponse(saved) };
    });
  }

  async findCredential(
    workspaceId: string,
    platformAccountId: string
  ): Promise<{
    account: PlatformAccountResponse;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenCipher: "aes-256-gcm";
    tokenKeyVersion: number;
  } | null> {
    const account = await this.prisma.platformAccount.findFirst({
      where: { id: platformAccountId, workspaceId },
      include: { credential: true }
    });
    if (!account?.credential) {
      return null;
    }
    return {
      account: toAccountResponse(account),
      encryptedAccessToken: account.credential.encryptedAccessToken,
      encryptedRefreshToken: account.credential.encryptedRefreshToken,
      tokenCipher: account.credential.tokenCipher as "aes-256-gcm",
      tokenKeyVersion: account.credential.tokenKeyVersion
    };
  }

  async disconnect(workspaceId: string, platformAccountId: string): Promise<PlatformAccountResponse | null> {
    const account = await this.prisma.platformAccount.findFirst({
      where: { id: platformAccountId, workspaceId }
    });
    if (!account) {
      return null;
    }
    const updated = await this.prisma.platformAccount.update({
      where: { id: account.id },
      data: {
        channelId: null,
        status: "REVOKED",
        disconnectedAt: new Date()
      },
      include: { credential: true }
    });
    return toAccountResponse(updated);
  }
}
