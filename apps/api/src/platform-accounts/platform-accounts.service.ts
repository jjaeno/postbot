import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import {
  OAuthCallbackQuerySchema,
  StartOAuthConnectionRequestSchema,
  type DisconnectPlatformAccountResponse,
  type OAuthCallbackResult,
  type PlatformAccountListResponse,
  type StartOAuthConnectionRequest,
  type StartOAuthConnectionResponse
} from "@postbot/contracts";
import { OAuthScopeError, assertRequiredScopes, type PublisherProvider } from "@postbot/publishers";
import type { z } from "zod";
import { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
import {
  PLATFORM_ACCOUNTS_REPOSITORY,
  type PlatformAccountsRepository
} from "./platform-accounts.repository.js";
import { PublisherProviderFactory } from "./publisher-provider.factory.js";

type YouTubeProviderFactory = {
  youtube(): PublisherProvider;
};

const parseBody = <Schema extends z.ZodType>(schema: Schema, rawInput: unknown): z.infer<Schema> => {
  const result = schema.safeParse(rawInput);
  if (!result.success) {
    throw new BadRequestException(result.error.issues[0]?.message ?? "요청 값을 확인해 주세요.");
  }
  return result.data;
};

@Injectable()
export class PlatformAccountsService {
  private readonly config = loadConfig();

  constructor(
    @Inject(PLATFORM_ACCOUNTS_REPOSITORY) private readonly repository: PlatformAccountsRepository,
    @Inject(OAuthCryptoService) private readonly crypto: OAuthCryptoService,
    @Inject(PublisherProviderFactory) private readonly providers: YouTubeProviderFactory
  ) {}

  list(workspaceId: string): Promise<PlatformAccountListResponse> {
    return this.repository.list(workspaceId);
  }

  async startYouTube(workspaceId: string, rawInput: unknown): Promise<StartOAuthConnectionResponse> {
    const input: StartOAuthConnectionRequest = parseBody(StartOAuthConnectionRequestSchema, rawInput);
    const provider = this.providers.youtube();
    const state = this.crypto.randomToken(32);
    const codeVerifier = this.crypto.randomToken(64);
    const codeChallenge = this.crypto.pkceChallenge(codeVerifier);
    const encryptedVerifier = this.crypto.encrypt(codeVerifier);
    const redirectUri = `${this.config.API_BASE_URL}/platform-accounts/youtube/callback`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.repository.createOAuthState({
      workspaceId,
      channelId: input.channelId ?? null,
      platform: "YOUTUBE",
      stateHash: this.crypto.sha256(state),
      encryptedCodeVerifier: encryptedVerifier.cipherText,
      tokenCipher: encryptedVerifier.cipher,
      tokenKeyVersion: encryptedVerifier.keyVersion,
      scopes: provider.capabilities.requiredScopes,
      redirectUri,
      provider: provider.capabilities.provider,
      expiresAt
    });

    return {
      authorizationUrl: provider.createAuthorizationUrl({
        state,
        codeChallenge,
        redirectUri,
        scopes: provider.capabilities.requiredScopes
      }),
      stateExpiresAt: expiresAt.toISOString(),
      provider: provider.capabilities.provider,
      requiredScopes: provider.capabilities.requiredScopes
    };
  }

  async completeYouTube(rawQuery: unknown): Promise<OAuthCallbackResult> {
    const query = parseBody(OAuthCallbackQuerySchema, rawQuery);
    const state = await this.repository.consumeOAuthState(this.crypto.sha256(query.state));
    if (!state || state.platform !== "YOUTUBE") {
      throw new BadRequestException("OAuth state가 유효하지 않거나 이미 사용되었습니다.");
    }

    const provider = this.providers.youtube();
    if (provider.capabilities.provider !== state.provider) {
      throw new BadRequestException("OAuth provider 설정이 state 생성 시점과 다릅니다.");
    }

    const codeVerifier = this.crypto.decrypt({
      cipherText: state.encryptedCodeVerifier,
      cipher: state.tokenCipher,
      keyVersion: state.tokenKeyVersion
    });

    const tokenSet = await provider.exchangeCode({
      code: query.code,
      codeVerifier,
      redirectUri: state.redirectUri
    });

    try {
      assertRequiredScopes(tokenSet.scopes, state.scopes);
    } catch (error) {
      if (error instanceof OAuthScopeError) {
        throw new BadRequestException("YouTube 연결에 필요한 권한이 승인되지 않았습니다.");
      }
      throw error;
    }

    const profile = await provider.getAccountProfile(tokenSet.accessToken);
    const encryptedAccessToken = this.crypto.encrypt(tokenSet.accessToken);
    const encryptedRefreshToken = tokenSet.refreshToken ? this.crypto.encrypt(tokenSet.refreshToken) : null;
    const connected = await this.repository.connect({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      platform: "YOUTUBE",
      externalAccountId: profile.externalAccountId,
      handle: profile.handle,
      displayName: profile.displayName,
      encryptedAccessToken: encryptedAccessToken.cipherText,
      encryptedRefreshToken: encryptedRefreshToken?.cipherText ?? null,
      tokenCipher: encryptedAccessToken.cipher,
      tokenKeyVersion: encryptedAccessToken.keyVersion,
      scopes: tokenSet.scopes,
      scopeHash: this.crypto.sha256([...tokenSet.scopes].sort().join(" ")),
      expiresAt: tokenSet.expiresAt
    });

    if (connected.ok) {
      return { account: connected.account };
    }
    if (connected.reason === "CHANNEL_NOT_FOUND") {
      throw new NotFoundException("채널을 찾을 수 없습니다.");
    }
    throw new ConflictException("이미 다른 채널에 연결된 YouTube 계정입니다.");
  }

  async disconnect(workspaceId: string, platformAccountId: string): Promise<DisconnectPlatformAccountResponse> {
    const credential = await this.repository.findCredential(workspaceId, platformAccountId);
    if (!credential) {
      throw new NotFoundException("플랫폼 계정을 찾을 수 없습니다.");
    }

    const provider = this.providers.youtube();
    const accessToken = this.crypto.decrypt({
      cipherText: credential.encryptedAccessToken,
      cipher: credential.tokenCipher,
      keyVersion: credential.tokenKeyVersion
    });
    const refreshToken = credential.encryptedRefreshToken
      ? this.crypto.decrypt({
          cipherText: credential.encryptedRefreshToken,
          cipher: credential.tokenCipher,
          keyVersion: credential.tokenKeyVersion
        })
      : null;
    await provider.revoke?.(refreshToken, accessToken);
    const disconnected = await this.repository.disconnect(workspaceId, platformAccountId);
    if (!disconnected) {
      throw new NotFoundException("플랫폼 계정을 찾을 수 없습니다.");
    }
    return { ok: true };
  }
}
