import { PrismaClient } from "@postbot/database";
import { FakeStorageProvider } from "@postbot/providers";
import { afterAll, describe, expect, it } from "vitest";
import { AssetRepository } from "./index.js";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();
run("asset repository", () => {
  afterAll(async () => prisma.$disconnect());
  it("writes one TTS cost record for an idempotency key", async () => {
    const suffix = crypto.randomUUID(); const user = await prisma.user.create({ data: { email: `${suffix}@x.test`, displayName: "x", passwordHash: "x" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "x", slug: suffix, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "x", slug: suffix } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "x", topicKey: suffix } }); const assets = new AssetRepository(prisma, new FakeStorageProvider());
    await assets.recordTtsCost({ contentItemId: content.id, model: "fake", totalCharacters: 5, estimatedCostUsd: "0", idempotencyKey: `tts-${suffix}` });
    await assets.recordTtsCost({ contentItemId: content.id, model: "fake", totalCharacters: 5, estimatedCostUsd: "0", idempotencyKey: `tts-${suffix}` });
    await expect(prisma.providerUsage.count({ where: { contentItemId: content.id } })).resolves.toBe(1); await expect(prisma.costLedger.count({ where: { contentItemId: content.id } })).resolves.toBe(1);
  });
});
