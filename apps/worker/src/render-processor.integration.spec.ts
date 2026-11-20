import { Prisma, PrismaClient, jobExecution } from "@postbot/database";
import { AssetRepository } from "@postbot/asset-library";
import { FakeStorageProvider, FakeTtsProvider } from "@postbot/providers";
import type { SceneDocument } from "@postbot/scene-schema";
import { normalizeNarration } from "@postbot/scene-schema";
import { randomUUID } from "node:crypto";
import { access, copyFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RenderProcessor, sceneIdFromImagePurpose, type MediaPostProcessor } from "./render-processor.js";
import { DeterministicJobProcessor } from "./job-processor.js";

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
  it("renders original numeric captions from normalized speech and holds inconsistent timing evidence", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@speech.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "2026년 NASA", topicKey: key } });
    const document = scene(content.title); document.scenes[0]!.visualMode = "GRAPHIC";
    const version = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 1, schemaVersion: "1.0.0", sceneDocument: document } });
    const normalization = normalizeNarration(content.title, "ko");
    const speech = await new FakeTtsProvider().synthesize({ text: normalization.speech, voice: "fixture", model: "fixture", idempotencyKey: key });
    const storage = new FakeStorageProvider();
    const audio = await prisma.asset.create({ data: { channelId: channel.id, kind: "AUDIO", origin: "INTERNAL", storageKey: key, checksumSha256: key, mimeType: "audio/wav" } });
    await storage.upload({ key, body: speech.bytes, mimeType: "audio/wav" });
    const assets = new AssetRepository(prisma, storage);
    await assets.attachUsage({ assetId: audio.id, contentItemId: content.id, sceneVersionId: version.id, purpose: "tts-narration", snapshot: { normalization, timings: speech.timings } });
    const payload = { render: { channelId: channel.id, contentItemId: content.id, sceneVersionId: version.id, idempotencyKey: key } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "RENDER", queueName: "render", idempotencyKey: key, payload } });
    let displayed = "";
    const processor = new RenderProcessor(prisma, { storage, postProcessor: { ...postProcessor, probe: () => Promise.resolve({ width: 1080, height: 1920, hasAudio: true, durationSeconds: speech.durationSeconds }) }, renderer: { render: async ({ captions, outputLocation }) => {
      displayed = captions.map((caption) => caption.text).join(""); await writeFile(outputLocation, new Uint8Array([1])); return { outputLocation, rendererVersion: "fixture" };
    } } });
    await processor.process(payload, job.id);
    expect(displayed.replace(/\s/g, "")).toBe(content.title.replace(/\s/g, ""));
    expect(normalization.speech).not.toBe(content.title);
    await prisma.sceneVersion.update({ where: { id: version.id }, data: { renderManifest: Prisma.DbNull } });
    await assets.attachUsage({ assetId: audio.id, contentItemId: content.id, sceneVersionId: version.id, purpose: "tts-narration", snapshot: { normalization, timings: [{ text: "incorrect", startSeconds: 0, endSeconds: 1 }] } });
    await expect(processor.process(payload, job.id)).rejects.toMatchObject({ findings: [{ code: "SPEECH_ALIGNMENT_REVIEW_REQUIRED" }] });
  });
  it("cancels the active renderer and awaits its shutdown before deleting temporary files", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@render-cancel.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Cancel", topicKey: key } });
    const document = scene("Cancel"); document.durationInFrames = 270; document.scenes[0]!.durationInFrames = 270; document.scenes[0]!.visualMode = "GRAPHIC";
    const version = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 1, schemaVersion: "1.0.0", sceneDocument: document } });
    const payload = { render: { channelId: channel.id, contentItemId: content.id, sceneVersionId: version.id, idempotencyKey: key } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "RENDER", queueName: "render", status: "RUNNING", idempotencyKey: key, payload } });
    let started = () => {}; let stopped = false; let output = "";
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const renderer = { render: ({ signal, outputLocation }: { signal?: AbortSignal; outputLocation: string }) => new Promise<{ outputLocation: string; rendererVersion: string }>((_resolve, reject) => {
      output = outputLocation; started();
      signal?.addEventListener("abort", () => { setTimeout(() => { void writeFile(outputLocation, "shutdown-complete").then(() => { stopped = true; reject(new Error("stopped")); }, reject); }, 50); }, { once: true });
    }) };
    const running = new RenderProcessor(prisma, { storage: new FakeStorageProvider(), renderer, postProcessor }).process(payload, job.id);
    const outcome = running.catch((error: unknown) => error); await entered;
    await prisma.productionJob.update({ where: { id: job.id }, data: { status: "CANCEL_REQUESTED" } });
    expect(await outcome).toMatchObject({ message: "RENDER_CANCELLED" }); expect(stopped).toBe(true);
    await expect(access(dirname(output))).rejects.toThrow();
    expect((await prisma.sceneVersion.findUniqueOrThrow({ where: { id: version.id } })).renderManifest).toBeNull();
  });
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
    const missing = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 2, schemaVersion: "1.0.0", sceneDocument: scene("Missing scene image") } });
    const missingPayload = { render: { ...payload.render, sceneVersionId: missing.id, idempotencyKey: `${suffix}:missing` } };
    const missingJob = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "RENDER", queueName: "render", idempotencyKey: `${suffix}:missing`, payload: missingPayload } });
    await new DeterministicJobProcessor(prisma).process({ id: missingJob.id, type: "RENDER", queueName: "render", runAfter: null, payload: missingPayload });
    expect(await prisma.productionJob.findUniqueOrThrow({ where: { id: missingJob.id } })).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "RENDER_TECHNICAL_REVIEW_REQUIRED", result: { findings: [{ code: "SCENE_ASSET_MISSING" }] } });
    expect((await prisma.sceneVersion.findUniqueOrThrow({ where: { id: missing.id } })).renderManifest).toBeNull();
    const spokenText = "Experimental voice.";
    const speech = await new FakeTtsProvider().synthesize({ text: spokenText, voice: "fixture", model: "fixture", idempotencyKey: suffix });
    const experimentScript = await prisma.scriptVersion.create({ data: { contentItemId: content.id, version: 1, hook: spokenText, body: spokenText, qualitySnapshot: { generationContext: { strategy: { durationSeconds: 33 }, experiment: { assignmentKey: suffix, targetDurationSeconds: 33, toleranceSeconds: 1 } } } } });
    const experimentDocument = scene(spokenText); experimentDocument.durationInFrames = 990; experimentDocument.scenes[0]!.durationInFrames = 990;
    const experimentScene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: experimentScript.id, version: 3, schemaVersion: "1.0.0", sceneDocument: experimentDocument } });
    const voice = await prisma.asset.create({ data: { channelId: channel.id, kind: "AUDIO", origin: "INTERNAL", storageKey: `${suffix}:voice`, checksumSha256: randomUUID(), mimeType: "audio/wav" } });
    await storage.upload({ key: voice.storageKey, body: speech.bytes, mimeType: "audio/wav" });
    await new AssetRepository(prisma, storage).attachUsage({ assetId: voice.id, contentItemId: content.id, sceneVersionId: experimentScene.id, purpose: "tts-narration", snapshot: { timings: speech.timings } });
    const durationProcessor = new RenderProcessor(prisma, { storage, renderer: { render: () => { throw new Error("MISMATCH_MUST_BE_HELD_BEFORE_RENDERING"); } }, postProcessor: { ...postProcessor, probe: () => Promise.resolve({ width: 0, height: 0, hasAudio: true, durationSeconds: speech.durationSeconds }) } });
    await expect(durationProcessor.process({ render: { ...payload.render, sceneVersionId: experimentScene.id, idempotencyKey: `${suffix}:experiment` } }, job.id)).rejects.toMatchObject({ findings: [{ code: "EXPERIMENT_FINAL_DURATION_MISMATCH" }] });
  });
  it("fences a late renderer's manifest and uses separate artifact keys for each owner", async () => {
    const key = randomUUID(); const firstToken = randomUUID(); const secondToken = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@render-owner.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key } });
    const version = await prisma.sceneVersion.create({ data: { contentItemId: content.id, version: 1, schemaVersion: "1.0.0", sceneDocument: scene("Owner fixture") } });
    const storage = new FakeStorageProvider();
    const asset = await prisma.asset.create({ data: { channelId: channel.id, kind: "IMAGE", origin: "INTERNAL", storageKey: key, checksumSha256: key, mimeType: "image/png" } });
    await storage.upload({ key, body: new Uint8Array([0]), mimeType: "image/png" });
    await new AssetRepository(prisma, storage).attachUsage({ assetId: asset.id, contentItemId: content.id, sceneVersionId: version.id, purpose: "scene-image:COMMON:only", snapshot: {} });
    const payload = { render: { channelId: channel.id, contentItemId: content.id, sceneVersionId: version.id, idempotencyKey: key } };
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "RENDER", queueName: "render", idempotencyKey: key, payload, status: "RUNNING", executionToken: firstToken } });
    let release: () => void = () => undefined; let ready: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { ready = resolve; });
    const oldProcessor = new RenderProcessor(prisma, { storage, postProcessor, renderer: { render: async ({ outputLocation }) => { await writeFile(outputLocation, new Uint8Array([1])); ready(); await gate; return { outputLocation, rendererVersion: "fixture" }; } } });
    const old = jobExecution.run({ jobId: job.id, token: firstToken }, () => oldProcessor.process(payload, job.id));
    await entered;
    await prisma.productionJob.update({ where: { id: job.id }, data: { executionToken: secondToken } });
    const currentProcessor = new RenderProcessor(prisma, { storage, postProcessor, renderer: { render: async ({ outputLocation }) => { await writeFile(outputLocation, new Uint8Array([2])); return { outputLocation, rendererVersion: "fixture" }; } } });
    const current = await jobExecution.run({ jobId: job.id, token: secondToken }, () => currentProcessor.process(payload, job.id));
    release();
    await expect(old).rejects.toThrow("JOB_EXECUTION_SUPERSEDED");
    expect(String(current.videoKey)).toContain(secondToken);
    expect(await storage.download(String(current.videoKey))).toEqual(new Uint8Array([2]));
    expect((await prisma.sceneVersion.findUniqueOrThrow({ where: { id: version.id } })).renderManifest).toEqual(current);
    await expect(jobExecution.run({ jobId: job.id, token: firstToken }, () => new AssetRepository(prisma, storage).attachUsage({ assetId: asset.id, contentItemId: content.id, sceneVersionId: version.id, purpose: "late-owner", snapshot: {} }))).rejects.toThrow("JOB_EXECUTION_SUPERSEDED");
  });
});

describe("scene image purpose", () => {
  it("keeps platform and scene versions isolated", () => {
    expect(sceneIdFromImagePurpose("scene-image:YOUTUBE:first", "YOUTUBE")).toBe("first");
    expect(sceneIdFromImagePurpose("scene-image:TIKTOK:first", "YOUTUBE")).toBeNull();
  });
});
