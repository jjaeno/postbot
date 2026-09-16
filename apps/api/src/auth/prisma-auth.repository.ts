import { Inject, Injectable } from "@nestjs/common";
import type { AuthSession } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import type {
  AuthRepository,
  CreateRefreshSessionInput,
  CreateUserInput,
  StoredRefreshSession,
  StoredUser
} from "./auth.repository.js";

const toSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async createUserWithWorkspace(input: CreateUserInput): Promise<AuthSession> {
    return this.prisma.$transaction(async (tx) => {
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
          slug: input.workspaceSlug || `${toSlug(input.displayName)}-${user.id.slice(0, 8)}`
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

  async revokeRefreshSession(sessionId: string, replacedById: string | null): Promise<void> {
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), replacedById }
    });
  }

  async revokeRefreshFamily(familyId: string, reuseDetectedAt: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { familyId },
      data: { revokedAt: reuseDetectedAt, reuseDetectedAt }
    });
  }

  async hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    return membership !== null;
  }
}
