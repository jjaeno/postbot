import { Prisma, type PrismaClient } from "@postbot/database";
import type { StorageProvider } from "@postbot/providers";
const record = (value: Prisma.JsonValue | null): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const keys = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
const liveJobs = { in: ["QUEUED", "RUNNING", "RETRY_WAIT", "NEEDS_REVIEW", "CANCEL_REQUESTED"] as const };

async function protectedScene(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const scene = await tx.sceneVersion.findUnique({ where: { id }, include: { contentItem: true } });
  if (!scene || scene.contentItem.status !== "FAILED") return true;
  return await tx.automationRun.count({ where: { status: { in: ["QUEUED", "RUNNING", "PAUSED", "DRAINING"] }, steps: { some: { productionJob: { contentItemId: scene.contentItemId } } } } }) > 0 || await tx.publishPlan.count({ where: { contentItemId: scene.contentItemId, status: { not: "CANCELLED" } } }) > 0 || await tx.productionJob.count({ where: { contentItemId: scene.contentItemId, status: { in: [...liveJobs.in] } } }) > 0;
}
async function protectedAsset(tx: Prisma.TransactionClient, id: string, channelId: string): Promise<boolean> {
  return await tx.automationRun.count({ where: { channelId, status: { in: ["QUEUED", "RUNNING", "PAUSED", "DRAINING"] } } }) > 0 || await tx.assetUsage.count({ where: { assetId: id } }) > 0 || await tx.assetGenerationCache.count({ where: { assetId: id } }) > 0 || await tx.productionJob.count({ where: { channelId, status: { in: [...liveJobs.in] } } }) > 0 || await tx.sceneVersion.count({ where: { contentItem: { channelId }, OR: [{ sceneDocument: { path: "$.visualGuide.referenceAssetIds", array_contains: id } }, ...["$.style.logoAssetId", "$.audio.bgmAssetId", "$.audio.sfxAssetId"].map((path) => ({ sceneDocument: { path, equals: id } }))] } }) > 0 || (await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM channel_templates WHERE channelId = ${channelId} AND JSON_SEARCH(visualStyle, 'one', ${id}) IS NOT NULL`)[0]?.count !== 0n;
}

export async function applySafeRetention(prisma: PrismaClient, storage: StorageProvider, workspaceId: string, before: Date): Promise<Record<string, number>> {
  let scenesMarked = 0; let assetsMarked = 0; let deleted = 0; let cancelled = 0;
  // Each page is independently durable; retry scans ACTIVE rows and resumes tombstones.
  let cursor: string | undefined;
  do {
    const scenes = await prisma.sceneVersion.findMany({ where: { retentionState: "ACTIVE", createdAt: { lt: before }, renderManifest: { not: Prisma.DbNull }, contentItem: { status: "FAILED", channel: { workspaceId } }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 100 });
    for (const scene of scenes) await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM scene_versions WHERE id = ${scene.id} FOR UPDATE`;
      if (await protectedScene(tx, scene.id)) return;
      const current = await tx.sceneVersion.findUniqueOrThrow({ where: { id: scene.id }, include: { contentItem: true } });
      if (current.retentionState !== "ACTIVE") return;
      const manifest = record(current.renderManifest); const objectKeys = [manifest.videoKey, manifest.thumbnailKey].filter((key): key is string => typeof key === "string");
      await tx.storageDeletion.upsert({ where: { kind_resourceId: { kind: "RENDER", resourceId: scene.id } }, update: { state: "MARKED", objectKeys, snapshot: current.renderManifest ?? Prisma.JsonNull }, create: { workspaceId, channelId: current.contentItem.channelId, kind: "RENDER", resourceId: scene.id, objectKeys, snapshot: current.renderManifest ?? Prisma.JsonNull } });
      await tx.sceneVersion.update({ where: { id: scene.id }, data: { retentionState: "MARKED", renderManifest: Prisma.DbNull } }); scenesMarked++;
    });
    cursor = scenes.length === 100 ? scenes.at(-1)?.id : undefined;
  } while (cursor);
  cursor = undefined;
  do {
    const assets: Awaited<ReturnType<PrismaClient["asset"]["findMany"]>> = await prisma.asset.findMany({ where: { retentionState: "ACTIVE", channel: { workspaceId }, createdAt: { lt: before }, usages: { none: {} }, generationCaches: { none: {} }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 100 });
    for (const asset of assets) await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${asset.id} FOR UPDATE`;
      const current = await tx.asset.findUnique({ where: { id: asset.id } });
      if (!current?.channelId || current.retentionState !== "ACTIVE" || await protectedAsset(tx, asset.id, current.channelId)) return;
      await tx.storageDeletion.upsert({ where: { kind_resourceId: { kind: "ASSET", resourceId: asset.id } }, update: { state: "MARKED" }, create: { workspaceId, channelId: current.channelId, resourceId: asset.id, kind: "ASSET", objectKeys: [current.storageKey] } });
      await tx.asset.update({ where: { id: asset.id }, data: { retentionState: "MARKED" } }); assetsMarked++;
    });
    cursor = assets.length === 100 ? assets.at(-1)?.id : undefined;
  } while (cursor);
  cursor = undefined;
  do {
    const tasks: Awaited<ReturnType<PrismaClient["storageDeletion"]["findMany"]>> = await prisma.storageDeletion.findMany({ where: { workspaceId, state: { in: ["MARKED", "DELETING", "FILES_DELETED"] }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 100 });
    for (const task of tasks) {
      const permitted = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM storage_deletions WHERE id = ${task.id} FOR UPDATE`;
        const currentTask = await tx.storageDeletion.findUniqueOrThrow({ where: { id: task.id } });
        if (!["MARKED", "DELETING", "FILES_DELETED"].includes(currentTask.state)) return false;
        const blocked = task.kind === "RENDER" ? await protectedScene(tx, task.resourceId) : await protectedAsset(tx, task.resourceId, task.channelId);
        const objectKeys = keys(task.objectKeys);
        const sharedAsset = await tx.asset.count({ where: { id: { not: task.resourceId }, storageKey: { in: objectKeys } } });
        const sharedScene = objectKeys.length ? await tx.sceneVersion.count({ where: { id: { not: task.resourceId }, OR: objectKeys.flatMap((key) => [{ renderManifest: { path: "$.videoKey", equals: key } }, { renderManifest: { path: "$.thumbnailKey", equals: key } }]) } }) : 0;
        if (blocked || sharedAsset || sharedScene) {
          // Before any file deletion we can safely restore a newly protected record.
          if (currentTask.state === "MARKED") {
            if (task.kind === "RENDER") await tx.sceneVersion.updateMany({ where: { id: task.resourceId, retentionState: "MARKED" }, data: { retentionState: "ACTIVE", renderManifest: task.snapshot ?? Prisma.JsonNull } });
            else await tx.asset.updateMany({ where: { id: task.resourceId, retentionState: "MARKED" }, data: { retentionState: "ACTIVE" } });
            await tx.storageDeletion.update({ where: { id: task.id }, data: { state: "CANCELLED" } }); cancelled++;
          }
          return false;
        }
        await tx.storageDeletion.update({ where: { id: task.id }, data: { state: "DELETING" } });
        return true;
      });
      if (!permitted) continue;
      for (const key of keys(task.objectKeys)) await storage.delete(key);
      await prisma.storageDeletion.update({ where: { id: task.id }, data: { state: "FILES_DELETED" } });
      await prisma.$transaction(async (tx) => {
        if (task.kind === "ASSET") {
          await tx.assetSource.deleteMany({ where: { assetId: task.resourceId } });
          await tx.assetLicense.deleteMany({ where: { assetId: task.resourceId } });
          await tx.asset.deleteMany({ where: { id: task.resourceId, retentionState: "MARKED", usages: { none: {} }, generationCaches: { none: {} } } });
        } else await tx.sceneVersion.updateMany({ where: { id: task.resourceId, retentionState: "MARKED" }, data: { retentionState: "DELETED" } });
        await tx.storageDeletion.update({ where: { id: task.id }, data: { state: "DONE" } });
      }); deleted++;
    }
    cursor = tasks.length === 100 ? tasks.at(-1)?.id : undefined;
  } while (cursor);
  // Durable jobs, reservations, provider receipts, rights and candidate reservation
  // metadata are deliberately not erased by automatic retention.
  const oauth = await prisma.oAuthConnectionState.deleteMany({ where: { workspaceId, expiresAt: { lt: before } } });
  const sessions = await prisma.authSession.deleteMany({ where: { workspaceId, expiresAt: { lt: before } } });
  return { scenesMarked, assetsMarked, deleted, cancelled, oauthStates: oauth.count, authSessions: sessions.count };
}
