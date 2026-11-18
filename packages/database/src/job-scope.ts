import type { Prisma, PrismaClient } from "@prisma/client";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Resource IDs in an executable payload must resolve within the persisted job scope.
// Trace fields and caller-supplied snapshots never establish ownership.
export async function assertJobScope(db: PrismaClient | Prisma.TransactionClient, job: {
  channelId: string | null; contentItemId?: string | null; type: string; payload: unknown;
}): Promise<void> {
  const payload = object(job.payload);
  const fail = (): never => { throw new Error("JOB_SCOPE_MISMATCH"); };
  if ("analysis" in payload) {
    const analysis = object(payload.analysis);
    if (job.type !== "ANALYTICS" || "analytics" in payload || !job.channelId || analysis.channelId !== job.channelId || !await db.channel.findUnique({ where: { id: job.channelId } })) fail();
  }
  if (job.contentItemId && (!job.channelId || !await db.contentItem.findFirst({ where: { id: job.contentItemId, channelId: job.channelId } }))) fail();
  const expected: Record<string, string> = { COLLECT: "collect", SCRIPT: "generation", ASSET: "assetPreparation", TTS: "ttsPreparation", RENDER: "render", POLICY: "policy", PUBLISH: "publish", ANALYTICS: "analytics" };
  for (const key of Object.values(expected)) if (key in payload && key !== expected[job.type]) fail();
  const domain = object(payload[expected[job.type] ?? ""]);
  if (Object.keys(domain).length && !job.channelId) fail();
  if (domain.channelId !== undefined && domain.channelId !== job.channelId) fail();
  if (domain.contentItemId !== undefined && domain.contentItemId !== null && domain.contentItemId !== job.contentItemId) fail();
  if (typeof domain.sceneVersionId === "string") {
    const scene = await db.sceneVersion.findFirst({ where: { id: domain.sceneVersionId, contentItemId: job.contentItemId ?? "", contentItem: { channelId: job.channelId ?? "" } } });
    if (!scene || (domain.platform !== undefined && domain.platform !== scene.platform)) fail();
  }
  if (job.type === "SCRIPT" && payload.generation) {
    const idea = object(domain.idea); const request = object(domain.request);
    if (idea.channelId !== job.channelId || request.ideaId !== idea.id || typeof idea.id !== "string" ||
      !await db.contentIdea.findFirst({ where: { id: idea.id, channelId: job.channelId ?? "" } })) fail();
  }
  if (payload.automation) {
    const automation = object(payload.automation);
    if (automation.stage !== job.type || typeof automation.runId !== "string" ||
      !await db.automationRun.findFirst({ where: { id: automation.runId, channelId: job.channelId ?? "" } })) fail();
  }
  if (job.type === "PUBLISH") {
    if (typeof domain.publishPlanId !== "string") fail();
    const plan = await db.publishPlan.findFirst({ where: { id: domain.publishPlanId as string, contentItemId: job.contentItemId ?? "", contentItem: { channelId: job.channelId ?? "" } }, include: { platformAccount: true, contentItem: { include: { channel: true } } } });
    if (!plan || plan.platformAccount.channelId !== job.channelId || plan.platformAccount.workspaceId !== plan.contentItem.channel.workspaceId || plan.platformAccount.platform !== plan.platform) fail();
  }
  if (job.type === "ANALYTICS" && !("analysis" in payload)) {
    if (typeof domain.syncId !== "string" || !await db.analyticsSync.findFirst({ where: { id: domain.syncId, channelId: job.channelId ?? "" } })) fail();
    if (domain.platformPostId !== undefined && (typeof domain.platformPostId !== "string" || !await db.platformPost.findFirst({ where: { id: domain.platformPostId, publishPlan: { contentItem: { channelId: job.channelId ?? "", ...(job.contentItemId ? { id: job.contentItemId } : {}) } } } }))) fail();
  }
}
