import { BadRequestException } from "@nestjs/common";
import type {
  PlatformAccountListResponse,
  PlatformAccountResponse
} from "@postbot/contracts";
import {
  FakeYouTubePublisherProvider,
  youtubeReadonlyScope,
  type OAuthTokenSet,
  type PublisherProvider
} from "@postbot/publishers";
import { beforeEach, describe, expect, it } from "vitest";
import { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
import {
  type ConnectPlatformAccountInput,
  type ConnectPlatformAccountResult,
  type OAuthStateInput,
  type PlatformAccountsRepository,
  type StoredOAuthState
} from "./platform-accounts.repository.js";
import { PlatformAccountsService } from "./platform-accounts.service.js";

class MemoryPlatformAccountsRepository implements PlatformAccountsRepository {
  readonly states = new Map<string, OAuthStateInput & { usedAt: Date | null }>();
  readonly accounts = new Map<string, PlatformAccountResponse>();
  lastConnectInput: ConnectPlatformAccountInput | null = null;

  list(): Promise<PlatformAccountListResponse> {
    return Promise.resolve({ accounts: [...this.accounts.values()] });
  }

  createOAuthState(input: OAuthStateInput): Promise<void> {
    this.states.set(input.stateHash, { ...input, usedAt: null });
    return Promise.resolve();
  }

  consumeOAuthState(stateHash: string): Promise<StoredOAuthState | null> {
    const state = this.states.get(stateHash);
    if (!state || state.usedAt || state.expiresAt <= new Date()) {
      return Promise.resolve(null);
    }
    state.usedAt = new Date();
    return Promise.resolve({
      id: "state-1",
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      platform: state.platform,
      encryptedCodeVerifier: state.encryptedCodeVerifier,
      tokenCipher: state.tokenCipher,
      tokenKeyVersion: state.tokenKeyVersion,
      scopes: state.scopes,
      redirectUri: state.redirectUri,
      provider: state.provider,
      expiresAt: state.expiresAt,
      usedAt: state.usedAt
    });
  }

  connect(input: ConnectPlatformAccountInput): Promise<ConnectPlatformAccountResult> {
    this.lastConnectInput = input;
    const account: PlatformAccountResponse = {
      id: "account-1",
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      platform: input.platform,
      externalAccountId: input.externalAccountId,
      handle: input.handle,
      displayName: input.displayName,
      status: "CONNECTED",
      scopes: input.scopes,
      expiresAt: input.expiresAt?.toISOString() ?? null,
      connectedAt: new Date().toISOString(),
      disconnectedAt: null
    };
    this.accounts.set(account.id, account);
    return Promise.resolve({ ok: true, account });
  }

  findCredential(): Promise<{
    account: PlatformAccountResponse;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenCipher: "aes-256-gcm";
    tokenKeyVersion: number;
  } | null> {
    const account = this.accounts.get("account-1");
    const input = this.lastConnectInput;
    if (!account || !input) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      account,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      tokenCipher: input.tokenCipher,
      tokenKeyVersion: input.tokenKeyVersion
    });
  }

  disconnect(workspaceId: string, platformAccountId: string): Promise<PlatformAccountResponse | null> {
    const account = this.accounts.get(platformAccountId);
    if (!account || account.workspaceId !== workspaceId) {
      return Promise.resolve(null);
    }
    const disconnected: PlatformAccountResponse = {
      ...account,
      channelId: null,
      status: "REVOKED",
      disconnectedAt: new Date().toISOString()
    };
    this.accounts.set(platformAccountId, disconnected);
    return Promise.resolve(disconnected);
  }
}

class TestProviderFactory {
  constructor(private readonly provider: PublisherProvider) {}

  youtube(): PublisherProvider {
    return this.provider;
  }
}

class InsufficientScopeProvider extends FakeYouTubePublisherProvider {
  override async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokenSet> {
    const tokenSet = await super.exchangeCode(input);
    return { ...tokenSet, scopes: [] };
  }
}

const createService = (provider: PublisherProvider = new FakeYouTubePublisherProvider()) => {
  const repository = new MemoryPlatformAccountsRepository();
  const service = new PlatformAccountsService(
    repository,
    new OAuthCryptoService(),
    new TestProviderFactory(provider)
  );
  return { repository, service };
};

const callbackFromAuthorizationUrl = (authorizationUrl: string): { state: string; code: string } => {
  const url = new URL(authorizationUrl);
  return {
    state: url.searchParams.get("state") ?? "",
    code: url.searchParams.get("code") ?? ""
  };
};

describe("PlatformAccountsService", () => {
  beforeEach(() => {
    process.env.OAUTH_ENCRYPTION_KEY = "test-oauth-encryption-key-material";
    process.env.OAUTH_ENCRYPTION_KEY_VERSION = "7";
    process.env.API_BASE_URL = "http://localhost:3000";
  });

  it("connects YouTube with state, PKCE, encrypted tokens, and required scope", async () => {
    const { repository, service } = createService();
    const started = await service.startYouTube("workspace-1", { channelId: "channel-1" });
    const callback = callbackFromAuthorizationUrl(started.authorizationUrl);

    const completed = await service.completeYouTube(callback);

    expect(completed.account.platform).toBe("YOUTUBE");
    expect(completed.account.scopes).toContain(youtubeReadonlyScope);
    expect(repository.lastConnectInput?.encryptedAccessToken).not.toContain("fake-access-token");
    expect(repository.lastConnectInput?.encryptedRefreshToken).not.toContain("fake-refresh-token");
    expect(repository.lastConnectInput?.tokenKeyVersion).toBe(7);
  });

  it("rejects forged state", async () => {
    const { service } = createService();
    await expect(service.completeYouTube({ state: "forged-state-that-is-long-enough-123", code: "code" })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("rejects callback reuse", async () => {
    const { service } = createService();
    const started = await service.startYouTube("workspace-1", {});
    const callback = callbackFromAuthorizationUrl(started.authorizationUrl);

    await service.completeYouTube(callback);
    await expect(service.completeYouTube(callback)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects insufficient YouTube scope", async () => {
    const { service } = createService(new InsufficientScopeProvider());
    const started = await service.startYouTube("workspace-1", {});
    const callback = callbackFromAuthorizationUrl(started.authorizationUrl);

    await expect(service.completeYouTube(callback)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("disconnects a connected account without exposing token values", async () => {
    const { repository, service } = createService();
    const started = await service.startYouTube("workspace-1", {});
    await service.completeYouTube(callbackFromAuthorizationUrl(started.authorizationUrl));

    await expect(service.disconnect("workspace-1", "account-1")).resolves.toEqual({ ok: true });
    expect(repository.accounts.get("account-1")?.status).toBe("REVOKED");
  });
});
