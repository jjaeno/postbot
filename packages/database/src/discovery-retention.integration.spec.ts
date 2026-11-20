import { PrismaClient } from "@prisma/client";
import { pruneDiscoveryChannel } from "./discovery-retention.js";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
const prisma = new PrismaClient();
describe.skipIf(process.env.RUN_DB_INTEGRATION !== "1")("bounded discovery retention", () => {
 afterAll(() => prisma.$disconnect());
 it("advances past protected candidates, preserves current quota receipts and clears expired bodies", async () => {
  const key = randomUUID(); const now = new Date(); const old = new Date(now.getTime() - 20 * 86400000);
  const user = await prisma.user.create({ data: { email: `${key}@discovery-retention.test`, displayName: "Fixture", passwordHash: "fixture" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
  const data = Array.from({ length: 101 }, (_, index) => ({ id: `${key}-${String(index).padStart(3,"0")}`, channelId: channel.id, title: "Fixture", canonicalUrl: `https://example.com/${key}/${index}`, urlHash: `${key}:${index}`, contentHash: `${key}:${index}`, sourceName: "Fixture", sourceKind: "OFFICIAL" as const, provider: "fixture", suitabilityScore: 1, freshnessScore: 1, reliabilityScore: 1, expectedValueScore: 1, collectedAt: old, rawSnapshot: index < 100 ? { reservationRunId: "durable-reservation", body: "keep" } : { body: "expired unused body" } }));
  await prisma.contentIdea.createMany({ data });
  const receipt = await prisma.sourceFetch.create({ data: { channelId: channel.id, requestKey: "a".repeat(64), source: "LOC", state: "READY", expiresAt: new Date(now.getTime() - 1000), startedAt: now, response: { body: "expire" } } });
  await prisma.sourceFetch.create({ data: { channelId: channel.id, requestKey: "b".repeat(64), source: "LOC", state: "FAILED", expiresAt: old, startedAt: old } });
  const first = await pruneDiscoveryChannel(prisma, channel.id, 7, now);
  expect(first).toMatchObject({ expiredBodies: 1, expiredReceipts: 1, candidatesRemoved: 0 });
  expect((await prisma.sourceFetch.findUniqueOrThrow({ where: { id: receipt.id } })).response).toBeNull();
  expect((await pruneDiscoveryChannel(prisma, channel.id, 7, now)).candidatesRemoved).toBe(1);
  expect(await prisma.contentIdea.count({ where: { channelId: channel.id } })).toBe(100);
  expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: data[0]?.id } })).rawSnapshot).toMatchObject({ reservationRunId: "durable-reservation", body: "keep" });
 });
});
