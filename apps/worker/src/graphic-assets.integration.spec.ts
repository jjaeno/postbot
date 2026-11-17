import { PrismaClient } from "@postbot/database";
import { GoogleImageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AssetPreparationProcessor } from "./asset-preparation-processor.js";
const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("graphic scenes bypass image providers", () => {
  afterAll(() => prisma.$disconnect()); afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it("uses no paid image call or stock reservation for GRAPHIC scenes", async () => {
    vi.stubEnv("IMAGE_PROVIDER", "google"); vi.stubEnv("TTS_PROVIDER", "fake"); vi.stubEnv("STORAGE_PROVIDER", "fake");
    const call = vi.spyOn(GoogleImageProvider.prototype, "generate").mockRejectedValue(new Error("MUST_NOT_CALL"));
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@graphic.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Graphic", topicKey: key } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 1, schemaVersion: "1.0.0", sceneDocument: { schemaVersion: "1.0.0", title: "Graphic", width: 1080, height: 1920, fps: 30, durationInFrames: 900, aiStockRatio: 0,
      scenes: [{ id: "graphic", visualMode: "GRAPHIC", role: "METRIC", startFrame: 0, durationInFrames: 900, visualPrompt: "Graphic typography", narration: { text: "One fact", sourceUrl: "https://example.com" }, overlays: [{ kind: "fact", text: "One" }] }] } } });
    const result = await new AssetPreparationProcessor(prisma).processAsset({ assetPreparation: { channelId: channel.id, contentItemId: content.id, sceneVersionId: scene.id, prompt: "Graphic", idempotencyKey: key } }, "unused-job");
    expect(result).toMatchObject({ assets: [], needsReview: false }); expect(call).not.toHaveBeenCalled();
    expect(await prisma.providerUsage.count({ where: { contentItemId: content.id } })).toBe(0);
  });
});
