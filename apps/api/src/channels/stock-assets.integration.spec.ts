import "reflect-metadata";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { StockAssetsController, validateStockBytes } from "./stock-assets.controller.js";

const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();
suite("owned stock registration", () => {
  afterAll(() => prisma.$disconnect());
  it("records proof, resumes stock-required work and cannot replace revoked proof through a duplicate upload", async () => {
    process.env.STORAGE_PROVIDER = "fake";
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@stock.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, status: "PAUSED" } });
    const req = { auth: { userId: user.id, workspaceId: workspace.id, workspace: { role: "OWNER" } } } as unknown as AuthenticatedRequest;
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, status: "PAUSED", pausedReason: "STOCK_ASSET_REQUIRED", idempotencyKey: key, steps: { create: { stage: "ASSET", platform: "YOUTUBE", branchKey: "YOUTUBE", status: "HELD", errorCode: "STOCK_ASSET_REQUIRED" } } } });
    const png = { bytes: Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4f8AAAAASUVORK5CYII=", "base64"), Buffer.from(key)]) };
    const input = { bodyBase64: Buffer.from(png.bytes).toString("base64"), mimeType: "image/png", licenseName: "Fixture license", proofUrl: "https://example.com/license", commercialUseAllowed: true, derivativeAllowed: true };
    const controller = new StockAssetsController(prisma);
    await expect(controller.upload({ ...req, auth: { ...req.auth, workspace: { ...req.auth.workspace, role: "MEMBER" } } }, channel.id, input)).rejects.toThrow("OWNER_ROLE_REQUIRED");
    await expect(controller.upload(req, channel.id, { ...input, proofUrl: "http://example.com/license" })).rejects.toThrow("STOCK_IMAGE_AND_LICENSE_REQUIRED");
    const asset = await controller.upload(req, channel.id, input);
    expect(await controller.list(req, channel.id)).toEqual({ assets: [{ id: asset.id }] });
    await expect(controller.metadata({ ...req, auth: { ...req.auth, workspace: { ...req.auth.workspace, role: "MEMBER" } } }, channel.id, asset.id, { description: "Rocket recovery", tags: ["rocket"] })).rejects.toThrow("OWNER_ROLE_REQUIRED");
    await expect(controller.metadata(req, channel.id, "foreign-asset", { description: "Rocket", tags: [] })).rejects.toThrow("STOCK_ASSET_NOT_FOUND");
    await expect(controller.metadata(req, channel.id, asset.id, { description: "Rocket recovery", tags: ["rocket", "booster"] })).resolves.toEqual({ id: asset.id });
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("QUEUED");
    expect((await prisma.automationStep.findFirstOrThrow({ where: { automationRunId: run.id } })).status).toBe("PENDING");
    const proofs = await prisma.assetLicense.count({ where: { assetId: asset.id } });
    expect(await controller.upload(req, channel.id, input)).toEqual(asset);
    expect(await prisma.assetLicense.count({ where: { assetId: asset.id } })).toBe(proofs);
    await prisma.assetLicense.create({ data: { assetId: asset.id, licenseName: "Revoked", status: "REJECTED" } });
    await expect(controller.upload(req, channel.id, input)).rejects.toThrow("ASSET_LICENSE_REVIEW_REQUIRED");
    expect(await controller.list(req, channel.id)).toEqual({ assets: [] });
    const other = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Other", slug: `${key}-other`, status: "PAUSED" } });
    const independent = await controller.upload(req, other.id, input);
    expect(independent.id).not.toBe(asset.id);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: independent.id } })).channelId).toBe(other.id);
    expect((await prisma.assetLicense.findFirstOrThrow({ where: { assetId: asset.id }, orderBy: { createdAt: "desc" } })).status).toBe("REJECTED");
  });
});

describe("stock file validation", () => {
  it("rejects disguised executable and oversized uploads", () => {
    expect(() => validateStockBytes(new TextEncoder().encode("<script>executable</script>"), "image/png")).toThrow("STOCK_IMAGE_FORMAT_INVALID");
    expect(() => validateStockBytes(new Uint8Array(1_048_577), "image/png")).toThrow("STOCK_IMAGE_SIZE_INVALID");
  });
});
