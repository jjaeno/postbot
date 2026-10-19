import { ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import type {
  AuthRepository,
  CreateRefreshSessionInput,
  CreateUserInput,
  RotateRefreshInput,
  StoredRefreshSession,
  StoredUser
} from "./auth.repository.js";

const toSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 43);

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async createUserWithWorkspace(input: CreateUserInput): Promise<AuthSession> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: input.email,
              displayName: input.displayName,
              timezone: input.timezone,
              passwordHash: input.passwordHash
            }
          });
          const workspace = await tx.workspace.create({
            data: {
              ownerId: user.id,
              name: input.workspaceName,
              slug: `${toSlug(input.workspaceSlug || input.displayName) || "workspace"}-${randomUUID()}`
            }
          });
          const membership = await tx.membership.create({
            data: {
              userId: user.id,
              workspaceId: workspace.id,
              role: "OWNER"
            }
          });

          return {
            user: {
              id: user.id,
              email: user.email,
              displayName: user.displayName,
              timezone: user.timezone
            },
            workspace: {
              id: workspace.id,
              name: workspace.name,
              slug: workspace.slug,
              role: membership.role
            }
          };
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        // Check after rollback: concurrent identical emails must produce a domain error.
        if (await this.findUserByEmail(input.email)) throw new ConflictException("이미 가입된 이메일입니다.");
        // A slug collision with any legacy address is retried using a fresh suffix.
      }
    }
    throw new ServiceUnavailableException("회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user
      ? {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          timezone: user.timezone,
          passwordHash: user.passwordHash
        }
      : null;
  }

  async findSessionByUserId(userId: string): Promise<AuthSession | null> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      include: { user: true, workspace: true },
      orderBy: { createdAt: "asc" }
    });

    return membership
      ? {
          user: {
            id: membership.user.id,
            email: membership.user.email,
            displayName: membership.user.displayName,
            timezone: membership.user.timezone
          },
          workspace: {
            id: membership.workspace.id,
            name: membership.workspace.name,
            slug: membership.workspace.slug,
            role: membership.role
          }
        }
      : null;
  }

  async findRefreshSession(id: string): Promise<StoredRefreshSession | null> {
    return this.prisma.authSession.findUnique({ where: { id } });
  }

  async createRefreshSession(input: CreateRefreshSessionInput): Promise<StoredRefreshSession> {
    return this.prisma.authSession.create({ data: input });
  }

  async rotateRefreshSession({ sessionId, tokenHash, next }: RotateRefreshInput): Promise<"rotated" | "invalid" | "reused"> {
    return this.prisma.$transaction(async (tx) => {
      // A stable user row serializes rotation, logout and reuse detection, including
      // descendants inserted during a race. Lock before reading under MySQL REPEATABLE READ.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${next.userId} FOR UPDATE`;
      const stored = await tx.authSession.findUnique({ where: { id: sessionId } });
      const now = new Date();
      if (!stored || stored.userId !== next.userId || stored.workspaceId !== next.workspaceId ||
        stored.familyId !== next.familyId || stored.tokenHash !== tokenHash || stored.expiresAt <= now) return "invalid";
      if (stored.revokedAt || stored.reuseDetectedAt) {
        await tx.authSession.updateMany({ where: { familyId: stored.familyId }, data: { revokedAt: now, reuseDetectedAt: now } });
        return "reused";
      }
      await tx.authSession.update({ where: { id: sessionId }, data: { revokedAt: now } });
      await tx.authSession.create({ data: next });
      await tx.authSession.update({ where: { id: sessionId }, data: { revokedAt: now, replacedById: next.id } });
      return "rotated";
    });
  }

  async revokeRefreshSession(sessionId: string, replacedById: string | null): Promise<void> {
    if (replacedById !== null) throw new Error("Use atomic refresh rotation");
    const stored = await this.findRefreshSession(sessionId);
    if (!stored) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${stored.userId} FOR UPDATE`;
      await tx.authSession.updateMany({ where: { familyId: stored.familyId }, data: { revokedAt: new Date() } });
    });
  }

  async revokeRefreshFamily(familyId: string, reuseDetectedAt: Date): Promise<void> {
    const stored = await this.prisma.authSession.findFirst({ where: { familyId } });
    if (!stored) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${stored.userId} FOR UPDATE`;
      await tx.authSession.updateMany({ where: { familyId }, data: { revokedAt: reuseDetectedAt, reuseDetectedAt } });
    });
  }

  async hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    return membership !== null;
  }
}
