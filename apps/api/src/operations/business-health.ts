import { ChannelCollectionProfileSchema, evaluateBusinessProgress, nextZonedSchedule } from "@postbot/contracts";
import { pruneDiscoveryChannel, Prisma, type PrismaClient } from "@postbot/database";
import { loadConfig } from "@postbot/config";
import { readFile, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { OperationsService } from "./operations.service.js";
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: Prisma.JsonValue): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export interface NotificationAdapter { readonly mode: "MOCK"; send(input: { id: string; eventKey: string; payload: Prisma.JsonObject }): Promise<void>; }
export class MockNotificationAdapter implements NotificationAdapter {
  readonly mode = "MOCK" as const; readonly delivered = new Set<string>();
  send(input: { id: string }): Promise<void> { this.delivered.add(input.id); return Promise.resolve(); }
}
export async function deliverNotification(prisma: PrismaClient, id: string, adapter?: NotificationAdapter, now = new Date()): Promise<void> {
  const token = createHash("sha256").update(`${id}:${now.getTime()}:${Math.random()}`).digest("hex");
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM notifications WHERE id = ${id} FOR UPDATE`;
    const row = await tx.notification.findUnique({ where: { id } }); if (!row || row.acknowledgedAt) return null;
    const payload = object(row.payload); const delivery = object(payload._delivery ?? null);
    if (object(payload._resolution ?? null).state === "RESOLVED") return null;
    if (typeof delivery.state === "string" && ["MOCK_DELIVERED", "NOT_CONFIGURED"].includes(delivery.state) || typeof delivery.retryAt === "string" && new Date(delivery.retryAt) > now) return null;
    if (!adapter) { await tx.notification.update({ where: { id }, data: { payload: { ...payload, _delivery: { state: "NOT_CONFIGURED" } } } }); return null; }
    await tx.notification.update({ where: { id }, data: { payload: { ...payload, _delivery: { state: "CLAIMED", token, retryAt: new Date(now.getTime() + 60000).toISOString() } } } }); return { row, payload };
  });
  if (!claimed || !adapter) return;
  let state = "MOCK_DELIVERED";
  try { await adapter.send({ id, eventKey: claimed.row.eventKey, payload: claimed.payload }); } catch { state = "FAILED"; }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM notifications WHERE id = ${id} FOR UPDATE`;
    const row = await tx.notification.findUniqueOrThrow({ where: { id } }); const payload = object(row.payload);
    if (object(payload._delivery ?? null).token !== token) return;
    await tx.notification.update({ where: { id }, data: { payload: { ...payload, _delivery: { state, mode: adapter.mode, retryAt: new Date(now.getTime() + 300000).toISOString() } } } });
  });
}
export async function backupHealth(now = new Date()) {
  const config = loadConfig();
  if (!config.BACKUP_STATUS_FILE) return { state: "NOT_CONFIGURED" };
  try {
    const value: unknown = JSON.parse(await readFile(config.BACKUP_STATUS_FILE, "utf8"));
    const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const lastSuccessAt = typeof data.lastSuccessAt === "string" && Number.isFinite(Date.parse(data.lastSuccessAt)) ? data.lastSuccessAt : null;
    const age = lastSuccessAt ? now.getTime() - Date.parse(lastSuccessAt) : Infinity;
    const verified = data.externalArchiveConfigured === true && data.encryptionVerified === true && data.archiveVerified === true && data.checksumVerified === true;
    return { state: data.state === "FAILED" ? "FAILED" : data.state === "LOCAL_TEST_ONLY" ? "LOCAL_TEST_ONLY" : age > config.BACKUP_MAX_AGE_HOURS * 3600000 ? "STALE" : verified ? "VERIFIED_ARCHIVE_RESTORE_PENDING" : "INCOMPLETE", lastSuccessAt, restoreVerifiedAt: typeof data.restoreVerifiedAt === "string" ? data.restoreVerifiedAt : null };
  } catch { return { state: "STATUS_UNREADABLE" }; }
}
export async function channelBusinessHealth(prisma: PrismaClient, workspaceId: string, channelId: string, now = new Date()) {
  const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId }, include: { platformAccounts: true, scheduleRules: { where: { isActive: true } } } });
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0); const end = new Date(dayStart.getTime() + 86400000);
  const scope = { channelId };
  const latest = async (type: "COLLECT" | "RENDER") => (await prisma.productionJob.findFirst({ where: { ...scope, type, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }))?.finishedAt?.toISOString() ?? null;
  const [legacyCollectionAt, lastProductionAt, publication, missed, waiting, failures, budget, daily, usages] = await Promise.all([
    latest("COLLECT"), latest("RENDER"),
    prisma.platformPost.findFirst({ where: { publicationState: "PUBLISHED", publishPlan: { contentItem: scope } }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true } }),
    prisma.publishPlan.count({ where: { contentItem: scope, scheduledAt: { lt: new Date(now.getTime() - 900000) }, status: { in: ["SCHEDULED", "PUBLISHING", "UPLOADED", "PROCESSING", "HELD"] }, NOT: { platformPost: { visibility: "private", publicationState: "UPLOADED", publicationFailureCode: null } } } }),
    prisma.productionJob.count({ where: { ...scope, status: { in: ["QUEUED", "RETRY_WAIT", "RUNNING"] }, createdAt: { lt: new Date(now.getTime() - 7200000) }, OR: [{ runAfter: null }, { runAfter: { lt: new Date(now.getTime() - 7200000) } }] } }),
    prisma.productionJob.count({ where: { ...scope, status: "FAILED", updatedAt: { gte: dayStart, lt: end } } }),
    prisma.productionJob.count({ where: { ...scope, status: "NEEDS_REVIEW", errorCode: { contains: "BUDGET" } } }),
    prisma.productionJob.groupBy({ by: ["type", "status"], where: { ...scope, updatedAt: { gte: dayStart, lt: end } }, _count: true }),
    prisma.providerUsage.findMany({ where: { occurredAt: { gte: dayStart, lt: end }, OR: [{ contentItem: scope }, { productionJob: scope }] }, select: { estimatedCost: true, actualCost: true } })
  ]);
  const rule = await prisma.collectionRule.findFirst({ where: { channelId, isActive: true }, orderBy: { version: "desc" } });
  const parsed = ChannelCollectionProfileSchema.safeParse(rule?.profile); const profile = parsed.success ? parsed.data : null;
  const [externalSuccess, lastFetch, productiveCollection, lastCollectionAttempt, lastProductionAttempt, activeProduction, reviewHold, inventory, nearScheduled, activeRuns, sourceCalls] = await Promise.all([
    prisma.sourceFetch.findFirst({ where: { channelId, state: { in: ["READY", "EXPIRED"] }, completedAt: { not: null } }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    prisma.sourceFetch.findFirst({ where: { channelId }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.productionJob.findFirst({ where: { channelId, type: "COLLECT", status: "SUCCEEDED", AND: [{ result: { path: "$.externalCollection.freshSuccessfulFetches", gt: 0 } }, { result: { path: "$.externalCollection.selected", gt: 0 } }] }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    prisma.productionJob.findFirst({ where: { channelId, type: "COLLECT", OR: [{ payload: { path: "$.collect.mode", equals: "DISCOVER" } }, { payload: { path: "$.collect.mode", equals: "COLLECT_SELECT" } }] }, orderBy: { createdAt: "desc" }, select: { createdAt: true, result: true } }),
    prisma.productionJob.findFirst({ where: { channelId, type: { in: ["SCRIPT", "ASSET", "TTS", "RENDER"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.productionJob.count({ where: { channelId, type: { in: ["SCRIPT", "ASSET", "TTS", "RENDER"] }, status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT"] } } }),
    prisma.productionJob.count({ where: { channelId, type: { in: ["SCRIPT", "ASSET", "TTS", "RENDER"] }, status: "NEEDS_REVIEW" } }),
    prisma.contentItem.groupBy({ by: ["status"], where: { channelId }, _count: { _all: true } }),
    prisma.contentItem.count({ where: { channelId, status: "SCHEDULED", publishPlans: { some: { status: "SCHEDULED", scheduledAt: { lte: new Date(now.getTime() + (profile?.production.scheduledBufferHours ?? 24) * 3600000) } } } } }),
    prisma.automationRun.findMany({ where: { channelId, status: { in: ["PAUSED", "DRAINING"] } }, orderBy: { updatedAt: "desc" }, take: 100, select: { status: true, checkpoint: true, pausedReason: true } }),
    prisma.sourceFetch.count({ where: { channelId, startedAt: { gte: dayStart, lt: end } } })
  ]);
  const count = (status: string) => inventory.find((entry) => entry.status === status)?._count._all ?? 0;
  const configured = Boolean(channel.platformAccounts.length && channel.scheduleRules.length);
  const accountHeld = channel.platformAccounts.length > 0 && !channel.platformAccounts.some((account) => account.status === "CONNECTED");
  const explicitPause = activeRuns.some((run) => run.status === "DRAINING" || object(run.checkpoint ?? null).explicitPause === true);
  const commonBlocker = explicitPause ? "INTENTIONALLY_PAUSED" : accountHeld ? "ACCOUNT_HOLD" : budget ? "BUDGET_HOLD" : null;
  const lastCollectionAt = productiveCollection?.finishedAt?.toISOString() ?? null;
  const lastExternalSuccessAt = [externalSuccess?.completedAt, productiveCollection?.finishedAt].filter((value): value is Date => value instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const collectResult = object(lastCollectionAttempt?.result ?? null);
  const lastCollectionAttemptAt = [lastFetch?.startedAt, lastCollectionAttempt?.createdAt].filter((value): value is Date => value instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const sourceConfigured = Boolean(profile && (profile.sources.collections.length || profile.sources.rssUrls.length || profile.sources.youtubeQueries.length || profile.sources.youtubeChannelIds.length));
  const collectionProgress = evaluateBusinessProgress({ now, createdAt: channel.createdAt, active: channel.status === "ACTIVE", cadenceMinutes: profile?.cadence.collectMinutes ?? rule?.collectionFrequencyMinutes ?? 360,
    configured: configured && sourceConfigured, lastAttemptAt: lastCollectionAttemptAt, lastSuccessAt: productiveCollection?.finishedAt ?? null,
    blocker: commonBlocker ?? (profile && sourceCalls >= profile.limits.dailyCalls ? "SOURCE_BUDGET_HOLD" : null), zeroCandidates: collectResult.discovered === 0 || object(collectResult.externalCollection ?? null).selected === 0 });
  const productionProgress = evaluateBusinessProgress({ now, createdAt: channel.createdAt, active: channel.status === "ACTIVE", cadenceMinutes: profile?.cadence.produceMinutes ?? 120,
    configured, lastAttemptAt: lastProductionAttempt?.createdAt ?? null, lastSuccessAt: lastProductionAt ? new Date(lastProductionAt) : null,
    blocker: commonBlocker ?? (reviewHold || count("REVIEW_REQUIRED") >= (profile?.production.reviewCap ?? 5) ? "REVIEW_HOLD" : null), inProgress: activeProduction > 0,
    inventorySatisfied: count("APPROVED") + nearScheduled >= channel.minInventoryCount });
  let slotsWithoutPlan = 0;
  if (channel.status === "ACTIVE" && channel.automationMode === "FULL_AUTO") for (const rule of channel.scheduleRules) {
    const due = nextZonedSchedule([rule], new Date(now.getTime() - 25 * 3600000));
    if (!due || due <= channel.createdAt || due.getTime() > now.getTime() - 900000) continue;
    const plans = await prisma.publishPlan.count({ where: { contentItem: scope, ...(rule.platform ? { platform: rule.platform } : {}), scheduledAt: { gte: new Date(due.getTime() - 60000), lte: new Date(due.getTime() + 60000) } } });
    if (!plans) slotsWithoutPlan++;
  }
  const [createdContents, completedRenders, confirmedPosts] = await Promise.all([
    prisma.contentItem.count({ where: { channelId, createdAt: { gte: dayStart, lt: end } } }),
    prisma.productionJob.count({ where: { channelId, type: "RENDER", status: "SUCCEEDED", finishedAt: { gte: dayStart, lt: end } } }),
    prisma.platformPost.count({ where: { publicationState: "PUBLISHED", publishPlan: { contentItem: scope }, publishedAt: { gte: dayStart, lt: end } } })
  ]);
  const issues: string[] = [];
  if (collectionProgress.state === "STALLED") issues.push("COLLECTION_STALLED");
  if (collectionProgress.state === "NO_CANDIDATES") issues.push("COLLECTION_NO_CANDIDATES");
  if (productionProgress.state === "STALLED") issues.push("PRODUCTION_STALLED");
  if (collectionProgress.state === "SOURCE_BUDGET_HOLD") issues.push("SOURCE_BUDGET_HOLD");
  if (!channel.platformAccounts.length || !channel.scheduleRules.length) issues.push("CHANNEL_NOT_CONFIGURED");
  if (missed || slotsWithoutPlan) issues.push("MISSED_PUBLICATION"); if (waiting) issues.push("STALE_WORK"); if (failures >= 3) issues.push("REPEATED_FAILURES"); if (budget) issues.push("BUDGET_HOLD");
  if (channel.platformAccounts.some((account) => account.status !== "CONNECTED")) issues.push("ACCOUNT_REAUTH_REQUIRED");
  const config = loadConfig(); let localTemporaryStorage: { state: string; freeBytes?: string } = { state: "UNKNOWN" };
  try { const disk = await statfs(tmpdir(), { bigint: true }); const free = disk.bavail * disk.bsize; localTemporaryStorage = { state: free < BigInt(config.OPERATIONS_MIN_FREE_BYTES) ? "LOW" : "AVAILABLE", freeBytes: free.toString() }; if (localTemporaryStorage.state === "LOW") issues.push("TEMP_STORAGE_LOW"); } catch { /* Capacity remains explicitly unknown. */ }
  const cost = usages.reduce((sum, usage) => sum.plus(usage.actualCost ?? usage.estimatedCost ?? 0), new Prisma.Decimal(0));
  return { channelId, observedAt: now.toISOString(), channelStatus: channel.status, state: issues.length ? "ATTENTION_REQUIRED" : channel.status !== "ACTIVE" ? "INTENTIONALLY_PAUSED" : lastCollectionAt || lastProductionAt || publication?.publishedAt ? "PROGRESS_OBSERVED" : "NO_PROGRESS_OBSERVED", issues, lastCollectionAt, lastExternalSuccessAt: lastExternalSuccessAt?.toISOString() ?? null, legacyCollectionJobAt: legacyCollectionAt, collectionProgress, productionProgress, inventory: { ready: count("APPROVED") + nearScheduled, generating: count("GENERATING"), review: count("REVIEW_REQUIRED"), target: channel.minInventoryCount }, lastProductionAt, lastPublicationAt: publication?.publishedAt?.toISOString() ?? null, missedPublications: missed + slotsWithoutPlan, slotsWithoutPlan, staleWork: waiting, localTemporaryStorage, objectStorageCapacity: "NOT_REPORTED_BY_STORAGE_ADAPTER", externalNotifications: config.OPERATIONS_NOTIFICATION_PROVIDER === "mock" ? "MOCK_ONLY" : "NOT_CONFIGURED", backup: await backupHealth(now), dailySummary: { createdContents, completedRenders, confirmedPosts, failedJobs: failures, budgetHeldJobs: budget, timezone: "UTC", periodStart: dayStart.toISOString(), periodEnd: end.toISOString(), counts: daily, recordedCost: cost.toFixed(6), currency: "USD", billingBasis: "ACTUAL_IF_CONFIRMED_ELSE_KNOWN_ESTIMATE" } };
}
const mock = new MockNotificationAdapter();
export async function monitorOperations(prisma: PrismaClient, operations: OperationsService, now: Date, cursor: string | null): Promise<string | null> {
  const channels = await prisma.channel.findMany({ where: { ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 50 });
  for (const channel of channels) {
    const rule = await prisma.collectionRule.findFirst({ where: { channelId: channel.id, isActive: true }, orderBy: { version: "desc" }, select: { profile: true } });
    const profile = ChannelCollectionProfileSchema.safeParse(rule?.profile);
    await pruneDiscoveryChannel(prisma, channel.id, profile.success ? profile.data.limits.retentionDays : null, now);
    const health = await channelBusinessHealth(prisma, channel.workspaceId, channel.id, now);
    const unresolved = await prisma.notification.findMany({ where: { channelId: channel.id, eventKey: { startsWith: "business." } }, orderBy: { createdAt: "desc" }, take: 100 });
    for (const notice of unresolved) if (!health.issues.some((issue) => notice.eventKey === `business.${issue}`) && object(object(notice.payload)._resolution ?? null).state !== "RESOLVED") await prisma.notification.update({ where: { id: notice.id }, data: { payload: { ...object(notice.payload), _resolution: { state: "RESOLVED", resolvedAt: now.toISOString() } } } });
    for (const issue of health.issues) await operations.notify(channel.workspaceId, { channelId: channel.id, eventKey: `business.${issue}`, severity: issue === "MISSED_PUBLICATION" ? "CRITICAL" : "WARNING", payload: json({ health }), cooldownMinutes: 240 });
    if (!["VERIFIED_ARCHIVE_RESTORE_PENDING"].includes(health.backup.state)) await operations.notify(channel.workspaceId, { channelId: channel.id, eventKey: `backup.${health.backup.state}`, severity: "WARNING", payload: json(health.backup), cooldownMinutes: 1440 });
    const pending = await prisma.notification.findMany({ where: { workspaceId: channel.workspaceId, channelId: channel.id, acknowledgedAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
    for (const notification of pending) await deliverNotification(prisma, notification.id, loadConfig().OPERATIONS_NOTIFICATION_PROVIDER === "mock" ? mock : undefined, now);
  }
  return channels.length === 50 ? channels.at(-1)?.id ?? null : null;
}
