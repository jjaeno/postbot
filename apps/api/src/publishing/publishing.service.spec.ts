import { describe, expect, it } from "vitest";
import { nextAvailableSlot } from "./publishing.service.js";
import { PublishingService } from "./publishing.service.js";
import type { PrismaClient } from "@postbot/database";
import type { JobsService } from "../jobs/jobs.service.js";
describe("nextAvailableSlot", () => {
  it("returns the first unoccupied future slot", () => {
    const first = new Date("2026-10-01T09:00:00.000Z"); const second = new Date("2026-10-01T18:00:00.000Z");
    expect(nextAvailableSlot([second, first], [first], new Date("2026-10-01T08:00:00.000Z"))).toEqual(second);
  });
  it("returns null when no future slot is available", () => expect(nextAvailableSlot([], [], new Date())).toBeNull());
});

describe("platform-specific manual scheduling", () => {
  it("does not return another workspace's plan for a reused idempotency key", async () => {
    const prisma = {
      publishPlan: { findUnique: () => Promise.resolve({ contentItemId: "foreign-content", platformAccountId: "foreign-account" }) },
      contentItem: { findFirst: () => Promise.resolve(null) }
    } as unknown as PrismaClient;
    await expect(new PublishingService(prisma, {} as JobsService).schedule("workspace-1", { contentItemId: "content-1", platformAccountId: "account-1", scheduledAt: "2099-01-01T00:00:00.000Z", idempotencyKey: "foreign-key" })).rejects.toMatchObject({ response: { code: "PUBLISH_PLAN_NOT_FOUND" } });
  });
  it("uses the account platform's current render, policy and edited metadata", async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      publishPlan: { findUnique: () => Promise.resolve(null), findFirst: () => Promise.resolve(null), create: ({ data }: { data: Record<string, unknown> }) => { created.push(data); return Promise.resolve({ id: "plan-1", ...data }); } },
      platformAccount: { findFirst: () => Promise.resolve({ id: "account-1", workspaceId: "workspace-1", channelId: "channel-1", platform: "TIKTOK", status: "CONNECTED" }) },
      channel: { findUniqueOrThrow: () => Promise.resolve({ dailyPublishLimit: 1, scheduleRules: [{ timezone: "Asia/Seoul" }] }) },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ $queryRaw: () => Promise.resolve([]), publishPlan: { findUnique: () => Promise.resolve(null), findMany: () => Promise.resolve([]), create: ({ data }: { data: Record<string, unknown> }) => { created.push(data); return Promise.resolve({ id: "plan-1", ...data }); } } }),
      contentItem: {
        findFirst: () => Promise.resolve({ id: "content-1", channelId: "channel-1", title: "Original", summary: "Original summary", sceneVersions: [{ id: "scene-tiktok", renderManifest: { videoKey: "tiktok.mp4" }, createdAt: new Date("2026-10-01T00:00:00.000Z") }], scriptVersions: [{ id: "script-tiktok", createdAt: new Date("2026-10-01T00:00:00.000Z"), qualitySnapshot: { reviewStatus: "APPROVED", reviewTitle: "Edited TikTok title", metadata: { description: "Edited description", hashtags: ["edited"] } } }], policyChecks: [{ status: "PASS", checkedAt: new Date("2026-10-01T00:01:00.000Z"), snapshots: [{ id: "snapshot-tiktok" }] }] }),
        update: () => Promise.resolve({})
      }
    } as unknown as PrismaClient;
    const jobs = { create: () => Promise.resolve({ id: "job-1" }) } as unknown as JobsService;
    const service = new PublishingService(prisma, jobs);
    await service.schedule("workspace-1", { contentItemId: "content-1", platformAccountId: "account-1", scheduledAt: "2099-01-01T00:00:00.000Z", idempotencyKey: "platform-specific-plan" });
    expect(created[0]).toMatchObject({ platform: "TIKTOK", sceneVersionId: "scene-tiktok", policySnapshotId: "snapshot-tiktok", title: "Edited TikTok title", description: "Edited description", hashtags: ["edited"] });
  });
});
