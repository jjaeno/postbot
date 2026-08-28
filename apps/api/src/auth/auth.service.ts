import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { Response } from "express";
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthResponse,
  type AuthSession,
  type LoginRequest,
  type RegisterRequest
} from "@postbot/contracts";
import { AUTH_REPOSITORY, type AuthRepository } from "./auth.repository.js";
import type { CookieRequest } from "./request-types.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import type { z } from "zod";
import { authCookieNames } from "./auth-cookies.js";

const secureCookies = (): boolean => process.env.NODE_ENV === "production";

const cookieOptions = (maxAge: number, httpOnly: boolean) => ({
  httpOnly,
  secure: secureCookies(),
  sameSite: "lax" as const,
  path: "/",
  maxAge
});

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const slugFromEmail = (email: string): string => email.split("@")[0]?.replace(/[^a-z0-9]+/gi, "-").toLowerCase() ?? "workspace";
const parseBody = <Schema extends z.ZodType>(schema: Schema, rawInput: unknown): z.infer<Schema> => {
  const result = schema.safeParse(rawInput);
  if (!result.success) {
    throw new BadRequestException("입력값을 확인해 주세요.");
  }
  return result.data;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService
  ) {}

  async register(rawInput: unknown, req: CookieRequest, res: Response): Promise<AuthResponse> {
    const input: RegisterRequest = parseBody(RegisterRequestSchema, rawInput);
    const email = normalizeEmail(input.email);
    const existing = await this.repository.findUserByEmail(email);
    if (existing) {
      throw new ConflictException("이미 가입된 이메일입니다.");
    }

    const session = await this.repository.createUserWithWorkspace({
      email,
      displayName: input.displayName.trim(),
      timezone: input.timezone,
      passwordHash: await this.passwords.hash(input.password),
      workspaceName: `${input.displayName.trim()} workspace`,
      workspaceSlug: slugFromEmail(email)
    });
    return this.issueTokens(session, req, res);
  }

  async login(rawInput: unknown, req: CookieRequest, res: Response): Promise<AuthResponse> {
    const input: LoginRequest = parseBody(LoginRequestSchema, rawInput);
    const credentials: LoginRequest = { ...input, email: normalizeEmail(input.email) };
    const user = await this.repository.findUserByEmail(credentials.email);
    if (!user || !(await this.passwords.verify(credentials.password, user.passwordHash))) {
      throw new UnauthorizedException("이메일 또는 비밀번호가 올바르지 않습니다.");
    }
    const session = await this.repository.findSessionByUserId(user.id);
    if (!session) {
      throw new UnauthorizedException("사용자 워크스페이스를 찾을 수 없습니다.");
    }
    return this.issueTokens(session, req, res);
  }

  async me(userId: string): Promise<AuthSession> {
    const session = await this.repository.findSessionByUserId(userId);
    if (!session) {
      throw new UnauthorizedException("인증이 만료되었습니다. 다시 로그인해 주세요.");
    }
    return session;
  }

  async refresh(req: CookieRequest, res: Response): Promise<AuthResponse> {
    const refreshToken = req.cookies?.[authCookieNames.refresh];
    if (!refreshToken) {
      throw new UnauthorizedException("세션을 갱신할 수 없습니다. 다시 로그인해 주세요.");
    }
    const payload = this.tokens.verifyRefreshToken(refreshToken);
    const stored = await this.repository.findRefreshSession(payload.sessionId);
    const now = new Date();

    if (
      !stored ||
      stored.tokenHash !== this.tokens.hashToken(refreshToken) ||
      stored.expiresAt <= now
    ) {
      throw new UnauthorizedException("세션을 갱신할 수 없습니다. 다시 로그인해 주세요.");
    }

    if (stored.revokedAt || stored.reuseDetectedAt) {
      await this.repository.revokeRefreshFamily(stored.familyId, now);
      this.clearCookies(res);
      throw new UnauthorizedException("세션 보안 문제를 감지했습니다. 다시 로그인해 주세요.");
    }

    const session = await this.repository.findSessionByUserId(payload.sub);
    if (!session) {
      throw new UnauthorizedException("사용자 정보를 찾을 수 없습니다.");
    }

    const nextSessionId = this.tokens.randomToken(18);
    const nextRefreshToken = this.tokens.createRefreshToken(
      payload.sub,
      payload.workspaceId,
      nextSessionId,
      stored.familyId
    );
    const nextStored = await this.repository.createRefreshSession({
      id: nextSessionId,
      userId: payload.sub,
      workspaceId: payload.workspaceId,
      tokenHash: this.tokens.hashToken(nextRefreshToken),
      familyId: stored.familyId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      userAgentHash: this.tokens.hashContext(req.get("user-agent")),
      ipHash: this.tokens.hashContext(req.ip)
    });
    await this.repository.revokeRefreshSession(stored.id, nextStored.id);
    return this.setCookies(session, nextRefreshToken, res);
  }

  async logout(req: CookieRequest, res: Response): Promise<{ ok: true }> {
    const refreshToken = req.cookies?.[authCookieNames.refresh];
    if (refreshToken) {
      const payload = this.tokens.verifyRefreshToken(refreshToken);
      await this.repository.revokeRefreshSession(payload.sessionId, null);
    }
    this.clearCookies(res);
    return { ok: true };
  }

  private async issueTokens(
    session: AuthSession,
    req: CookieRequest,
    res: Response
  ): Promise<AuthResponse> {
    const sessionId = this.tokens.randomToken(18);
    const familyId = this.tokens.randomToken(18);
    const refreshToken = this.tokens.createRefreshToken(
      session.user.id,
      session.workspace.id,
      sessionId,
      familyId
    );
    await this.repository.createRefreshSession({
      id: sessionId,
      userId: session.user.id,
      workspaceId: session.workspace.id,
      tokenHash: this.tokens.hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      userAgentHash: this.tokens.hashContext(req.get("user-agent")),
      ipHash: this.tokens.hashContext(req.ip)
    });
    return this.setCookies(session, refreshToken, res);
  }

  private setCookies(
    session: AuthSession,
    refreshToken: string,
    res: Response
  ): AuthResponse {
    const accessToken = this.tokens.createAccessToken(session.user.id, session.workspace.id);
    const csrfToken = this.tokens.randomToken(32);

    res.cookie(authCookieNames.access, accessToken, cookieOptions(1000 * 60 * 15, true));
    res.cookie(authCookieNames.refresh, refreshToken, cookieOptions(1000 * 60 * 60 * 24 * 7, true));
    res.cookie(authCookieNames.csrf, csrfToken, cookieOptions(1000 * 60 * 60 * 24 * 7, false));
    return { session, csrfToken };
  }

  private clearCookies(res: Response): void {
    res.clearCookie(authCookieNames.access, { path: "/" });
    res.clearCookie(authCookieNames.refresh, { path: "/" });
    res.clearCookie(authCookieNames.csrf, { path: "/" });
  }
}
