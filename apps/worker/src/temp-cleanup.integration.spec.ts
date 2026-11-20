import { PrismaClient } from "@postbot/database";
import { mkdtemp, mkdir, writeFile, access, rm, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir, hostname } from "node:os";
import { describe, it, expect, vi } from "vitest";
import { cleanupRenderTemps } from "./temp-cleanup.js";
async function removeFixture(root: string) {
 const base = await realpath(tmpdir()); const path = relative(base, await realpath(root)); if (isAbsolute(path) || path.startsWith("..") || !path.startsWith("postbot-temp-cleanup-test-")) throw new Error("TEST_SCOPE_ESCAPE"); await rm(root, { recursive: true, force: true });
}
describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("owned render temporary cleanup", () => {
 it("only removes an old dead local owner and preserves live or unverified directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "postbot-temp-cleanup-test-")); const prisma = new PrismaClient();
  const dead = join(root, "postbot-render-dead"); const live = join(root, "postbot-render-live"); const legacy = join(root, "postbot-render-legacy");
  const original = process.kill.bind(process);
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => { if (pid === 123456789) throw Object.assign(new Error("fixture dead"), { code: "ESRCH" }); return original(pid, signal); });
  try {
   for (const path of [dead, live, legacy]) await mkdir(path);
   for (const [path, pid] of [[dead,123456789],[live,process.pid]] as const) await writeFile(join(path,".postbot-owner.json"), JSON.stringify({ hostname: hostname(), pid, jobId: "missing-fixture", token: "fixture", startedAt: "2020-01-01T00:00:00Z" }));
   expect(await cleanupRenderTemps(prisma, new Date(), root)).toEqual({ removed: 1, preserved: 2 });
   await expect(access(dead)).rejects.toThrow(); await access(live); await access(legacy);
  } finally {
   kill.mockRestore(); await prisma.$disconnect();
   await removeFixture(root);
  }
 });
});
