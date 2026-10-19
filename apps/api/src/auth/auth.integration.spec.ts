import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@postbot/database";
import { AuthResponseSchema } from "@postbot/contracts";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller.js";
import { AUTH_REPOSITORY } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard } from "./csrf.guard.js";
import { PasswordService } from "./password.service.js";
import { PrismaAuthRepository } from "./prisma-auth.repository.js";
import { TokenService } from "./token.service.js";
import { HttpExceptionResponseFilter } from "../http-exception.filter.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" &&
  new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");

describe.skipIf(!enabled).sequential("Auth HTTP with real Prisma/MySQL", () => {
  const prisma = new PrismaClient();
  const repository = new PrismaAuthRepository(prisma);
  let app: INestApplication;
  let tokens: TokenService;
  const server = (): Server => app.getHttpServer() as Server;
  const register = (email = `${randomUUID()}@auth.test`) => request(server()).post("/auth/register")
    .send({ email, password: "isolated-fixture-password", displayName: "Fixture" });
  const cookiesOf = (response: request.Response): string[] => {
    const value: unknown = response.headers["set-cookie"];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  };
  const csrfOf = (cookies: string[]) => cookies.find((cookie) => cookie.startsWith("postbot_csrf="))?.split(";")[0]?.slice("postbot_csrf=".length) ?? "";
  const refresh = (cookies: string[]) => request(server()).post("/auth/refresh").set("Cookie", cookies).set("x-csrf-token", csrfOf(cookies));
  const logout = (cookies: string[]) => request(server()).post("/auth/logout").set("Cookie", cookies).set("x-csrf-token", csrfOf(cookies));
  const storedOf = async (cookies: string[]) => {
    const token = cookies.find((cookie) => cookie.startsWith("postbot_refresh="))?.split(";")[0]?.slice("postbot_refresh=".length) ?? "";
    return prisma.authSession.findUniqueOrThrow({ where: { id: tokens.verifyRefreshToken(token).sessionId } });
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService, PasswordService, TokenService, CsrfGuard, { provide: AUTH_REPOSITORY, useValue: repository }]
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionResponseFilter());
    app.useGlobalGuards(app.get(CsrfGuard));
    tokens = app.get(TokenService);
    await app.init();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app?.close(); await prisma.$disconnect(); });

  it("allows at most one successor under simultaneous refresh HTTP requests", async () => {
    const cookies = cookiesOf(await register().expect(201));
    const parent = await storedOf(cookies);
    // Both requests reach the rotation with the same original credentials.
    const original = repository.findSessionByUserId.bind(repository);
    let arrivals = 0;
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(repository, "findSessionByUserId").mockImplementation(async (id) => {
      const session = await original(id);
      if (++arrivals === 2) release();
      await barrier;
      return session;
    });
    const results = await Promise.all([refresh(cookies), refresh(cookies)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 401]);
    expect(await prisma.authSession.count({ where: { familyId: parent.familyId } })).toBe(2);
    expect(await prisma.authSession.count({ where: { familyId: parent.familyId, revokedAt: null } })).toBe(0);
  });

  it("rolls back consumption when successor INSERT fails and can retry", async () => {
    const cookies = cookiesOf(await register().expect(201));
    const parent = await storedOf(cookies);
    const original = tokens.randomToken.bind(tokens);
    vi.spyOn(tokens, "randomToken").mockImplementation((bytes) => bytes === 18 ? parent.id : original(bytes));
    // Duplicate PK injects a real DB error in the middle of rotation.
    await refresh(cookies).expect(500);
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: parent.id } })).revokedAt).toBeNull();
    expect(await prisma.authSession.count({ where: { familyId: parent.familyId } })).toBe(1);
    vi.restoreAllMocks();
    await refresh(cookies).expect(201);
  });

  it("logout revokes descendants even when the cookie was already rotated", async () => {
    const cookies = cookiesOf(await register().expect(201));
    const parent = await storedOf(cookies);
    const next = cookiesOf(await refresh(cookies).expect(201));
    await logout(cookies).expect(201);
    expect(await prisma.authSession.count({ where: { familyId: parent.familyId, revokedAt: null } })).toBe(0);
    await refresh(next).expect(401);
  });

  it("serializes logout racing refresh without leaving an active descendant", async () => {
    const cookies = cookiesOf(await register().expect(201));
    const parent = await storedOf(cookies);
    const [rotation, exit] = await Promise.all([refresh(cookies), logout(cookies)]);
    expect([201, 401].includes(rotation.status)).toBe(true);
    expect(exit.status).toBe(201);
    expect(await prisma.authSession.count({ where: { familyId: parent.familyId, revokedAt: null } })).toBe(0);
  });

  it("detects old token reuse and invalidates the successful successor only in its family", async () => {
    const email = `${randomUUID()}@auth.test`;
    const cookies = cookiesOf(await register(email).expect(201));
    const other = cookiesOf(await request(server()).post("/auth/login").send({ email, password: "isolated-fixture-password" }).expect(201));
    const next = cookiesOf(await refresh(cookies).expect(201));
    await refresh(cookies).expect(401);
    await refresh(next).expect(401);
    await refresh(other).expect(201);
  });

  it("keeps legacy slugs while registering identical local parts across domains concurrently", async () => {
    const local = `owner-${randomUUID().slice(0, 8)}`;
    const first = await register(`${local}@gmail.test`).expect(201);
    const firstWorkspace = AuthResponseSchema.parse(first.body).session.workspace;
    await prisma.workspace.update({ where: { id: firstWorkspace.id }, data: { slug: local } });
    const results = await Promise.all([register(`${local}@naver.test`), register(`${local}@outlook.test`)]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const slugs = results.map((result) => AuthResponseSchema.parse(result.body).session.workspace.slug);
    expect(new Set([local, ...slugs]).size).toBe(3);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: firstWorkspace.id } })).slug).toBe(local);
  });

  it("maps simultaneous duplicate email registration to a safe 409 without partial workspace", async () => {
    const email = `${randomUUID()}@auth.test`;
    const results = await Promise.all([register(email), register(email)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const failure = results.find((result) => result.status === 409);
    expect(failure?.body).toEqual({ code: "CONFLICT", message: "이미 가입된 이메일입니다." });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await prisma.workspace.count({ where: { ownerId: user.id } })).toBe(1);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
  });
});
