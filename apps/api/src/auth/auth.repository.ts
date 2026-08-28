import type { AuthSession } from "@postbot/contracts";

export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");

export type StoredUser = AuthSession["user"] & {
  passwordHash: string;
};

export type StoredWorkspace = AuthSession["workspace"];

export type StoredRefreshSession = {
  id: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  reuseDetectedAt: Date | null;
};

export type CreateUserInput = {
  email: string;
  displayName: string;
  timezone: string;
  passwordHash: string;
  workspaceName: string;
  workspaceSlug: string;
};

export type CreateRefreshSessionInput = {
  id: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgentHash: string | null;
  ipHash: string | null;
};

export type AuthRepository = {
  createUserWithWorkspace(input: CreateUserInput): Promise<AuthSession>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findSessionByUserId(userId: string): Promise<AuthSession | null>;
  findRefreshSession(id: string): Promise<StoredRefreshSession | null>;
  createRefreshSession(input: CreateRefreshSessionInput): Promise<StoredRefreshSession>;
  revokeRefreshSession(sessionId: string, replacedById: string | null): Promise<void>;
  revokeRefreshFamily(familyId: string, reuseDetectedAt: Date): Promise<void>;
  hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean>;
};
