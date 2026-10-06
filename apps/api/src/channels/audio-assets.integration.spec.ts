import "reflect-metadata";
import { PrismaClient } from "@postbot/database";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AudioAssetsController } from "./audio-assets.controller.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const wav = (): Buffer => {
  const bytes = Buffer.alloc(48); bytes.write("RIFF"); bytes.writeUInt32LE(40, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(4, 40); bytes.writeUInt32LE(Math.floor(Math.random() * 4294967295), 44); return bytes;
};
suite("licensed audio ownership and revocation", () => {
  afterAll(() => prisma.$disconnect());
  it("rejects non-owners/foreign channels and never revives revoked or expired proof through duplicate upload", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@audio.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const request = { auth: { userId: user.id, workspaceId: workspace.id, workspace: { role: "OWNER" } } } as AuthenticatedRequest;
    const controller = new AudioAssetsController(prisma);
    const input = { name: "Fixture tone", licenseName: "Owner generated QA", proofUrl: "https://example.com/qa-license", bodyBase64: wav().toString("base64"), commercialUseAllowed: true, derivativeAllowed: true };
    await expect(controller.upload({ ...request, auth: { ...request.auth, workspace: { ...request.auth.workspace, role: "MEMBER" } } }, channel.id, input)).rejects.toThrow("OWNER_ROLE_REQUIRED");
    await expect(controller.upload(request, "foreign-channel", input)).rejects.toThrow("CHANNEL_NOT_FOUND");
    const saved = await controller.upload(request, channel.id, input);
    expect((await controller.list(request, channel.id)).assets.map((asset) => asset.id)).toContain(saved.id);
    expect(await controller.upload(request, channel.id, input)).toEqual(saved);
    await prisma.assetLicense.create({ data: { assetId: saved.id, status: "REJECTED", licenseName: "Revoked", commercialUseAllowed: false, derivativeAllowed: false } });
    expect((await controller.list(request, channel.id)).assets).toHaveLength(0);
    await expect(controller.upload(request, channel.id, input)).rejects.toThrow("AUDIO_LICENSE_REVIEW_REQUIRED");
    await prisma.assetLicense.create({ data: { assetId: saved.id, status: "VERIFIED", licenseName: "Expired", commercialUseAllowed: true, derivativeAllowed: true, validUntil: new Date(Date.now() - 1000) } });
    expect((await controller.list(request, channel.id)).assets).toHaveLength(0);
    await expect(controller.upload(request, channel.id, input)).rejects.toThrow("AUDIO_LICENSE_REVIEW_REQUIRED");
    const sibling = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Sibling", slug: `${key}-sibling` } });
    await expect(controller.upload(request, sibling.id, input)).rejects.toThrow("AUDIO_OWNERSHIP_CONFLICT");
  });
});
