import "reflect-metadata";
import { PrismaClient } from "@postbot/database";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { MaintenanceQueueAdapter } from "@postbot/jobs";
import type { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
import { OperationsService } from "./operations.service.js";
const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("scoped provider cost reports", () => {
  afterAll(() => prisma.$disconnect());
  it("filters both provider usage and ledger by channel/content/provider without leaking another workspace", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@cost.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key } });
    for (const [provider, amount] of [["fixture-a", 2], ["fixture-b", 7]] as const) {
      const usage = await prisma.providerUsage.create({ data: { contentItemId: content.id, provider, model: "fixture", operation: "fixture", quantity: 1, unit: "request", actualCost: amount, idempotencyKey: `${key}:${provider}` } });
      await prisma.costLedger.create({ data: { contentItemId: content.id, providerUsageId: usage.id, category: "fixture", direction: "ACTUAL", amount, currency: "USD" } });
    }
    const service = new OperationsService(prisma, {} as OAuthCryptoService, {} as MaintenanceQueueAdapter);
    const query = { periodStart: new Date(Date.now() - 60000).toISOString(), periodEnd: new Date(Date.now() + 60000).toISOString(), channelId: channel.id, contentItemId: content.id, provider: "fixture-a" };
    expect(await service.costReport(workspace.id, query)).toMatchObject({ actual: 2, discrepancy: 0, reconciled: true, byProvider: [{ provider: "fixture-a", actual: 2 }] });
    expect(await service.costReport("foreign-workspace", query)).toMatchObject({ actual: 0, byProvider: [] });
    expect(await service.costReport(workspace.id, { ...query, contentItemId: "foreign-content" })).toMatchObject({ actual: 0, byProvider: [] });
  });
});
