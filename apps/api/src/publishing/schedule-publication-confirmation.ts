import type { PrismaClient } from "@postbot/database";
import type { JobsService } from "../jobs/jobs.service.js";

export async function schedulePublicationConfirmations(prisma: PrismaClient, jobs: JobsService, now: Date, cursor: string | null): Promise<string | null> {
  const posts = await prisma.platformPost.findMany({ where: { publicationState: { in: ["UPLOADED", "PROCESSING", "SCHEDULED", "LEGACY_UNCONFIRMED"] }, publicationFailureCode: null, ...(cursor ? { id: { gt: cursor } } : {}), OR: [{ nextPublicationCheckAt: null }, { nextPublicationCheckAt: { lte: now } }] }, include: { publishPlan: { include: { contentItem: { select: { channelId: true } } } }, platformAccount: { include: { credential: true } } }, orderBy: { id: "asc" }, take: 100 });
  for (const post of posts) {
    if (post.platformAccount.status !== "CONNECTED") continue;
    const active = await prisma.productionJob.count({ where: { type: "PUBLISH", status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT"] }, payload: { path: "$.publish.publishPlanId", equals: post.publishPlanId }, OR: [{ automationSteps: { none: {} } }, { automationSteps: { some: { automationRun: { status: { in: ["QUEUED", "RUNNING"] } } } } }] } });
    if (active) continue;
    try { await jobs.create(post.platformAccount.workspaceId, { type: "PUBLISH", channelId: post.publishPlan.contentItem.channelId, contentItemId: post.publishPlan.contentItemId,
      idempotencyKey: `publication-status:${post.id}:${post.platformAccount.credential?.credentialVersion ?? 0}:${post.nextPublicationCheckAt?.getTime() ?? "initial"}`,
      payload: { publish: { publishPlanId: post.publishPlanId, externalVideoId: post.externalPostId } } }); }
    catch { /* A status-only job cannot re-upload. Other accounts keep progressing. */ }
  }
  return posts.length === 100 ? posts.at(-1)!.id : null;
}
