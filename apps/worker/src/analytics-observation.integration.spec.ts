import { PrismaClient } from "@postbot/database";
import type { AnalyticsProvider, AnalyticsPage } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AnalyticsProcessor } from "./analytics-processor.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("analytics availability and observation semantics", () => {
  const prisma = new PrismaClient(); afterAll(() => prisma.$disconnect());
  async function fixture() {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@observation.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key } });
    const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "YOUTUBE", version: 1, hook: "Hook", body: "Body", language: "ko", durationSeconds: 20 } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform: "YOUTUBE", version: 1, schemaVersion: "1.0.0", sceneDocument: {} } });
    const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, sceneVersionId: scene.id, platformAccountId: account.id, platform: "YOUTUBE", status: "PUBLISHED", scheduledAt: new Date(0), idempotencyKey: key, title: "Fixture" } });
    const post = await prisma.platformPost.create({ data: { publishPlanId: plan.id, platformAccountId: account.id, platform: "YOUTUBE", externalPostId: key, postUrl: `https://example.com/${key}`, policyVersion: 1, publishedAt: new Date(0) } });
    const sync = await prisma.analyticsSync.create({ data: { channelId: channel.id, platform: "YOUTUBE", idempotencyKey: key, status: "RUNNING", periodStart: new Date(0), periodEnd: new Date(86_400_000), timezone: "UTC" } });
    const page = (value: number | null, reason: string | null = null): AnalyticsPage => ({ posts: [{ externalPostId: key, observedAt: new Date().toISOString(), observation: { kind: "LIFETIME_SNAPSHOT" }, raw: {}, metrics: [{ metric: "views", value, unit: "count", aggregation: "sum", unavailableReason: reason }] }], nextPageToken: null, dataDelayHours: 24 });
    return { sync, post, script, scene, content, page };
  }
  it("recollects an empty page with backoff, then uses the published branch rather than later edits", async () => {
    const f = await fixture();
    await prisma.scriptVersion.create({ data: { contentItemId: f.content.id, platform: "INSTAGRAM", version: 2, hook: "Later", body: "Edited", language: "ko", durationSeconds: 60 } });
    const fetchPage = vi.fn<AnalyticsProvider["fetchPage"]>().mockResolvedValueOnce({ posts: [], nextPageToken: null, dataDelayHours: 24 }).mockResolvedValue(f.page(12));
    const processor = new AnalyticsProcessor(prisma, { fetchPage });
    expect(await processor.process({ analytics: { syncId: f.sync.id } })).toMatchObject({ collectionStatus: "WAITING" });
    expect(await processor.process({ analytics: { syncId: f.sync.id } })).toMatchObject({ deferred: true });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await prisma.analyticsSync.update({ where: { id: f.sync.id }, data: { nextAttemptAt: null } });
    await processor.process({ analytics: { syncId: f.sync.id } });
    const metric = await prisma.analyticsMetricSnapshot.findFirstOrThrow({ where: { analyticsSyncId: f.sync.id } });
    expect(metric).toMatchObject({ observationKind: "LIFETIME_SNAPSHOT", periodStart: null, periodEnd: null, scriptVersionId: f.script.id, sceneVersionId: f.scene.id });
    expect((await prisma.analyticsSync.findUniqueOrThrow({ where: { id: f.sync.id } })).status).toBe("SUCCEEDED");
  });
  it("distinguishes permanent absence from provisional missing metrics and retains revisions", async () => {
    const f = await fixture();
    const fetchPage = vi.fn<AnalyticsProvider["fetchPage"]>().mockResolvedValueOnce(f.page(null, "NOT_RETURNED_BY_YOUTUBE")).mockResolvedValue(f.page(25));
    const processor = new AnalyticsProcessor(prisma, { fetchPage });
    await processor.process({ analytics: { syncId: f.sync.id } });
    expect((await prisma.analyticsSync.findUniqueOrThrow({ where: { id: f.sync.id } })).status).toBe("WAITING");
    await prisma.analyticsSync.update({ where: { id: f.sync.id }, data: { nextAttemptAt: null } });
    await processor.process({ analytics: { syncId: f.sync.id } });
    expect(await prisma.analyticsMetricSnapshot.findMany({ where: { analyticsSyncId: f.sync.id }, orderBy: { revision: "asc" } })).toMatchObject([{ revision: 1, status: "UNAVAILABLE" }, { revision: 2, status: "AVAILABLE" }]);
    await processor.process({ analytics: { syncId: f.sync.id } });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    const permanent = await fixture();
    await new AnalyticsProcessor(prisma, { fetchPage: () => Promise.resolve(permanent.page(null, "NOT_PROVIDED_BY_PLATFORM")) }).process({ analytics: { syncId: permanent.sync.id } });
    expect((await prisma.analyticsSync.findUniqueOrThrow({ where: { id: permanent.sync.id } })).status).toBe("UNAVAILABLE");
  });
  it("expires aggregation waiting without touching a published plan", async () => {
    const f = await fixture();
    await prisma.analyticsSync.update({ where: { id: f.sync.id }, data: { collectionAttempts: 5 } });
    const result = await new AnalyticsProcessor(prisma, { fetchPage: () => Promise.resolve({ posts: [], nextPageToken: null, dataDelayHours: 48 }) }).process({ analytics: { syncId: f.sync.id } });
    expect(result).toMatchObject({ collectionStatus: "EXPIRED" });
    expect((await prisma.publishPlan.findUniqueOrThrow({ where: { id: f.post.publishPlanId } })).status).toBe("PUBLISHED");
  });
  it("allows only one concurrent collector for a sync", async () => {
    const f = await fixture();
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const fetchPage = vi.fn<AnalyticsProvider["fetchPage"]>(async () => { started(); await gate; return f.page(7); });
    const processor = new AnalyticsProcessor(prisma, { fetchPage });
    const first = processor.process({ analytics: { syncId: f.sync.id } });
    await entered;
    try { expect(await processor.process({ analytics: { syncId: f.sync.id } })).toMatchObject({ duplicate: true }); }
    finally { release(); }
    await first;
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
