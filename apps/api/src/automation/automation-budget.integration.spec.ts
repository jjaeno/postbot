import { Prisma, PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { reserveAutomationCost } from "./automation-budget.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" &&
  new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");

describe.skipIf(!enabled).sequential("automation budget isolation", () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  const workspaceFixture = async (label: string) => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `${label}-${suffix}@budget.test`, displayName: label, passwordHash: "unused" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: label, slug: `${label}-${suffix}` } });
    const channel1 = await prisma.channel.create({ data: { workspaceId: workspace.id, name: `${label} 1`, slug: `${label}-1-${suffix}` } });
    const channel2 = await prisma.channel.create({ data: { workspaceId: workspace.id, name: `${label} 2`, slug: `${label}-2-${suffix}` } });
    return { workspace, channel1, channel2 };
  };

  const spend = async (channelId: string, amount: number, currency = "USD") => {
    const item = await prisma.contentItem.create({ data: { channelId, title: "Budget fixture", topicKey: randomUUID() } });
    return prisma.costLedger.create({ data: { contentItemId: item.id, direction: "ACTUAL", category: "test", amount: new Prisma.Decimal(amount), currency } });
  };

  const run = (channelId: string) => prisma.automationRun.create({ data: { channelId, idempotencyKey: randomUUID() } });
  const reserve = (budget: Awaited<ReturnType<typeof prisma.automationBudget.create>>, runId: string, estimate: number, platform: "YOUTUBE" | "INSTAGRAM" = "YOUTUBE") =>
    reserveAutomationCost({ prisma, budget, runId, stage: "SCRIPT", platform, estimate });

  it("A: excludes another workspace's $500 from a $100 workspace budget", async () => {
    const a = await workspaceFixture("workspace-a");
    const b = await workspaceFixture("workspace-b");
    await spend(a.channel1.id, 10);
    await spend(b.channel1.id, 500);
    const budget = await prisma.automationBudget.create({ data: { workspaceId: a.workspace.id, dailyHardLimit: 100, monthlyHardLimit: 100, currency: "USD" } });
    const automationRun = await run(a.channel1.id);
    await expect(reserve(budget, automationRun.id, 5)).resolves.toBe("RESERVED");
  });

  it("B: holds channel A1 at $19 + $2 and excludes A2's $100", async () => {
    const a = await workspaceFixture("channel-scope");
    await spend(a.channel1.id, 19);
    await spend(a.channel2.id, 100);
    const budget = await prisma.automationBudget.create({ data: { workspaceId: a.workspace.id, channelId: a.channel1.id, dailyHardLimit: 20, monthlyHardLimit: 20, currency: "USD" } });
    const automationRun = await run(a.channel1.id);
    await expect(reserve(budget, automationRun.id, 2)).resolves.toBe("HARD_LIMIT");
  });

  it("C: aggregates both channels for workspace budgets but only one for channel budgets", async () => {
    const a = await workspaceFixture("scope-comparison");
    await spend(a.channel1.id, 4);
    await spend(a.channel2.id, 5);
    const workspaceBudget = await prisma.automationBudget.create({ data: { workspaceId: a.workspace.id, dailyHardLimit: 10, monthlyHardLimit: 10, currency: "USD" } });
    const channelBudget = await prisma.automationBudget.create({ data: { workspaceId: a.workspace.id, channelId: a.channel1.id, dailyHardLimit: 10, monthlyHardLimit: 10, currency: "USD" } });
    const workspaceRun = await run(a.channel1.id);
    const channelRun = await run(a.channel1.id);
    await expect(reserve(workspaceBudget, workspaceRun.id, 2)).resolves.toBe("HARD_LIMIT");
    await expect(reserve(channelBudget, channelRun.id, 2, "INSTAGRAM")).resolves.toBe("RESERVED");
  });

  it("D: serializes concurrent reservations so only one can consume the remaining limit", async () => {
    const a = await workspaceFixture("concurrency");
    const budget = await prisma.automationBudget.create({ data: { workspaceId: a.workspace.id, dailyHardLimit: 1.5, monthlyHardLimit: 1.5, currency: "USD" } });
    const first = await run(a.channel1.id);
    const second = await run(a.channel2.id);
    const results = await Promise.all([reserve(budget, first.id, 1), reserve(budget, second.id, 1)]);
    expect(results.sort()).toEqual(["HARD_LIMIT", "RESERVED"]);
    expect(await prisma.automationCostReservation.count({ where: { automationRunId: { in: [first.id, second.id] } } })).toBe(1);
  });

  it("keeps currencies separate and fails closed for an unattributed ledger entry", async () => {
    const a = await workspaceFixture("currency-orphan");
    await spend(a.channel1.id, 9, "USD");
    await spend(a.channel1.id, 1_000_000, "KRW");
    const budget = await prisma.automationBudget.create({ data: { workspaceId: a.workspace.id, dailyHardLimit: 10, monthlyHardLimit: 10, currency: "USD" } });
    const allowedRun = await run(a.channel1.id);
    await expect(reserve(budget, allowedRun.id, 0.5)).resolves.toBe("RESERVED");

    const orphan = await prisma.costLedger.create({ data: { direction: "ACTUAL", category: "manual", amount: 0.01, currency: "USD" } });
    const blockedRun = await run(a.channel1.id);
    await expect(reserve(budget, blockedRun.id, 0.1, "INSTAGRAM")).resolves.toBe("UNATTRIBUTED_COST");
    await prisma.costLedger.delete({ where: { id: orphan.id } });
  });
});
