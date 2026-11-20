import { Prisma, type PrismaClient } from "@postbot/database";
import type { StorageProvider } from "@postbot/providers";
import { createHash } from "node:crypto";
export async function auditStorage(prisma: PrismaClient, storage: StorageProvider, workspaceId: string, cursor: { asset?: string; scene?: string; object?: string } = {}, options: { scanGlobalOrphans?: boolean } = {}) {
  if (!storage.inspect) return { state: "INSPECTION_NOT_SUPPORTED" as const };
  const assets = await prisma.asset.findMany({ where: { channel: { workspaceId }, retentionState: "ACTIVE", ...(cursor.asset ? { id: { gt: cursor.asset } } : {}) }, orderBy: { id: "asc" }, take: 100 });
  const scenes = await prisma.sceneVersion.findMany({ where: { contentItem: { channel: { workspaceId } }, retentionState: "ACTIVE", renderManifest: { not: Prisma.DbNull }, ...(cursor.scene ? { id: { gt: cursor.scene } } : {}) }, include: { contentItem: true }, orderBy: { id: "asc" }, take: 100 });
  let missingAssets = 0; let missingRenders = 0;
  for (const asset of assets) {
    const probe = await storage.inspect(asset.storageKey);
    if (!probe.exists) { await prisma.asset.updateMany({ where: { id: asset.id, retentionState: "ACTIVE" }, data: { retentionState: "MISSING" } }); missingAssets++; }
  }
  for (const scene of scenes) {
    const manifest = scene.renderManifest && typeof scene.renderManifest === "object" && !Array.isArray(scene.renderManifest) ? scene.renderManifest : {};
    const keys = [manifest.videoKey, manifest.thumbnailKey].filter((key): key is string => typeof key === "string");
    let missing = false; for (const key of keys) if (!(await storage.inspect(key)).exists) missing = true;
    if (!missing) continue;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM scene_versions WHERE id = ${scene.id} FOR UPDATE`;
      const current = await tx.sceneVersion.findUniqueOrThrow({ where: { id: scene.id } });
      if (JSON.stringify(current.renderManifest) !== JSON.stringify(scene.renderManifest) || current.retentionState !== "ACTIVE") return;
      await tx.storageDeletion.upsert({ where: { kind_resourceId: { kind: "RENDER", resourceId: scene.id } }, update: { state: "MISSING", objectKeys: keys, snapshot: scene.renderManifest ?? Prisma.JsonNull }, create: { workspaceId, channelId: scene.contentItem.channelId, resourceId: scene.id, kind: "RENDER", state: "MISSING", objectKeys: keys, snapshot: scene.renderManifest ?? Prisma.JsonNull } });
      await tx.sceneVersion.update({ where: { id: scene.id }, data: { renderManifest: Prisma.DbNull, retentionState: "MISSING" } }); missingRenders++;
    });
  }
  const objects = options.scanGlobalOrphans && storage.list ? await storage.list("", cursor.object) : null;
  const unreferencedObjectHashes: string[] = [];
  for (const key of objects?.keys ?? []) {
    const references = await prisma.asset.count({ where: { storageKey: key } }) + await prisma.sceneVersion.count({ where: { OR: [{ renderManifest: { path: "$.videoKey", equals: key } }, { renderManifest: { path: "$.thumbnailKey", equals: key } }] } }) + await prisma.storageDeletion.count({ where: { state: { not: "DONE" }, objectKeys: { array_contains: key } } });
    if (!references) unreferencedObjectHashes.push(createHash("sha256").update(key).digest("hex"));
  }
  return { state: "CHECKED" as const, missingAssets, missingRenders, unreferencedObjectHashes, orphanAction: options.scanGlobalOrphans ? "REVIEW_ONLY_OWNERSHIP_UNKNOWN_NO_AUTOMATIC_DELETE" : "GLOBAL_SCAN_REQUIRES_OPERATOR_CLI", nextAssetCursor: assets.length === 100 ? assets.at(-1)?.id ?? null : null, nextSceneCursor: scenes.length === 100 ? scenes.at(-1)?.id ?? null : null, nextObjectCursor: objects?.nextCursor ?? null };
}

export async function restoreStorageRecord(prisma: PrismaClient, storage: StorageProvider, workspaceId: string, kind: "ASSET" | "RENDER", resourceId: string, evidenceHash: string) {
  if (!/^[a-f0-9]{64}$/u.test(evidenceHash)) throw new Error("RESTORE_EVIDENCE_REQUIRED");
  const asset = kind === "ASSET" ? await prisma.asset.findFirst({ where: { id: resourceId, channel: { workspaceId }, retentionState: "MISSING" } }) : null;
  const task = kind === "RENDER" ? await prisma.storageDeletion.findFirst({ where: { workspaceId, kind, resourceId, state: "MISSING" } }) : null;
  const snapshot = task?.snapshot && typeof task.snapshot === "object" && !Array.isArray(task.snapshot) ? task.snapshot : {};
  const objects = asset ? [{ key: asset.storageKey, checksum: asset.checksumSha256 }] : task ? [{ key: snapshot.videoKey, checksum: snapshot.videoChecksumSha256 }, ...(typeof snapshot.thumbnailKey === "string" ? [{ key: snapshot.thumbnailKey, checksum: snapshot.thumbnailChecksumSha256 }] : [])] : [];
  if (!objects.length) throw new Error("MISSING_RESOURCE_NOT_FOUND");
  for (const item of objects) {
    if (typeof item.key !== "string" || typeof item.checksum !== "string" || !/^[a-f0-9]{64}$/u.test(item.checksum)) throw new Error("LEGACY_CHECKSUM_UNAVAILABLE_REVIEW_REQUIRED");
    const bytes = await storage.download(item.key);
    if (createHash("sha256").update(bytes).digest("hex") !== item.checksum) throw new Error("RESTORED_OBJECT_CHECKSUM_MISMATCH");
  }
  await prisma.$transaction(async (tx) => {
    if (asset) await tx.asset.updateMany({ where: { id: asset.id, retentionState: "MISSING", checksumSha256: asset.checksumSha256 }, data: { retentionState: "ACTIVE" } });
    if (task) {
      await tx.$queryRaw`SELECT id FROM storage_deletions WHERE id = ${task.id} FOR UPDATE`;
      const current = await tx.storageDeletion.findUniqueOrThrow({ where: { id: task.id } });
      if (current.state !== "MISSING" || JSON.stringify(current.snapshot) !== JSON.stringify(task.snapshot)) throw new Error("RESTORE_SUPERSEDED");
      await tx.sceneVersion.updateMany({ where: { id: resourceId, retentionState: "MISSING" }, data: { retentionState: "ACTIVE", renderManifest: task.snapshot ?? Prisma.JsonNull } });
      await tx.storageDeletion.update({ where: { id: task.id }, data: { state: "RESTORED" } });
    }
    await tx.auditLog.create({ data: { workspaceId, action: "storage.restore_verified", targetType: kind, targetId: resourceId, metadata: { evidenceHash, basis: "ORIGINAL_STORED_SHA256", approvalChanged: false } } });
  });
  return { restored: true, kind, resourceId, approvalChanged: false };
}
