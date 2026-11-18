import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { OAuthReauthenticationRequired, resolveSharedOAuthCredential } from "./oauth-refresh.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("process shared OAuth refresh fencing", () => {
  const prisma = new PrismaClient(); afterAll(() => prisma.$disconnect());
  const seed = async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@oauth-lease.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, platform: "YOUTUBE", externalAccountId: key, credential: { create: { encryptedAccessToken: "fixture-expired-cipher", encryptedRefreshToken: "fixture-refresh-cipher", tokenCipher: "fixture", tokenKeyVersion: 1, scopeHash: "fixture", scopes: ["fixture"], expiresAt: new Date(0) } } }, include: { credential: true } });
    return { workspace, account };
  };
  it("lets two operating-system processes refresh once and share the new version", async () => {
    const { workspace, account } = await seed();
    const code = `import { PrismaClient, resolveSharedOAuthCredential } from "@postbot/database";
      const prisma = new PrismaClient();
      try { await resolveSharedOAuthCredential(prisma, ${JSON.stringify(account.id)}, async (credential) => {
        await prisma.auditLog.create({data:{workspaceId:${JSON.stringify(workspace.id)},action:"oauth.refresh.fixture",targetType:"fixture"}});
        await new Promise(resolve => setTimeout(resolve, 200));
        return { encryptedAccessToken:"fixture-refreshed-cipher", encryptedRefreshToken:credential.encryptedRefreshToken, tokenCipher:credential.tokenCipher, tokenKeyVersion:credential.tokenKeyVersion, scopes:credential.scopes, scopeHash:credential.scopeHash, expiresAt:new Date(Date.now()+3600000) };
      }); } finally { await prisma.$disconnect(); }`;
    const child = () => new Promise<void>((resolve, reject) => {
      const process = spawn(globalThis.process.execPath, ["--input-type=module", "--eval", code], { windowsHide: true, stdio: "pipe", env: globalThis.process.env });
      let errors = ""; process.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      process.once("error", reject); process.once("close", (status) => status === 0 ? resolve() : reject(new Error(`Refresh fixture failed: ${errors}`)));
    });
    await Promise.all([child(), child()]);
    expect(await prisma.auditLog.count({ where: { workspaceId: workspace.id, action: "oauth.refresh.fixture" } })).toBe(1);
    expect(await prisma.oAuthCredential.findUniqueOrThrow({ where: { platformAccountId: account.id } })).toMatchObject({ credentialVersion: 1, encryptedAccessToken: "fixture-refreshed-cipher", refreshLeaseToken: null });
  }, 20000);
  it.each(["disconnect", "reauthorize"])("fences an old refresh after %s", async (mode) => {
    const { account } = await seed(); let ready = () => {}; let release = () => {};
    const entered = new Promise<void>((resolve) => { ready = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = resolveSharedOAuthCredential(prisma, account.id, async (credential) => { ready(); await gate; return { encryptedAccessToken: "fixture-stale-cipher", encryptedRefreshToken: credential.encryptedRefreshToken, tokenCipher: credential.tokenCipher, tokenKeyVersion: 1, scopes: credential.scopes, scopeHash: credential.scopeHash, expiresAt: new Date(Date.now() + 3600000) }; });
    const outcome = running.catch((error: unknown) => error); await entered;
    if (mode === "disconnect") await prisma.platformAccount.update({ where: { id: account.id }, data: { status: "DISCONNECTED" } });
    else await prisma.oAuthCredential.update({ where: { platformAccountId: account.id }, data: { encryptedAccessToken: "fixture-new-authorization", credentialVersion: { increment: 1 }, refreshLeaseToken: null, refreshLeaseUntil: null } });
    release(); expect(await outcome).toMatchObject({ message: "OAUTH_REFRESH_SUPERSEDED" });
    expect((await prisma.oAuthCredential.findUniqueOrThrow({ where: { platformAccountId: account.id } })).encryptedAccessToken).toBe(mode === "disconnect" ? "fixture-expired-cipher" : "fixture-new-authorization");
  });
  it("marks definite revocation for reauthentication and releases the lease", async () => {
    const { account } = await seed();
    await expect(resolveSharedOAuthCredential(prisma, account.id, () => { throw new OAuthReauthenticationRequired(); })).rejects.toThrow("ACCOUNT_REAUTH_REQUIRED");
    expect((await prisma.platformAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("EXPIRED");
    expect((await prisma.oAuthCredential.findUniqueOrThrow({ where: { platformAccountId: account.id } })).refreshLeaseToken).toBeNull();
  });
});
