import "reflect-metadata";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ProductionService } from "./production.service.js";

const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("production result version boundary", () => {
  afterAll(() => prisma.$disconnect());
  it("follows the saved scene FK, excludes raw receipts and isolates workspaces and runs", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@production.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Original", topicKey: key } });
    const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "YOUTUBE", version: 1, hook: "Hook", body: "Old body",
      qualitySnapshot: { planning: { title: "Editorial title", summary: "Plan" }, facts: [{ claim: "Claim" }] } } });
    const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform: "YOUTUBE", version: 1, schemaVersion: "1.2", sceneDocument: {} } });
    await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "YOUTUBE", version: 2, hook: "New hook", body: "New body" } });
    await prisma.providerUsage.create({ data: { contentItemId: content.id, provider: "fake", operation: "script", quantity: 10, unit: "tokens", estimatedCost: "0.01", providerResponse: { privateReceipt: "must-not-expose" } } });
    const job = await prisma.productionJob.create({ data: { channelId: channel.id, contentItemId: content.id, type: "SCRIPT", queueName: "script", idempotencyKey: key,
      payload: {}, result: { contentItemId: content.id, scriptVersionId: script.id, sceneVersionId: scene.id } } });
    const run = await prisma.automationRun.create({ data: { channelId: channel.id, idempotencyKey: key, steps: { create: { stage: "SCRIPT", productionJobId: job.id } } } });
    await prisma.productionJob.create({ data: { contentItemId: content.id, type: "ASSET", queueName: "asset", idempotencyKey: `${key}:failed`, status: "NEEDS_REVIEW",
      payload: { assetPreparation: { sceneVersionId: scene.id } }, errorCode: "RIGHTS_REVIEW", errorMessage: "private-provider-message" } });
    const service = new ProductionService(prisma);
    const result = await service.get(workspace.id, content.id);
    expect(result.results[0]?.script?.body).toBe("Old body");
    expect(result.results[0]?.reference.scriptVersionId).toBe(script.id);
    expect(result.results[0]?.planning.title).toBe("Editorial title");
    expect(result.results[0]?.state).toBe("REVIEW_REQUIRED");
    expect(result.results[0]?.reviewReasons[0]?.code).toBe("RIGHTS_REVIEW");
    expect(JSON.stringify(result)).not.toMatch(/must-not-expose|private-provider-message/);
    expect((await service.forRun(workspace.id, run.id)).production[0]?.results[0]?.scene?.id).toBe(scene.id);
    await expect(service.get("foreign", content.id)).rejects.toThrow("PRODUCTION_RESULT_NOT_FOUND");
    await expect(service.get(workspace.id, content.id, "foreign-scene")).rejects.toThrow("PRODUCTION_RESULT_NOT_FOUND");
    await expect(service.forRun("foreign", run.id)).rejects.toThrow("AUTOMATION_RUN_NOT_FOUND");
  });
});
