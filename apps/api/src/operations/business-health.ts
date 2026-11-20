import { ChannelCollectionProfileSchema, nextZonedSchedule } from "@postbot/contracts";
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
  const [lastCollectionAt, lastProductionAt, publication, missed, waiting, failures, budget, daily, usages] = await Promise.all([
    latest("COLLECT"), latest("RENDER"),
    prisma.platformPost.findFirst({ where: { publicationState: "PUBLISHED", publishPlan: { contentItem: scope } }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true } }),
    prisma.publishPlan.count({ where: { contentItem: scope, scheduledAt: { lt: new Date(now.getTime() - 900000) }, status: { in: ["SCHEDULED", "PUBLISHING", "UPLOADED", "PROCESSING", "HELD"] }, NOT: { platformPost: { visibility: "private", publicationState: "UPLOADED", publicationFailureCode: null } } } }),
    prisma.productionJob.count({ where: { ...scope, status: { in: ["QUEUED", "RETRY_WAIT", "NEEDS_REVIEW", "RUNNING"] }, createdAt: { lt: new Date(now.getTime() - 7200000) }, OR: [{ runAfter: null }, { runAfter: { lt: new Date(now.getTime() - 7200000) } }] } }),
    prisma.productionJob.count({ where: { ...scope, status: "FAILED", updatedAt: { gte: dayStart, lt: end } } }),
    prisma.productionJob.count({ where: { ...scope, status: "NEEDS_REVIEW", errorCode: { contains: "BUDGET" } } }),
    prisma.productionJob.groupBy({ by: ["type", "status"], where: { ...scope, updatedAt: { gte: dayStart, lt: end } }, _count: true }),
    prisma.providerUsage.findMany({ where: { occurredAt: { gte: dayStart, lt: end }, OR: [{ contentItem: scope }, { productionJob: scope }] }, select: { estimatedCost: true, actualCost: true } })
  ]);
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
  if (!channel.platformAccounts.length || !channel.scheduleRules.length) issues.push("CHANNEL_NOT_CONFIGURED");
  if (missed || slotsWithoutPlan) issues.push("MISSED_PUBLICATION"); if (waiting) issues.push("STALE_WORK"); if (failures >= 3) issues.push("REPEATED_FAILURES"); if (budget) issues.push("BUDGET_HOLD");
  if (channel.platformAccounts.some((account) => account.status !== "CONNECTED")) issues.push("ACCOUNT_REAUTH_REQUIRED");
  const config = loadConfig(); let localTemporaryStorage: { state: string; freeBytes?: string } = { state: "UNKNOWN" };
  try { const disk = await statfs(tmpdir(), { bigint: true }); const free = disk.bavail * disk.bsize; localTemporaryStorage = { state: free < BigInt(config.OPERATIONS_MIN_FREE_BYTES) ? "LOW" : "AVAILABLE", freeBytes: free.toString() }; if (localTemporaryStorage.state === "LOW") issues.push("TEMP_STORAGE_LOW"); } catch { /* Capacity remains explicitly unknown. */ }
  const cost = usages.reduce((sum, usage) => sum.plus(usage.actualCost ?? usage.estimatedCost ?? 0), new Prisma.Decimal(0));
  return { channelId, observedAt: now.toISOString(), channelStatus: channel.status, state: issues.length ? "ATTENTION_REQUIRED" : "PROGRESS_OBSERVED", issues, lastCollectionAt, lastProductionAt, lastPublicationAt: publication?.publishedAt?.toISOString() ?? null, missedPublications: missed + slotsWithoutPlan, slotsWithoutPlan, staleWork: waiting, localTemporaryStorage, objectStorageCapacity: "NOT_REPORTED_BY_STORAGE_ADAPTER", externalNotifications: config.OPERATIONS_NOTIFICATION_PROVIDER === "mock" ? "MOCK_ONLY" : "NOT_CONFIGURED", backup: await backupHealth(now), dailySummary: { createdContents, completedRenders, confirmedPosts, failedJobs: failures, budgetHeldJobs: budget, timezone: "UTC", periodStart: dayStart.toISOString(), periodEnd: end.toISOString(), counts: daily, recordedCost: cost.toFixed(6), currency: "USD", billingBasis: "ACTUAL_IF_CONFIRMED_ELSE_KNOWN_ESTIMATE" } };
}
const mock = new MockNotificationAdapter();
export async function monitorOperations(prisma: PrismaClient, operations: OperationsService, now: Date, cursor: string | null): Promise<string | null> {
  const channels = await prisma.channel.findMany({ where: { ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 50 });
  for (const channel of channels) {
    const rule = await prisma.collectionRule.findFirst({ where: { channelId: channel.id, isActive: true }, orderBy: { version: "desc" }, select: { profile: true } });
    const profile = ChannelCollectionProfileSchema.safeParse(rule?.profile);
    await pruneDiscoveryChannel(prisma, channel.id, profile.success ? profile.data.limits.retentionDays : null, now);
    const health = await channelBusinessHealth(prisma, channel.workspaceId, channel.id, now);
    for (const issue of health.issues) await operations.notify(channel.workspaceId, { channelId: channel.id, eventKey: `business.${issue}`, severity: issue === "MISSED_PUBLICATION" ? "CRITICAL" : "WARNING", payload: json({ health }), cooldownMinutes: 240 });
    if (!["VERIFIED_ARCHIVE_RESTORE_PENDING"].includes(health.backup.state)) await operations.notify(channel.workspaceId, { channelId: channel.id, eventKey: `backup.${health.backup.state}`, severity: "WARNING", payload: json(health.backup), cooldownMinutes: 1440 });
    const pending = await prisma.notification.findMany({ where: { workspaceId: channel.workspaceId, channelId: channel.id, acknowledgedAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
    for (const notification of pending) await deliverNotification(prisma, notification.id, loadConfig().OPERATIONS_NOTIFICATION_PROVIDER === "mock" ? mock : undefined, now);
  }
  return channels.length === 50 ? channels.at(-1)?.id ?? null : null;
}
