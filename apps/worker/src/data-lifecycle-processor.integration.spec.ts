import { PrismaClient } from "@postbot/database";
import { FakeStorageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DataLifecycleProcessor } from "./data-lifecycle-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();

const seedWorkspace = async (label: string) => {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `${suffix}@lifecycle.test`, displayName: label, passwordHash: "test" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: label, slug: suffix, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: label, slug: suffix } });
  const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: label, topicKey: suffix } });
  return { user, workspace, channel, content, suffix };
};

enabled("data lifecycle processor", () => {
  afterAll(async () => prisma.$disconnect());

  it("removes expired render and unreferenced asset objects during retention", async () => {
    const seeded = await seedWorkspace("Retention");
    await prisma.contentItem.update({ where: { id: seeded.content.id }, data: { status: "FAILED" } });
    const storage = new FakeStorageProvider();
    const old = new Date("2020-01-01T00:00:00.000Z");
    await storage.upload({ key: `assets/${seeded.suffix}`, body: new Uint8Array([1]), mimeType: "image/png" });
    await storage.upload({ key: `renders/${seeded.suffix}.mp4`, body: new Uint8Array([2]), mimeType: "video/mp4" });
    await prisma.asset.create({ data: { channelId: seeded.channel.id, kind: "IMAGE", origin: "INTERNAL", storageKey: `assets/${seeded.suffix}`, checksumSha256: seeded.suffix.replace(/-/gu, "").padEnd(64, "0").slice(0, 64), mimeType: "image/png", createdAt: old } });
    const script = await prisma.scriptVersion.create({ data: { contentItemId: seeded.content.id, version: 1, hook: "Hook", body: "Body", createdAt: old } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: seeded.content.id, scriptVersionId: script.id, version: 1, schemaVersion: "1", sceneDocument: {}, renderManifest: { videoKey: `renders/${seeded.suffix}.mp4` }, createdAt: old } });
    const request = await prisma.dataLifecycleRequest.create({ data: { workspaceId: seeded.workspace.id, requestedByUserId: seeded.user.id, type: "RETENTION", retentionBefore: new Date("2021-01-01T00:00:00.000Z"), idempotencyKey: `retention:${seeded.suffix}` } });
    await new DataLifecycleProcessor(prisma, storage).process(request.id);
    expect(() => storage.download(`assets/${seeded.suffix}`)).toThrow("STORAGE_OBJECT_NOT_FOUND");
    expect(() => storage.download(`renders/${seeded.suffix}.mp4`)).toThrow("STORAGE_OBJECT_NOT_FOUND");
    await expect(prisma.sceneVersion.findUniqueOrThrow({ where: { id: scene.id } })).resolves.toMatchObject({ renderManifest: null });
    await expect(prisma.dataLifecycleRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({ status: "SUCCEEDED" });
  });

  it("deletes a workspace graph and its object storage while preserving the request result", async () => {
    const seeded = await seedWorkspace("Workspace delete");
    const storage = new FakeStorageProvider();
    const key = `assets/${seeded.suffix}`;
    await storage.upload({ key, body: new Uint8Array([1, 2]), mimeType: "image/png" });
    await prisma.asset.create({ data: { channelId: seeded.channel.id, kind: "IMAGE", origin: "INTERNAL", storageKey: key, checksumSha256: seeded.suffix.replace(/-/gu, "").padEnd(64, "1").slice(0, 64), mimeType: "image/png" } });
    const request = await prisma.dataLifecycleRequest.create({ data: { workspaceId: seeded.workspace.id, requestedByUserId: seeded.user.id, type: "WORKSPACE_DELETE", idempotencyKey: `delete:${seeded.suffix}` } });
    await new DataLifecycleProcessor(prisma, storage).process(request.id);
    await expect(prisma.workspace.findUnique({ where: { id: seeded.workspace.id } })).resolves.toBeNull();
    expect(() => storage.download(key)).toThrow("STORAGE_OBJECT_NOT_FOUND");
    await expect(prisma.dataLifecycleRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({ status: "SUCCEEDED" });
  });
  it("preserves future reservations and candidate ownership metadata", async () => {
    const f = await seedWorkspace("Protected"); const storage = new FakeStorageProvider();
    const key = `renders/${f.suffix}.mp4`; await storage.upload({ key, body: new Uint8Array([9]), mimeType: "video/mp4" });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: f.content.id, version: 1, schemaVersion: "1", sceneDocument: {}, renderManifest: { videoKey: key }, createdAt: new Date(0) } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: f.workspace.id, channelId: f.channel.id, platform: "YOUTUBE", externalAccountId: f.suffix } });
    await prisma.contentItem.update({ where: { id: f.content.id }, data: { status: "SCHEDULED" } });
    await prisma.publishPlan.create({ data: { contentItemId: f.content.id, platformAccountId: account.id, platform: "YOUTUBE", sceneVersionId: scene.id, title: "Future", scheduledAt: new Date(Date.now() + 86400000), status: "SCHEDULED", idempotencyKey: f.suffix } });
    const idea = await prisma.contentIdea.create({ data: { channelId: f.channel.id, title: "Reserved", canonicalUrl: `https://example.com/${f.suffix}`, urlHash: f.suffix, contentHash: f.suffix, sourceName: "Fixture", sourceKind: "OFFICIAL", provider: "fixture", suitabilityScore: 1, freshnessScore: 1, reliabilityScore: 1, expectedValueScore: 1, status: "SHORTLISTED", collectedAt: new Date(0), rawSnapshot: { reservationRunId: "durable-owner", articleBody: "preserved" } } });
    const request = await prisma.dataLifecycleRequest.create({ data: { workspaceId: f.workspace.id, type: "RETENTION", retentionBefore: new Date(), idempotencyKey: `retention:${f.suffix}` } });
    await new DataLifecycleProcessor(prisma, storage).process(request.id);
    expect(await storage.download(key)).toEqual(new Uint8Array([9]));
    expect((await prisma.sceneVersion.findUniqueOrThrow({ where: { id: scene.id } })).retentionState).toBe("ACTIVE");
    expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: idea.id } })).rawSnapshot).toMatchObject({ reservationRunId: "durable-owner", articleBody: "preserved" });
  });
  it("resumes a file deletion failure without advertising a ready result", async () => {
    const f = await seedWorkspace("Resume"); await prisma.contentItem.update({ where: { id: f.content.id }, data: { status: "FAILED" } });
    const storage = new FakeStorageProvider(); const key = `renders/${f.suffix}.mp4`;
    await storage.upload({ key, body: new Uint8Array([9]), mimeType: "video/mp4" });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: f.content.id, version: 1, schemaVersion: "1", sceneDocument: {}, renderManifest: { videoKey: key }, createdAt: new Date(0) } });
    const request = await prisma.dataLifecycleRequest.create({ data: { workspaceId: f.workspace.id, type: "RETENTION", retentionBefore: new Date(), idempotencyKey: f.suffix } });
    let fail = true; const original = storage.delete.bind(storage);
    storage.delete = async (objectKey) => { if (fail) { fail = false; throw new Error("fixture interruption"); } await original(objectKey); };
    const processor = new DataLifecycleProcessor(prisma, storage);
    await expect(processor.process(request.id)).rejects.toThrow("fixture interruption");
    expect(await prisma.sceneVersion.findUniqueOrThrow({ where: { id: scene.id } })).toMatchObject({ retentionState: "MARKED", renderManifest: null });
    expect((await prisma.storageDeletion.findUniqueOrThrow({ where: { kind_resourceId: { kind: "RENDER", resourceId: scene.id } } })).state).toBe("DELETING");
    await processor.process(request.id);
    expect((await prisma.storageDeletion.findUniqueOrThrow({ where: { kind_resourceId: { kind: "RENDER", resourceId: scene.id } } })).state).toBe("DONE");
    expect(() => storage.download(key)).toThrow("STORAGE_OBJECT_NOT_FOUND");
  });
  it("waits for active work before workspace deletion and resumes the same request", async () => {
    const f = await seedWorkspace("Active deletion"); const storage = new FakeStorageProvider();
    const key = `assets/${f.suffix}`; await storage.upload({ key, body: new Uint8Array([9]), mimeType: "image/png" });
    await prisma.asset.create({ data: { channelId: f.channel.id, kind: "IMAGE", origin: "INTERNAL", storageKey: key, checksumSha256: "a".repeat(64), mimeType: "image/png" } });
    const job = await prisma.productionJob.create({ data: { channelId: f.channel.id, contentItemId: f.content.id, type: "RENDER", queueName: "render", idempotencyKey: f.suffix, status: "RUNNING", payload: {} } });
    const request = await prisma.dataLifecycleRequest.create({ data: { workspaceId: f.workspace.id, type: "WORKSPACE_DELETE", idempotencyKey: f.suffix } });
    const processor = new DataLifecycleProcessor(prisma, storage);
    await expect(processor.process(request.id)).rejects.toThrow("ACTIVE_WORK_DELETION_WAIT_REQUIRED");
    expect((await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CANCEL_REQUESTED");
    expect(await storage.download(key)).toEqual(new Uint8Array([9]));
    await prisma.productionJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    await processor.process(request.id);
    expect(await prisma.workspace.findUnique({ where: { id: f.workspace.id } })).toBeNull();
  });
});
