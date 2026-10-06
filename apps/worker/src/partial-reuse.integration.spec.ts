import { PrismaClient } from "@postbot/database";
import { sceneAssetUsageKey, readAssetUsagePurpose } from "@postbot/asset-library";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ScriptGenerationProcessor } from "./script-generation-processor.js";
const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("voice/subtitle regeneration reuses immutable evidence", () => {
  afterAll(() => prisma.$disconnect());
  it("clones only the selected platform without calling LLM and keeps prior usages", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@partial.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, status: "PAUSED", templates: { create: { name: "Fixture", version: 1, subtitleStyle: { fontSize: 48 }, visualStyle: {} } } } });
    const idea = await prisma.contentIdea.create({ data: { channelId: channel.id, title: "Fixture", canonicalUrl: "https://example.com/science", urlHash: key, contentHash: key, sourceName: "Fixture", sourceKind: "OFFICIAL", provider: "fixture", suitabilityScore: 0.8, freshnessScore: 0.8, reliabilityScore: 0.9, expectedValueScore: 0.8 } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: `idea:${idea.id}` } });
    const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "YOUTUBE", version: 1, hook: "Hook", body: "Body", callToAction: "CTA", durationSeconds: 30, qualitySnapshot: { metadata: { description: "AI generated", hashtags: [] }, reviewStatus: "APPROVED" } } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform: "YOUTUBE", version: 1, schemaVersion: "1.0.0", sceneDocument: { schemaVersion: "1.0.0", title: "Fixture", width: 1080, height: 1920, fps: 30, durationInFrames: 900, scenes: [{ id: "one", startFrame: 0, durationInFrames: 900, visualPrompt: "Fixture", narration: { text: "Hook Body CTA", sourceUrl: "https://example.com/science" }, overlays: [{ kind: "title", text: "Fixture" }] }] } } });
    for (const [index, purpose] of ["scene-image:YOUTUBE:one", "tts-narration:YOUTUBE"].entries()) {
      const asset = await prisma.asset.create({ data: { channelId: channel.id, kind: index === 0 ? "IMAGE" : "AUDIO", origin: "AI_GENERATED", storageKey: `${key}/${index}`, checksumSha256: `${key.replaceAll("-", "")}${index}`.padEnd(64, "0"), mimeType: index === 0 ? "image/png" : "audio/wav" } });
      await prisma.assetUsage.create({ data: { assetId: asset.id, contentItemId: content.id, sceneVersionId: scene.id, purpose: sceneAssetUsageKey(purpose, scene.id), usageSnapshot: { originalPurpose: purpose, timings: [{ text: "Hook Body CTA", startSeconds: 0, endSeconds: 1 }] } } });
    }
    const processor = new ScriptGenerationProcessor(prisma);
    for (const partial of ["subtitle", "voice"] as const) {
      const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "SCRIPT", queueName: "script", idempotencyKey: `${key}:${partial}`, payload: {} } });
      const payload = { generation: { request: { ideaId: idea.id, platform: "YOUTUBE", partial, idempotencyKey: `${key}:${partial}` }, idea: { id: idea.id, channelId: channel.id, title: idea.title, summary: "Fixture", canonicalUrl: idea.canonicalUrl, sourceName: idea.sourceName, sourceKind: idea.sourceKind, publishedAt: null, topic: "science", language: "en" } } };
      const result = await processor.process(job.id, payload);
      expect(await processor.process(job.id, payload)).toEqual(result);
      const usages = await prisma.assetUsage.findMany({ where: { sceneVersionId: result.sceneVersionId } });
      expect(usages.map(readAssetUsagePurpose)).toContain("scene-image:YOUTUBE:one");
      expect(usages.some((usage) => readAssetUsagePurpose(usage) === "tts-narration:YOUTUBE")).toBe(partial === "subtitle");
      expect(await prisma.providerUsage.findFirstOrThrow({ where: { productionJobId: job.id } })).toMatchObject({ provider: "local-reuse" });
      expect(await prisma.assetUsage.count({ where: { sceneVersionId: scene.id } })).toBe(2);
    }
    expect(await prisma.scriptVersion.count({ where: { contentItemId: content.id } })).toBe(3);
  });
});
