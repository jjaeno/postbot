import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PolicyProcessor } from "./policy-processor.js";

const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("current scene rights evidence", () => {
  afterAll(() => prisma.$disconnect());
  it("does not use rejected assets from an older scene as the current policy evidence", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@policy.test`, displayName: "Policy fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Policy fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Policy fixture", slug: key, automationMode: "FULL_AUTO" } });
    const url = `https://example.com/${key}`;
    const item = await prisma.contentItem.create({ data: { channelId: channel.id, title: key, topicKey: key, sourceReferences: { create: { kind: "OFFICIAL", title: "Source", url, urlHash: key, sourceName: "Fixture", reliabilityScore: 1, normalizedSnapshot: { facts: [{ claim: "Fact", sourceUrl: url }] } } }, scriptVersions: { create: { platform: "YOUTUBE", version: 2, hook: "Hook", body: key, language: "en", durationSeconds: 30, qualitySnapshot: { metadata: { description: "AI generated" } } } } } });
    const oldScene = await prisma.sceneVersion.create({ data: { contentItemId: item.id, platform: "YOUTUBE", version: 1, schemaVersion: "1.0.0", sceneDocument: {} } });
    const currentScene = await prisma.sceneVersion.create({ data: { contentItemId: item.id, platform: "YOUTUBE", version: 2, schemaVersion: "1.0.0", sceneDocument: {} } });
    for (const [index, scene] of [oldScene, currentScene].entries()) {
      await prisma.asset.create({ data: { channelId: channel.id, kind: "IMAGE", origin: "AI_GENERATED", storageKey: `${key}/${index}`, checksumSha256: randomUUID().replaceAll("-", "").padEnd(64, "0"), mimeType: "image/png", licenses: { create: { status: index === 0 ? "REJECTED" : "VERIFIED", licenseName: "Fixture", commercialUseAllowed: index === 1, derivativeAllowed: index === 1, checkedAt: new Date() } }, usages: { create: { contentItemId: item.id, sceneVersionId: scene.id, purpose: `scene-image:YOUTUBE:${index}` } } } });
    }
    await prisma.policyRule.create({ data: { platform: "YOUTUBE", region: key.slice(0, 32), version: 1, effectiveAt: new Date(0), checkedAt: new Date(), durationRule: { minSeconds: 30, maxSeconds: 60 }, originalityRule: {}, aiDisclosureRule: {}, rightsRule: { requireVerifiedAssets: true, commercialUseRequired: true }, restrictedTopics: [] } });
    const result = await new PolicyProcessor(prisma).process({ automation: { runId: key, stage: "POLICY", platform: "YOUTUBE" }, policy: { contentItemId: item.id, platform: "YOUTUBE", region: key.slice(0, 32) } });
    expect(result.status).toBe("pass");
  });
});
