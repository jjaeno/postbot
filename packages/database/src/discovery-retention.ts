import { Prisma, type PrismaClient } from "@prisma/client";
// Bounded local DB maintenance; preserve candidate ownership and in-flight proof.
export async function pruneDiscoveryChannel(prisma: PrismaClient, channelId: string, retentionDays: number | null, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
    const channel = await tx.channel.findUniqueOrThrow({ where: { id: channelId }, select: { discoveryRetentionCursor: true } });
    const expired = await tx.sourceFetch.findMany({ where: { channelId, state: "READY", expiresAt: { lte: now } }, orderBy: { id: "asc" }, take: 100, select: { id: true } });
    await tx.sourceFetch.updateMany({ where: { id: { in: expired.map((row) => row.id) }, expiresAt: { lte: now } }, data: { state: "EXPIRED", response: Prisma.DbNull } });
    const receipts = await tx.sourceFetch.findMany({ where: { channelId, startedAt: { lt: new Date(now.getTime() - 2 * 86400000) } }, orderBy: { id: "asc" }, take: 100, select: { id: true } });
    await tx.sourceFetch.deleteMany({ where: { id: { in: receipts.map((row) => row.id) }, startedAt: { lt: new Date(now.getTime() - 2 * 86400000) } } });
    let candidatesRemoved = 0;
    if (retentionDays !== null) {
      if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) throw new Error("INVALID_DISCOVERY_RETENTION");
      const candidates = await tx.contentIdea.findMany({ where: { channelId, ...(channel.discoveryRetentionCursor ? { id: { gt: channel.discoveryRetentionCursor } } : {}), usedContentItemId: null, status: { in: ["CANDIDATE", "REJECTED", "EXPIRED"] }, collectedAt: { lt: new Date(now.getTime() - retentionDays * 86400000) } }, orderBy: { id: "asc" }, take: 100 });
      await tx.channel.update({ where: { id: channelId }, data: { discoveryRetentionCursor: candidates.length === 100 ? candidates.at(-1)?.id ?? null : null } });
      for (const idea of candidates) {
        const snapshot = idea.rawSnapshot && typeof idea.rawSnapshot === "object" && !Array.isArray(idea.rawSnapshot) ? idea.rawSnapshot : {};
        if (typeof snapshot.reservationRunId === "string") continue;
        if (await tx.productionJob.count({ where: { channelId, payload: { path: "$.generation.idea.id", equals: idea.id } } })) continue;
        const removed = await tx.contentIdea.deleteMany({ where: { id: idea.id, usedContentItemId: null, status: idea.status, updatedAt: idea.updatedAt } }); candidatesRemoved += removed.count;
      }
    }
    return { expiredBodies: expired.length, expiredReceipts: receipts.length, candidatesRemoved };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
