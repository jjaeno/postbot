import { createHash } from "node:crypto";
import { assertExecutionOwner, type Prisma, type PrismaClient } from "@postbot/database";
import type { StorageProvider } from "@postbot/providers";

export type GenerationReceipt = { assetId: string; snapshot: Prisma.InputJsonObject };
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, ordered(entry)])) : value;
export const generationInputKey = (input: Readonly<Record<string, unknown>>) => createHash("sha256").update(JSON.stringify(ordered({ cacheVersion: "asset-input-v1", ...input }))).digest("hex");

export async function cachedGeneration(prisma: PrismaClient, storage: StorageProvider, input: { channelId: string; inputKey: string; ownerKey: string }, create: (providerKey: string) => Promise<GenerationReceipt>): Promise<GenerationReceipt> {
  const claim = await prisma.$transaction(async (tx) => {
    await assertExecutionOwner(tx);
    await tx.$queryRaw`SELECT id FROM channels WHERE id = ${input.channelId} FOR UPDATE`;
    const existing = await tx.assetGenerationCache.findUnique({ where: { channelId_inputKey: { channelId: input.channelId, inputKey: input.inputKey } } });
    if (existing) return { cached: true, row: existing };
    return { cached: false, row: await tx.assetGenerationCache.create({ data: { ...input, state: "STARTED" } }) };
  });
  if (claim.cached) {
    if (claim.row.state !== "READY") throw new Error(claim.row.state === "STARTED" && claim.row.ownerKey !== input.ownerKey ? "ASSET_CACHE_IN_PROGRESS" : "AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED");
    const snapshot = claim.row.snapshot;
    if (!claim.row.assetId || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("ASSET_CACHE_RECEIPT_INVALID");
    const asset = await prisma.asset.findFirst({ where: { id: claim.row.assetId, channelId: input.channelId } });
    if (!asset) throw new Error("ASSET_CACHE_REFERENCE_MISSING");
    try { await storage.download(asset.storageKey); } catch { throw new Error("ASSET_CACHE_OBJECT_MISSING_RESTORE_OR_RECONCILE"); }
    return { assetId: asset.id, snapshot: { ...snapshot, reuseReason: "EXACT_PROVIDER_INPUT_CACHE", cacheInputKey: input.inputKey } };
  }
  try {
    const result = await create(`asset-cache:${claim.row.id}`);
    // Preserve a late receipt even if the caller lost execution ownership.
    await prisma.assetGenerationCache.update({ where: { id: claim.row.id }, data: { state: "READY", assetId: result.assetId, snapshot: result.snapshot } });
    return result;
  } catch (error) {
    await prisma.assetGenerationCache.update({ where: { id: claim.row.id }, data: { state: "AMBIGUOUS" } });
    throw error;
  }
}
