import { PrismaClient } from "@postbot/database";
import { AssetRepository } from "@postbot/asset-library";
import { FakeStorageProvider } from "@postbot/providers";
import type { SceneDocument } from "@postbot/scene-schema";
import { randomUUID } from "node:crypto";
import { copyFile, writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { RenderProcessor, sceneIdFromImagePurpose, type MediaPostProcessor } from "./render-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();

const scene = (title: string): SceneDocument => ({
  schemaVersion: "1.0.0", title, width: 1080, height: 1920, fps: 30, durationInFrames: 450,
  scenes: [{ id: "only", startFrame: 0, durationInFrames: 450, visualPrompt: "fixture", narration: { text: title, sourceUrl: "https://example.com/render" }, overlays: [{ kind: "title", text: title }] }]
});

const postProcessor: MediaPostProcessor = {
  postprocess: async ({ videoInput, output }) => copyFile(videoInput, output),
  thumbnail: async (_videoInput, output) => writeFile(output, new Uint8Array([1, 2, 3])),
  probe: () => Promise.resolve({ durationSeconds: 15, width: 1080, height: 1920 })
};

enabled("render processor integration", () => {
  afterAll(async () => prisma.$disconnect());
  it("renders the same input once and persists a versioned manifest", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `${suffix}@render.test`, displayName: "Render", passwordHash: "test" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Render", slug: suffix, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Render", slug: suffix } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Render", topicKey: suffix } });
    const version = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 1, schemaVersion: "1.0.0", sceneDocument: scene("15 second fixture") } });
    const storage = new FakeStorageProvider();
    const imageBytes = new Uint8Array([4, 5, 6]);
    const asset = await prisma.asset.create({ data: { channelId: channel.id, kind: "IMAGE", origin: "INTERNAL", storageKey: suffix, checksumSha256: suffix.replaceAll("-", "").padEnd(64, "0"), mimeType: "image/png" } });
    await storage.upload({ key: suffix, body: imageBytes, mimeType: "image/png" });
    await new AssetRepository(prisma, storage).attachUsage({ assetId: asset.id, contentItemId: content.id, sceneVersionId: version.id, purpose: "scene-image:COMMON:only", snapshot: {} });
    let calls = 0;
    const renderer = { render: async ({ outputLocation, sceneAssets }: { outputLocation: string; sceneAssets?: Record<string, string> }) => { calls += 1; expect(sceneAssets).toEqual({ only: `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}` }); await writeFile(outputLocation, new Uint8Array([0, 1, 2, 3])); return { outputLocation, rendererVersion: "1.1.0" }; } };
    const processor = new RenderProcessor(prisma, { storage, renderer, postProcessor });
    const payload = { render: { channelId: channel.id, contentItemId: content.id, sceneVersionId: version.id, idempotencyKey: `render-${suffix}` } };
    const job = await prisma.productionJob.create({ data: { id: `job-${suffix}`, channelId: channel.id, contentItemId: content.id, type: "RENDER", queueName: "render", idempotencyKey: suffix, payload } });
    const first = await processor.process(payload, job.id);
    const second = await processor.process(payload, `job-${suffix}`);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ rendererVersion: "1.1.0", schemaVersion: "1.0.0", qa: { width: 1080, height: 1920 } });
    await expect(storage.download(String(first.videoKey))).resolves.toEqual(new Uint8Array([0, 1, 2, 3]));
    await expect(prisma.sceneVersion.findUniqueOrThrow({ where: { id: version.id } })).resolves.toMatchObject({ renderManifest: first });
  });
});

describe("scene image purpose", () => {
  it("keeps platform and scene versions isolated", () => {
    expect(sceneIdFromImagePurpose("scene-image:YOUTUBE:first", "YOUTUBE")).toBe("first");
    expect(sceneIdFromImagePurpose("scene-image:TIKTOK:first", "YOUTUBE")).toBeNull();
  });
});
