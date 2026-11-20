import type { PrismaClient } from "@postbot/database";
import { opendir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, relative, isAbsolute } from "node:path";
export async function cleanupRenderTemps(prisma: PrismaClient, now = new Date(), root = tmpdir()) {
  const base = await realpath(root); let removed = 0; let preserved = 0;
  for await (const entry of await opendir(base)) {
    if (!entry.isDirectory() || !entry.name.startsWith("postbot-render-")) continue;
    const name = entry.name;
      const directory = await realpath(join(base, name)); const path = relative(base, directory);
      if (isAbsolute(path) || path.startsWith("..") || !path.startsWith("postbot-render-")) throw new Error("TEMP_CLEANUP_SCOPE_ESCAPE");
      let marker: Record<string, unknown>;
      try { const value: unknown = JSON.parse(await readFile(join(directory, ".postbot-owner.json"), "utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_MARKER"); marker = value as Record<string, unknown>; } catch { preserved++; continue; }
      if (marker.hostname !== hostname() || typeof marker.pid !== "number" || marker.pid <= 0 || typeof marker.startedAt !== "string" || !Number.isFinite(Date.parse(marker.startedAt)) || now.getTime() - Date.parse(marker.startedAt) < 86400000 || typeof marker.jobId !== "string") { preserved++; continue; }
      try { process.kill(marker.pid, 0); preserved++; continue; } catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") { preserved++; continue; } }
      const job = await prisma.productionJob.findUnique({ where: { id: marker.jobId } });
      if (job && ["RUNNING", "CANCEL_REQUESTED"].includes(job.status) && job.executionToken === marker.token) { preserved++; continue; }
      await rm(directory, { recursive: true, force: true }); removed++;
  }
  return { removed, preserved };
}
