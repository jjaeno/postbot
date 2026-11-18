import { Prisma, type PrismaClient, type OAuthCredential } from "@prisma/client";
import { randomUUID } from "node:crypto";

export class OAuthReauthenticationRequired extends Error { constructor() { super("ACCOUNT_REAUTH_REQUIRED"); } }
type CredentialUpdate = Pick<OAuthCredential, "encryptedAccessToken" | "encryptedRefreshToken" | "tokenCipher" | "tokenKeyVersion" | "scopes" | "scopeHash" | "expiresAt">;

export async function resolveSharedOAuthCredential(prisma: PrismaClient, accountId: string, refresh: (credential: OAuthCredential) => Promise<CredentialUpdate>, options: { leaseMs?: number; waitMs?: number } = {}): Promise<OAuthCredential> {
  const token = randomUUID(); const deadline = Date.now() + (options.waitMs ?? 30000);
  while (true) {
    const claim = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM platform_accounts WHERE id = ${accountId} FOR UPDATE`;
      const account = await tx.platformAccount.findUnique({ where: { id: accountId }, include: { credential: true } });
      if (!account || account.status !== "CONNECTED" || !account.credential) throw new OAuthReauthenticationRequired();
      const credential = account.credential;
      if (!credential.expiresAt || credential.expiresAt.getTime() > Date.now() + 300000) return { kind: "READY" as const, credential };
      if (credential.refreshLeaseUntil && credential.refreshLeaseUntil.getTime() > Date.now()) return { kind: "WAIT" as const };
      if (!credential.encryptedRefreshToken) {
        await tx.platformAccount.update({ where: { id: accountId }, data: { status: "EXPIRED" } });
        return { kind: "REAUTH" as const };
      }
      await tx.oAuthCredential.update({ where: { id: credential.id }, data: { refreshLeaseToken: token, refreshLeaseUntil: new Date(Date.now() + (options.leaseMs ?? 60000)) } });
      return { kind: "OWNED" as const, credential };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (claim.kind === "READY") return claim.credential;
    if (claim.kind === "REAUTH") throw new OAuthReauthenticationRequired();
    if (claim.kind === "WAIT") {
      if (Date.now() >= deadline) throw new Error("OAUTH_REFRESH_IN_PROGRESS");
      await new Promise<void>((resolve) => setTimeout(resolve, 100)); continue;
    }
    try {
      const updated = await refresh(claim.credential);
      const changed = await prisma.oAuthCredential.updateMany({ where: { id: claim.credential.id, credentialVersion: claim.credential.credentialVersion, refreshLeaseToken: token, platformAccount: { status: "CONNECTED" } }, data: { ...updated, scopes: updated.scopes ?? Prisma.JsonNull, credentialVersion: { increment: 1 }, refreshLeaseToken: null, refreshLeaseUntil: null, lastRefreshedAt: new Date() } });
      if (!changed.count) throw new Error("OAUTH_REFRESH_SUPERSEDED");
      return prisma.oAuthCredential.findUniqueOrThrow({ where: { id: claim.credential.id } });
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM platform_accounts WHERE id = ${accountId} FOR UPDATE`;
        const released = await tx.oAuthCredential.updateMany({ where: { id: claim.credential.id, credentialVersion: claim.credential.credentialVersion, refreshLeaseToken: token }, data: { refreshLeaseToken: null, refreshLeaseUntil: null } });
        if (released.count && error instanceof OAuthReauthenticationRequired) await tx.platformAccount.updateMany({ where: { id: accountId, status: "CONNECTED" }, data: { status: "EXPIRED" } });
      });
      throw error;
    }
  }
}
