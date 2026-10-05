import { PrismaClient } from "@postbot/database";
import { FakeStorageProvider } from "@postbot/providers";
import { afterAll, describe, expect, it } from "vitest";
import { AssetRepository } from "./index.js";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();
run("asset repository", () => {
  afterAll(async () => prisma.$disconnect());
  it("preserves usage lineage on fallback and rejects a subsequently revoked license", async () => {
    const suffix = crypto.randomUUID();
    const user = await prisma.user.create({ data: { email: `${suffix}@asset-lineage.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: suffix } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: suffix } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: suffix } });
    const first = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 1, schemaVersion: "1.0.0", sceneDocument: {} } });
    const second = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 2, schemaVersion: "1.0.0", sceneDocument: {} } });
    const assets = new AssetRepository(prisma, new FakeStorageProvider());
    const stored = await assets.store({ channelId: channel.id, kind: "IMAGE", origin: "INTERNAL", key: suffix, body: new TextEncoder().encode(suffix), mimeType: "image/png", source: { provider: "fixture" }, license: { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: null } });
    const input = { assetId: stored.assetId, contentItemId: content.id, purpose: "scene-image:YOUTUBE:only", snapshot: {} };
    await assets.attachUsage({ ...input, sceneVersionId: first.id });
    await assets.attachUsage({ ...input, sceneVersionId: second.id });
    await assets.attachUsage({ ...input, sceneVersionId: second.id });
    expect((await prisma.assetUsage.findMany({ where: { assetId: stored.assetId } })).map((usage) => usage.sceneVersionId).sort()).toEqual([first.id, second.id].sort());
    expect(await assets.findAllowedFallback("IMAGE", channel.id)).toMatchObject({ assetId: stored.assetId });
    await prisma.assetLicense.create({ data: { assetId: stored.assetId, status: "REJECTED", licenseName: "Revoked", createdAt: new Date(Date.now() + 1000) } });
    expect(await assets.findAllowedFallback("IMAGE", channel.id)).toBeNull();
  });
  it("writes one TTS cost record for an idempotency key", async () => {
    const suffix = crypto.randomUUID(); const user = await prisma.user.create({ data: { email: `${suffix}@x.test`, displayName: "x", passwordHash: "x" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "x", slug: suffix, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "x", slug: suffix } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "x", topicKey: suffix } }); const assets = new AssetRepository(prisma, new FakeStorageProvider());
    await assets.recordProviderCost({ contentItemId: content.id, provider: "fake-tts", model: "fake", operation: "speech-synthesis", quantity: 5, unit: "character", category: "tts", estimatedCostUsd: "0", idempotencyKey: `tts-${suffix}` });
    await assets.recordProviderCost({ contentItemId: content.id, provider: "fake-tts", model: "fake", operation: "speech-synthesis", quantity: 5, unit: "character", category: "tts", estimatedCostUsd: "0", idempotencyKey: `tts-${suffix}` });
    await expect(prisma.providerUsage.count({ where: { contentItemId: content.id } })).resolves.toBe(1); await expect(prisma.costLedger.count({ where: { contentItemId: content.id } })).resolves.toBe(1);
  });
});
