import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AuthSessionSchema, ErrorResponseSchema, type AuthSession } from "@postbot/contracts";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import request from "supertest";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AccessTokenGuard } from "./access-token.guard.js";
import { AuthController } from "./auth.controller.js";
import { AUTH_REPOSITORY, type AuthRepository, type CreateRefreshSessionInput, type CreateUserInput, type RotateRefreshInput, type StoredRefreshSession, type StoredUser } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard } from "./csrf.guard.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { WorkspaceGuard } from "./workspace.guard.js";
import { HttpExceptionResponseFilter } from "../http-exception.filter.js";

const setCookieHeader = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
};

class FakeAuthRepository implements AuthRepository {
  private users = new Map<string, StoredUser>();
  private sessions = new Map<string, AuthSession>();
  private refreshSessions = new Map<string, StoredRefreshSession>();
  private memberships = new Set<string>();

  createUserWithWorkspace(input: CreateUserInput): Promise<AuthSession> {
    if (this.users.has(input.email)) {
      throw new Error("duplicate");
    }
    const userId = `user-${this.users.size + 1}`;
    const workspaceId = `workspace-${this.users.size + 1}`;
    const user: StoredUser = {
      id: userId,
      email: input.email,
      displayName: input.displayName,
      timezone: input.timezone,
      passwordHash: input.passwordHash
    };
    const session: AuthSession = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        timezone: user.timezone
      },
      workspace: {
        id: workspaceId,
        name: input.workspaceName,
        slug: input.workspaceSlug,
        role: "OWNER"
      }
    };
    this.users.set(user.email, user);
    this.sessions.set(user.id, session);
    this.memberships.add(`${user.id}:${workspaceId}`);
    return Promise.resolve(session);
  }

  findUserByEmail(email: string): Promise<StoredUser | null> {
    return Promise.resolve(this.users.get(email) ?? null);
  }

  findSessionByUserId(userId: string): Promise<AuthSession | null> {
    return Promise.resolve(this.sessions.get(userId) ?? null);
  }

  findRefreshSession(id: string): Promise<StoredRefreshSession | null> {
    return Promise.resolve(this.refreshSessions.get(id) ?? null);
  }

  createRefreshSession(input: CreateRefreshSessionInput): Promise<StoredRefreshSession> {
    const stored: StoredRefreshSession = {
      id: input.id,
      userId: input.userId,
      workspaceId: input.workspaceId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      reuseDetectedAt: null
    };
    this.refreshSessions.set(stored.id, stored);
    return Promise.resolve(stored);
  }

  revokeRefreshSession(sessionId: string, replacedById: string | null): Promise<void> {
    const stored = this.refreshSessions.get(sessionId);
    if (stored) {
      for (const [id, session] of this.refreshSessions) {
        if (session.familyId === stored.familyId) {
          this.refreshSessions.set(id, { ...session, revokedAt: new Date() });
        }
      }
    }
    void replacedById;
    return Promise.resolve();
  }

  async rotateRefreshSession({ sessionId, tokenHash, next }: RotateRefreshInput): Promise<"rotated" | "invalid" | "reused"> {
    const stored = this.refreshSessions.get(sessionId);
    if (!stored || stored.tokenHash !== tokenHash || stored.expiresAt <= new Date() ||
      stored.userId !== next.userId || stored.workspaceId !== next.workspaceId || stored.familyId !== next.familyId) return "invalid";
    if (stored.revokedAt || stored.reuseDetectedAt) {
      await this.revokeRefreshFamily(stored.familyId, new Date());
      return "reused";
    }
    this.refreshSessions.set(stored.id, { ...stored, revokedAt: new Date() });
    await this.createRefreshSession(next);
    return "rotated";
  }

  revokeRefreshFamily(familyId: string, reuseDetectedAt: Date): Promise<void> {
    for (const [id, session] of this.refreshSessions.entries()) {
      if (session.familyId === familyId) {
        this.refreshSessions.set(id, {
          ...session,
          revokedAt: reuseDetectedAt,
          reuseDetectedAt
        });
      }
    }
    return Promise.resolve();
  }

  hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    return Promise.resolve(this.memberships.has(`${userId}:${workspaceId}`));
  }
}

const csrfFrom = (cookies: string[]): string => {
  const cookie = cookies.find((value) => value.startsWith("postbot_csrf="));
  expect(cookie).toBeDefined();
  return decodeURIComponent(cookie?.split(";")[0]?.split("=")[1] ?? "");
};

describe("Auth API", () => {
  let app: INestApplication;
  let repository: FakeAuthRepository;
  const httpServer = (): Server => app.getHttpServer() as Server;

  beforeEach(async () => {
    repository = new FakeAuthRepository();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        PasswordService,
        TokenService,
        AccessTokenGuard,
        CsrfGuard,
        WorkspaceGuard,
        { provide: AUTH_REPOSITORY, useValue: repository }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionResponseFilter());
    app.useGlobalGuards(app.get(CsrfGuard));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("registers, restores session, and logs out without exposing sensitive cookie values", async () => {
    const agent = request.agent(httpServer());
    const register = await agent
      .post("/auth/register")
      .send({
        email: "owner@example.com",
        password: "very-safe-password",
        displayName: "Owner"
      })
      .expect(201);

    const cookies = setCookieHeader(register.headers["set-cookie"]);
    expect(cookies.join("\n")).toContain("HttpOnly");
    expect(cookies.join("\n")).toContain("SameSite=Lax");
    expect(JSON.stringify(register.body)).not.toContain("very-safe-password");

    await agent.get("/auth/me").expect(200).expect("Cache-Control", "no-store").expect(({ body }) => {
        expect(AuthSessionSchema.parse(body).user.email).toBe("owner@example.com");
        expect(AuthSessionSchema.parse(body).csrfToken).toBe(csrfFrom(cookies));
    });

    await agent
      .post("/auth/logout")
      .set("x-csrf-token", csrfFrom(cookies))
      .expect(201);
    await agent.get("/auth/me").expect(401);
  });

  it("rejects wrong passwords", async () => {
    const agent = request.agent(httpServer());
    await agent.post("/auth/register").send({
      email: "owner@example.com",
      password: "very-safe-password",
      displayName: "Owner"
    });

    await request(httpServer())
      .post("/auth/login")
      .send({ email: "owner@example.com", password: "wrong-password" })
      .expect(401)
      .expect(({ body }) => {
        expect(ErrorResponseSchema.parse(body).message).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
      });
  });

  it("rotates refresh tokens and detects reuse", async () => {
    const agent = request.agent(httpServer());
    const register = await agent.post("/auth/register").send({
      email: "owner@example.com",
      password: "very-safe-password",
      displayName: "Owner"
    });
    const originalCookies = setCookieHeader(register.headers["set-cookie"]);
    const csrf = csrfFrom(originalCookies);

    await agent.post("/auth/refresh").set("x-csrf-token", csrf).expect(201);

    await request(httpServer())
      .post("/auth/refresh")
      .set("Cookie", originalCookies)
      .set("x-csrf-token", csrf)
      .expect(401)
      .expect(({ body }) => {
        expect(ErrorResponseSchema.parse(body).message).toBe("세션 보안 문제를 감지했습니다. 다시 로그인해 주세요.");
      });
  });

  it("blocks access to another workspace", async () => {
    const agent = request.agent(httpServer());
    await agent.post("/auth/register").send({
      email: "owner@example.com",
      password: "very-safe-password",
      displayName: "Owner"
    });

    await agent.get("/auth/workspaces/workspace-999/access-check").expect(403);
  });
});
