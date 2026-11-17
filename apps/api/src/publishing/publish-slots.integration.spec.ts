import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createScheduledPlan } from "./publish-slots.js";

const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("serialized platform slot reservations", () => {
  afterAll(() => prisma.$disconnect());
  it("prevents concurrent overbooking while preserving the sibling platform", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@slot.test`, displayName: "Slot test", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Slots", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Slots", slug: key, dailyPublishLimit: 1 } });
    const content = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Fixture", topicKey: key } });
    const youtube = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "YOUTUBE", externalAccountId: `${key}:yt`, status: "CONNECTED" } });
    const instagram = await prisma.platformAccount.create({ data: { workspaceId: workspace.id, channelId: channel.id, platform: "INSTAGRAM", externalAccountId: `${key}:ig`, status: "CONNECTED" } });
    const input = { contentItemId: content.id, platformAccountId: youtube.id, platform: "YOUTUBE" as const, status: "SCHEDULED" as const, scheduledAt: new Date("2099-01-01T01:00:00Z"), title: "Fixture" };
    await expect(createScheduledPlan(prisma, channel.id, "Asia/Seoul", 1, { ...input, idempotencyKey: `${key}:rollback` }, () => Promise.reject(new Error("DURABLE_JOB_INSERT_FAILED")))).rejects.toThrow("DURABLE_JOB_INSERT_FAILED");
    expect(await prisma.publishPlan.count({ where: { idempotencyKey: `${key}:rollback` } })).toBe(0);
    const reservations = await Promise.allSettled([createScheduledPlan(prisma, channel.id, "Asia/Seoul", 1, { ...input, idempotencyKey: `${key}:1` }), createScheduledPlan(prisma, channel.id, "Asia/Seoul", 1, { ...input, idempotencyKey: `${key}:2` })]);
    expect(reservations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(reservations.filter((result) => result.status === "rejected")).toHaveLength(1);
    const first = reservations.find((result) => result.status === "fulfilled");
    if (!first || first.status !== "fulfilled") throw new Error("Missing reservation fixture");
    await prisma.publishPlan.update({ where: { id: first.value.id }, data: { status: "CANCELLED" } });
    const replacement = await createScheduledPlan(prisma, channel.id, "Asia/Seoul", 1, { ...input, idempotencyKey: `${key}:replacement` });
    expect(replacement.id).not.toBe(first.value.id);
    expect(await prisma.publishPlan.count({ where: { contentItemId: content.id, platform: "YOUTUBE" } })).toBe(2);
    await expect(createScheduledPlan(prisma, channel.id, "Asia/Seoul", 1, { ...input, idempotencyKey: `${key}:replacement` })).resolves.toMatchObject({ id: replacement.id });
    await expect(createScheduledPlan(prisma, channel.id, "Asia/Seoul", 1, { ...input, scheduledAt: new Date("2099-01-01T02:00:00Z"), idempotencyKey: `${key}:3` })).rejects.toThrow();
    await expect(createScheduledPlan(prisma, channel.id, "Asia/Seoul", 1, { ...input, platform: "INSTAGRAM", platformAccountId: instagram.id, idempotencyKey: `${key}:ig` })).resolves.toMatchObject({ platform: "INSTAGRAM" });
  });
});
