import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { CollectProcessor } from "./collect-processor.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("stored topic reevaluation", () => {
  const prisma = new PrismaClient(); afterAll(() => prisma.$disconnect());
  it("uses current scores and filters, releases cancelled reservations and rejects a recent event duplicate", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@selection.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const oldRun = await prisma.automationRun.create({ data: { channelId: channel.id, status: "CANCELLED", idempotencyKey: `${key}:old` } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key } });
    await prisma.collectionRule.create({ data: { channelId: channel.id, keywords: ["rocket"], recencyHours: 72, collectionFrequencyMinutes: 60 } });
    const make = (title: string, summary: string, age: number, score: number, rawSnapshot = {}) => prisma.contentIdea.create({ data: { channelId: channel.id, title, summary, publishedAt: new Date(Date.now() - age), canonicalUrl: `https://example.org/${randomUUID()}`, urlHash: randomUUID(), contentHash: randomUUID(), sourceName: "Fixture", sourceKind: "OFFICIAL", provider: "fixture", suitabilityScore: 1, freshnessScore: 1, reliabilityScore: 1, expectedValueScore: score, rawSnapshot } });
    const stale = await make("rocket obsolete story", "old", 100 * 86_400_000, 1);
    const offTopic = await make("ocean sensor", "fresh but unrelated", 0, 1);
    const outdatedRanking = await make("rocket brief", "basic report", 0, 0.99);
    const best = await make("How reusable rocket booster recovery works", "rocket process compare data", 0, 0.01, { reservationRunId: oldRun.id });
    const activeRun = await prisma.automationRun.create({ data: { channelId: channel.id, status: "RUNNING", idempotencyKey: `${key}:active` } });
    const reserved = await make("How rocket process data compares", "rocket sensor process", 0, 1, { reservationRunId: activeRun.id });
    const duplicate = await make("rocket sensor mission launches data", "rocket sensor mission launches data", 0, 1);
    await prisma.contentItem.create({ data: { channelId: channel.id, title: `${duplicate.title} report`, summary: duplicate.summary, topicKey: key, status: "PUBLISHED" } });
    const result = await new CollectProcessor(prisma, { collect: () => Promise.resolve({ provider: "empty-fixture", idempotencyKey: key, createdAt: new Date().toISOString(), candidates: [] }) }).process({ automation: { runId: run.id, stage: "COLLECT" }, collect: { channelId: channel.id, topic: "science", language: "en", keywords: ["outdated-keyword"], excludedKeywords: [], excludedTopics: [], allowedSources: [], excludedSources: [], recencyHours: 7200, idempotencyKey: key } });
    expect(result.idea).toMatchObject({ id: best.id });
    expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: stale.id } })).rejectionReason).toBe("OUTSIDE_FRESHNESS_POLICY");
    expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: offTopic.id } })).rejectionReason).toBe("KEYWORD_MISMATCH");
    expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: duplicate.id } })).rejectionReason).toBe("RECENT_TOPIC_DUPLICATE");
    expect(Number((await prisma.contentIdea.findUniqueOrThrow({ where: { id: outdatedRanking.id } })).expectedValueScore)).toBeLessThan(Number((await prisma.contentIdea.findUniqueOrThrow({ where: { id: best.id } })).expectedValueScore));
    expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: reserved.id } })).rawSnapshot).toMatchObject({ reservationRunId: activeRun.id });
  });
});
