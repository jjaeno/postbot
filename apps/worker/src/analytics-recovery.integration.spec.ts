import { PrismaClient } from "@postbot/database";
import type { AnalyticsProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AnalyticsProcessor } from "./analytics-processor.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("analytics batch recovery", () => {
  const prisma = new PrismaClient(); afterAll(() => prisma.$disconnect());
  it("keeps completed batches, retries only failed posts and retains distinct query periods", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@analytics.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key } });
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await prisma.publishPlan.createMany({ data: ids.map((id) => ({ id, contentItemId: content.id, platformAccountId: account.id, platform: "YOUTUBE", status: "PUBLISHED", scheduledAt: new Date(), idempotencyKey: id, title: "Fixture" })) });
    await prisma.platformPost.createMany({ data: ids.map((id) => ({ id, publishPlanId: id, platformAccountId: account.id, platform: "YOUTUBE", externalPostId: id, postUrl: `https://example.com/${id}`, policyVersion: 1, publishedAt: new Date() })) });
    const sync = await prisma.analyticsSync.create({ data: { channelId: channel.id, platform: "YOUTUBE", idempotencyKey: key, status: "RUNNING", periodStart: new Date(0), periodEnd: new Date(), timezone: "UTC" } });
    let calls = 0;
    const fetchPage = vi.fn<AnalyticsProvider["fetchPage"]>((input) => {
      calls++;
      if (calls === 2) return Promise.reject(new Error("PROVIDER_RATE_LIMITED"));
      return Promise.resolve({ posts: input.postIds.map((externalPostId) => ({ externalPostId, observedAt: input.periodEnd, raw: { periodStart: input.periodStart }, metrics: [{ metric: "views", value: 100, unit: "count", aggregation: "sum", unavailableReason: null }] })), nextPageToken: null, dataDelayHours: 48 });
    });
    const processor = new AnalyticsProcessor(prisma, { fetchPage });
    await expect(processor.process({ analytics: { syncId: sync.id } })).rejects.toThrow("PARTIAL");
    expect(await prisma.analyticsMetricSnapshot.count({ where: { analyticsSyncId: sync.id } })).toBe(500);
    await prisma.analyticsSync.update({ where: { id: sync.id }, data: { nextAttemptAt: null } });
    await processor.process({ analytics: { syncId: sync.id } });
    expect(fetchPage.mock.calls.map(([input]) => input.postIds.length)).toEqual([500, 1, 1]);
    expect(await prisma.analyticsMetricSnapshot.count({ where: { analyticsSyncId: sync.id } })).toBe(501);
    await processor.process({ analytics: { syncId: sync.id } }); expect(fetchPage).toHaveBeenCalledTimes(3);
    const other = await prisma.analyticsSync.create({ data: { channelId: channel.id, platform: "YOUTUBE", idempotencyKey: `${key}:period`, status: "RUNNING", periodStart: new Date(86400000), periodEnd: sync.periodEnd, timezone: "UTC" } });
    await processor.process({ analytics: { syncId: other.id } });
    expect(await prisma.analyticsMetricSnapshot.count({ where: { analyticsSyncId: other.id } })).toBe(501);
    expect(await prisma.publishPlan.count({ where: { contentItemId: content.id, status: "PUBLISHED" } })).toBe(501);
  }, 30_000);
});
