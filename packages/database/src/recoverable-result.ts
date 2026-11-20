import type { Prisma, PrismaClient } from "@prisma/client";
const object = (value: Prisma.JsonValue | undefined | null): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export async function hasRecoverableResult(db: PrismaClient | Prisma.TransactionClient, job: { id: string; type: string; channelId: string | null; payload: Prisma.JsonValue }): Promise<boolean> {
  const payload = object(job.payload); const llm = object(payload._llmAttempts); const media = object(payload._mediaCalls);
  if (Object.values(llm).some((value) => object(value).state === "STARTED") || Object.values(media).some((state) => state === "STARTED")) return false;
  if (job.type === "SCRIPT") {
    const receipt = await db.providerUsage.findUnique({ where: { idempotencyKey: `script-job:${job.id}` } });
    const result = object(receipt?.providerResponse);
    return receipt?.productionJobId === job.id && typeof result.contentItemId === "string" && typeof result.scriptVersionId === "string" && typeof result.sceneVersionId === "string" && await db.sceneVersion.count({ where: { id: result.sceneVersionId, scriptVersionId: result.scriptVersionId, contentItemId: result.contentItemId, contentItem: { channelId: job.channelId ?? "" } } }) === 1;
  }
  if (job.type !== "ASSET" && job.type !== "TTS") return false;
  const domain = object(payload[job.type === "ASSET" ? "assetPreparation" : "ttsPreparation"]);
  if (typeof domain.sceneVersionId !== "string") return false;
  const scene = await db.sceneVersion.findFirst({ where: { id: domain.sceneVersionId, contentItem: { channelId: job.channelId ?? "" } } });
  if (!scene || scene.retentionState !== "ACTIVE") return false;
  const document = object(scene.sceneDocument);
  const required = job.type === "TTS" ? ["tts"] : (Array.isArray(document.scenes) ? document.scenes : []).flatMap((value) => { const item = object(value); return item.visualMode === "GRAPHIC" ? [] : typeof item.id === "string" ? [`image:${item.id}`] : ["UNKNOWN"]; });
  if (!required.length || required.some((key) => media[key] !== "COMPLETED")) return false;
  const caches = await db.assetGenerationCache.findMany({ where: { ownerKey: job.id, channelId: job.channelId ?? "", state: "READY", callKey: { in: required }, asset: { retentionState: "ACTIVE" } } });
  return required.every((key) => caches.some((cache) => cache.callKey === key && cache.assetId));
}
