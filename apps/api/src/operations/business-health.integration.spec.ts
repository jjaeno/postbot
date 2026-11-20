import { PrismaClient } from "@postbot/database";
import { collectionProfilePreset } from "@postbot/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { channelBusinessHealth, deliverNotification, MockNotificationAdapter, monitorOperations } from "./business-health.js";
import { OperationsService } from "./operations.service.js";
import type { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
const prisma = new PrismaClient();
describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("business progress and notification delivery", () => {
  afterAll(() => prisma.$disconnect());
  async function fixture() {
    const key = randomUUID(); const user = await prisma.user.create({ data: { email: `${key}@health.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const operations = new OperationsService(prisma, {} as OAuthCryptoService, { enqueue: () => Promise.resolve(), close: () => Promise.resolve() });
    return { key, user, workspace, channel, operations };
  }
  it("uses grace, ready inventory, review, explicit pause, account and budget holds instead of false stall warnings", async () => {
    const now = new Date();
    for (const reason of ["INITIAL_GRACE", "INTENTIONALLY_PAUSED", "INVENTORY_SATISFIED", "REVIEW_HOLD", "ACCOUNT_HOLD", "BUDGET_HOLD", "IN_PROGRESS"]) {
      const f = await fixture();
      await prisma.channel.update({ where: { id: f.channel.id }, data: { status: reason === "INTENTIONALLY_PAUSED" ? "PAUSED" : "ACTIVE", minInventoryCount: 1, createdAt: new Date(now.getTime() - (reason === "INITIAL_GRACE" ? 30 * 60000 : 86400000)) } });
      await prisma.collectionRule.create({ data: { channelId: f.channel.id, profile: collectionProfilePreset("SCIENCE", "en"), keywords: ["space"], recencyHours: 24, collectionFrequencyMinutes: 360 } });
      await prisma.platformAccount.create({ data: { channelId: f.channel.id, workspaceId: f.workspace.id, platform: "YOUTUBE", status: reason === "ACCOUNT_HOLD" ? "EXPIRED" : "CONNECTED", externalAccountId: f.key } });
      await prisma.scheduleRule.create({ data: { channelId: f.channel.id, dayOfWeek: (now.getUTCDay() + 1) % 7, timeOfDayUtc: "12:00", timezone: "UTC" } });
      if (reason === "INVENTORY_SATISFIED") await prisma.contentItem.create({ data: { channelId: f.channel.id, title: "Ready", topicKey: f.key, status: "APPROVED" } });
      if (["REVIEW_HOLD", "BUDGET_HOLD", "IN_PROGRESS"].includes(reason)) await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "SCRIPT", queueName: "script", idempotencyKey: f.key, payload: {}, status: reason === "IN_PROGRESS" ? "RUNNING" : "NEEDS_REVIEW", errorCode: reason === "BUDGET_HOLD" ? "CHANNEL_BUDGET_EXCEEDED" : null } });
      const health = await channelBusinessHealth(prisma, f.workspace.id, f.channel.id, now);
      expect(health.productionProgress.state, reason).toBe(reason);
      expect(health.issues, reason).not.toContain("PRODUCTION_STALLED");
      if (["INITIAL_GRACE", "INTENTIONALLY_PAUSED", "ACCOUNT_HOLD", "BUDGET_HOLD"].includes(reason)) expect(health.issues, reason).not.toContain("COLLECTION_STALLED");
      expect(health.state, reason).not.toBe("PROGRESS_OBSERVED");
    }
  });
  it("detects collection and production with no jobs, then clears recovery without duplicate alerts", async () => {
    const f = await fixture(); const now = new Date(); const old = new Date(now.getTime() - 24 * 3600000);
    await prisma.channel.update({ where: { id: f.channel.id }, data: { status: "ACTIVE", automationMode: "FULL_AUTO", minInventoryCount: 2, createdAt: old } });
    await prisma.collectionRule.create({ data: { channelId: f.channel.id, profile: collectionProfilePreset("SCIENCE", "en"), keywords: ["space"], recencyHours: 24, collectionFrequencyMinutes: 360 } });
    await prisma.platformAccount.create({ data: { channelId: f.channel.id, workspaceId: f.workspace.id, platform: "YOUTUBE", status: "CONNECTED", externalAccountId: f.key } });
    await prisma.scheduleRule.create({ data: { channelId: f.channel.id, dayOfWeek: (now.getUTCDay() + 1) % 7, timeOfDayUtc: "12:00", timezone: "UTC" } });
    const health = await channelBusinessHealth(prisma, f.workspace.id, f.channel.id, now);
    expect(health.issues).toEqual(expect.arrayContaining(["COLLECTION_STALLED", "PRODUCTION_STALLED"]));
    expect(health.state).not.toBe("PROGRESS_OBSERVED");
    await monitorOperations(prisma, f.operations, now, f.channel.id.slice(0, -1));
    await monitorOperations(prisma, f.operations, now, f.channel.id.slice(0, -1));
    expect(await prisma.notification.count({ where: { channelId: f.channel.id, eventKey: "business.COLLECTION_STALLED" } })).toBe(1);
    await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "COLLECT", queueName: "collect", idempotencyKey: `${f.key}:rank`, status: "SUCCEEDED", finishedAt: now, payload: { collect: { mode: "RANK" } }, result: { ranked: 20 } } });
    expect((await channelBusinessHealth(prisma, f.workspace.id, f.channel.id, now)).lastCollectionAt).toBeNull();
    await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "COLLECT", queueName: "collect", idempotencyKey: `${f.key}:empty`, status: "SUCCEEDED", finishedAt: now, payload: { collect: { mode: "DISCOVER" } }, result: { discovered: 0, externalCollection: { freshSuccessfulFetches: 1, selected: 0 } } } });
    expect((await channelBusinessHealth(prisma, f.workspace.id, f.channel.id, now)).collectionProgress.state).toBe("NO_CANDIDATES");
    await prisma.sourceFetch.create({ data: { channelId: f.channel.id, source: "NASA", requestKey: f.key, state: "READY", response: {}, completedAt: now, expiresAt: new Date(now.getTime() + 3600000) } });
    await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "COLLECT", queueName: "collect", idempotencyKey: `${f.key}:collected`, status: "SUCCEEDED", finishedAt: now, payload: { collect: { mode: "DISCOVER" } }, result: { discovered: 1, externalCollection: { freshSuccessfulFetches: 1, selected: 1 } } } });
    await prisma.productionJob.create({ data: { channelId: f.channel.id, type: "RENDER", queueName: "render", idempotencyKey: `${f.key}:render`, status: "SUCCEEDED", finishedAt: now, payload: {} } });
    const restored = await channelBusinessHealth(prisma, f.workspace.id, f.channel.id, now);
    expect(restored.collectionProgress.state).toBe("AWAITING_NEXT_CYCLE"); expect(restored.productionProgress.state).toBe("AWAITING_NEXT_CYCLE");
    await monitorOperations(prisma, f.operations, now, f.channel.id.slice(0, -1));
    const notification = await prisma.notification.findFirstOrThrow({ where: { channelId: f.channel.id, eventKey: "business.COLLECTION_STALLED" } });
    expect(notification.payload).toMatchObject({ _resolution: { state: "RESOLVED" } });
    const mock = new MockNotificationAdapter(); await deliverNotification(prisma, notification.id, mock, now); expect(mock.delivered.size).toBe(0);
  });
  it("detects a stalled publication while processes remain live and reports unconfigured dependencies", async () => {
    const f = await fixture(); const now = new Date();
    const account = await prisma.platformAccount.create({ data: { workspaceId: f.workspace.id, channelId: f.channel.id, platform: "YOUTUBE", status: "EXPIRED", externalAccountId: f.key } });
    const content = await prisma.contentItem.create({ data: { channelId: f.channel.id, title: "Missed", topicKey: f.key } });
    await prisma.publishPlan.create({ data: { contentItemId: content.id, platformAccountId: account.id, platform: "YOUTUBE", title: "Missed", scheduledAt: new Date(now.getTime() - 3600000), status: "HELD", idempotencyKey: f.key } });
    const health = await channelBusinessHealth(prisma, f.workspace.id, f.channel.id, now);
    expect(health).toMatchObject({ state: "ATTENTION_REQUIRED", missedPublications: 1, externalNotifications: "NOT_CONFIGURED", backup: { state: "NOT_CONFIGURED" } });
    expect(health.issues).toEqual(expect.arrayContaining(["MISSED_PUBLICATION", "ACCOUNT_REAUTH_REQUIRED", "CHANNEL_NOT_CONFIGURED"]));
    await expect(channelBusinessHealth(prisma, "foreign", f.channel.id)).rejects.toThrow("CHANNEL_NOT_FOUND");
    await monitorOperations(prisma, f.operations, now, f.channel.id.slice(0, -1));
    await monitorOperations(prisma, f.operations, now, f.channel.id.slice(0, -1));
    expect(await prisma.notification.count({ where: { workspaceId: f.workspace.id, eventKey: "business.MISSED_PUBLICATION" } })).toBe(1);
  });
  it("claims one mock delivery, retries failures and respects acknowledgment", async () => {
    const f = await fixture(); const now = new Date();
    await f.operations.notify(f.workspace.id, { channelId: f.channel.id, eventKey: "fixture", severity: "WARNING", payload: {} });
    const row = await prisma.notification.findFirstOrThrow({ where: { workspaceId: f.workspace.id } });
    const adapter = new MockNotificationAdapter();
    await Promise.all([deliverNotification(prisma, row.id, adapter, now), deliverNotification(prisma, row.id, adapter, now)]);
    expect(adapter.delivered.size).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).payload).toMatchObject({ _delivery: { state: "MOCK_DELIVERED", mode: "MOCK" } });
    await prisma.notification.update({ where: { id: row.id }, data: { payload: {} } });
    let calls = 0; const flaky = { mode: "MOCK" as const, send: () => { calls++; return calls === 1 ? Promise.reject(new Error("fixture")) : Promise.resolve(); } };
    await deliverNotification(prisma, row.id, flaky, now); await deliverNotification(prisma, row.id, flaky, now);
    expect(calls).toBe(1);
    await deliverNotification(prisma, row.id, flaky, new Date(now.getTime() + 300001)); expect(calls).toBe(2);
    await f.operations.acknowledge(f.workspace.id, f.user.id, row.id);
    await deliverNotification(prisma, row.id, flaky, new Date(now.getTime() + 600001)); expect(calls).toBe(2);
  });
  it("requeues failed maintenance using the original durable request", async () => {
    const f = await fixture(); let enqueued = 0;
    const operations = new OperationsService(prisma, {} as OAuthCryptoService, { enqueue: () => { enqueued++; return Promise.resolve(); }, close: () => Promise.resolve() });
    const input = { type: "RETENTION", retentionBefore: "2020-01-01T00:00:00.000Z", idempotencyKey: f.key };
    const first = await operations.createLifecycleRequest(f.workspace.id, f.user.id, "OWNER", input);
    await prisma.dataLifecycleRequest.update({ where: { id: first.id }, data: { status: "FAILED", errorCode: "DATA_LIFECYCLE_FAILED" } });
    const resumed = await operations.createLifecycleRequest(f.workspace.id, f.user.id, "OWNER", input);
    expect(resumed).toMatchObject({ id: first.id, status: "QUEUED", duplicate: true });
    expect(enqueued).toBe(2);
    expect(await prisma.dataLifecycleRequest.count({ where: { workspaceId: f.workspace.id } })).toBe(1);
  });
});
