import { PrismaClient } from "@postbot/database";
import { FakeStorageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PublishProcessor } from "./publish-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();

enabled("publish processor integration", () => {
  afterAll(async () => prisma.$disconnect());
  it("publishes a scheduled fake YouTube plan once and persists its attempt", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `${suffix}@publish.test`, displayName: "Publisher", passwordHash: "test" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Publish", slug: suffix, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Publish", slug: suffix } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: `fake-${suffix}`, status: "CONNECTED" } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Publish", topicKey: suffix, status: "SCHEDULED" } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 1, schemaVersion: "1.0.0", sceneDocument: { schemaVersion: "1.0.0" }, renderManifest: { videoKey: `renders/${suffix}.mp4` } } });
    await prisma.sourceReference.create({ data: { contentItemId: content.id, kind: "OFFICIAL", title: "Official source", url: `https://example.com/${suffix}`, urlHash: suffix, sourceName: "Acceptance", reliabilityScore: 1, isPrimary: true } });
    const asset = await prisma.asset.create({ data: { channelId: channel.id, kind: "IMAGE", origin: "AI_GENERATED", storageKey: `assets/${suffix}.png`, checksumSha256: suffix.replaceAll("-", "").padEnd(64, "0"), mimeType: "image/png", licenses: { create: { status: "VERIFIED", licenseName: "Acceptance fixture", commercialUseAllowed: true, derivativeAllowed: true, checkedAt: new Date() } } } });
    await prisma.assetUsage.create({ data: { assetId: asset.id, contentItemId: content.id, sceneVersionId: scene.id, purpose: "scene-background" } });
    const rule = await prisma.policyRule.create({ data: { platform: "YOUTUBE", region: suffix.slice(0, 32), version: 1, effectiveAt: new Date(0), checkedAt: new Date(), durationRule: {}, originalityRule: {}, aiDisclosureRule: {}, rightsRule: {}, restrictedTopics: [] } });
    await prisma.policyCheck.create({ data: { contentItemId: content.id, policyRuleId: rule.id, platform: "YOUTUBE", status: "PASS", reasons: [] } });
    const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, platform: "YOUTUBE", platformAccountId: account.id, sceneVersionId: scene.id, status: "SCHEDULED", scheduledAt: new Date(Date.now() + 60_000), idempotencyKey: `publish-${suffix}`, title: "Publish" } });
    const storage = new FakeStorageProvider(); await storage.upload({ key: `renders/${suffix}.mp4`, body: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" });
    const processor = new PublishProcessor(prisma, storage);
    const first = await processor.process({ publish: { publishPlanId: plan.id } }); const second = await processor.process({ publish: { publishPlanId: plan.id } });
    expect(second).toMatchObject({ duplicate: true }); expect(first).toHaveProperty("externalVideoId");
    const saved = await prisma.publishPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { attempts: true, platformPost: true } });
    expect(saved.status).toBe("PUBLISHED"); expect(saved.attempts[0]?.status).toBe("SUCCEEDED"); expect(saved.platformPost?.externalPostId).toBeTruthy();
  });
});
