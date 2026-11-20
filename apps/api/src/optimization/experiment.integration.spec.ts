import "reflect-metadata";
import { PrismaClient, Prisma } from "@postbot/database";
import { assignProductionExperiment, deterministicExperimentArm } from "@postbot/optimization";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { OptimizationService } from "./optimization.service.js";
import type { OperationsService } from "../operations/operations.service.js";
import { scheduleAnalysis, analysisReadiness } from "./schedule-analysis.js";
import { BullMqQueueAdapter } from "@postbot/jobs";
import { JobsService } from "../jobs/jobs.service.js";
import { PrismaJobsRepository } from "../jobs/prisma-jobs.repository.js";

const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const prisma = new PrismaClient();
const seed = async (maxAssignments?: number) => {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { email: `${key}@experiment.test`, displayName: "Fixture", passwordHash: "fixture" } });
  const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
  const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, status: "PAUSED", outputProfiles: { create: { platform: "INSTAGRAM", minDurationSeconds: 15, maxDurationSeconds: 90 } } } });
  const service = new OptimizationService(prisma, { audit: () => Promise.resolve() } as unknown as OperationsService);
  const experiment = await service.createExperiment(workspace.id, "OWNER", { channelId: channel.id, stopCriteria: maxAssignments ? { maxAssignments } : undefined, name: "Duration", hypothesis: "Longer duration may improve views", platform: "INSTAGRAM", periodDays: 7, targetMetric: "views", minSampleSize: 2, control: { durationSeconds: 30 }, variant: { durationSeconds: 33 }, successCriteria: { minRelativeImprovement: 0.1, direction: "higher" } });
  await service.experimentAction(workspace.id, "OWNER", experiment.id, { action: "start" });
  await prisma.experiment.update({ where: { id: experiment.id }, data: { startedAt: new Date(Date.now() - 60_000) } });
  return { key, workspace, channel, experiment, service };
};

suite("real production experiment allocation and available metric comparison", () => {
  afterAll(() => prisma.$disconnect());
  it("applies one strategy under competing requests and rechecks current permissions and limits", async () => {
    const f = await seed(); const userId = f.workspace.ownerId;
    await prisma.channel.update({ where: { id: f.channel.id }, data: { optimizationSettings: { autoApplyFields: ["durationSeconds"], maxChangeRatio: 0.2 } } });
    await prisma.strategyVersion.create({ data: { channelId: f.channel.id, version: 1, name: "Initial", strategy: { durationSeconds: 30 } } });
    const suggestion = await prisma.optimizationSuggestion.create({ data: { channelId: f.channel.id, status: "APPROVED", title: "Bounded", rationale: "Owner-approved editorial hypothesis", evidence: { platform: "INSTAGRAM" }, sampleSize: 4, metricVersion: "analytics-mapping-v3", ruleVersion: "optimization-rules-v3", targetStrategy: { durationSeconds: 33, maxChangeRatio: 0.2 } } });
    const applied = await Promise.all([0, 1, 2].map(() => f.service.suggestionAction(f.workspace.id, "OWNER", userId, suggestion.id, { action: "apply" })));
    expect(applied.every((item) => item.status === "APPLIED")).toBe(true);
    expect(await prisma.strategyVersion.count({ where: { channelId: f.channel.id } })).toBe(2);
    const restored = await Promise.all([0, 1].map(() => f.service.rollback(f.workspace.id, "OWNER", userId, f.channel.id, 1)));
    expect(restored[0]).toEqual(restored[1]);
    expect(await prisma.strategyVersion.count({ where: { channelId: f.channel.id } })).toBe(3);
    const next = await prisma.optimizationSuggestion.create({ data: { channelId: f.channel.id, status: "APPROVED", title: "Stale permission", rationale: "Fixture", evidence: { platform: "INSTAGRAM" }, sampleSize: 4, metricVersion: "analytics-mapping-v3", ruleVersion: "optimization-rules-v3", targetStrategy: { durationSeconds: 33, maxChangeRatio: 0.2 } } });
    await prisma.channel.update({ where: { id: f.channel.id }, data: { optimizationSettings: { autoApplyFields: [], maxChangeRatio: 0.2 } } });
    await expect(f.service.suggestionAction(f.workspace.id, "OWNER", userId, next.id, { action: "apply" })).rejects.toThrow("STRATEGY_FIELD_NOT_CURRENTLY_ALLOWED");
    await prisma.channel.update({ where: { id: f.channel.id }, data: { optimizationSettings: { autoApplyFields: ["durationSeconds"], maxChangeRatio: 0.01 } } });
    await expect(f.service.suggestionAction(f.workspace.id, "OWNER", userId, next.id, { action: "apply" })).rejects.toThrow("STRATEGY_CHANGE_EXCEEDS_CURRENT_LIMIT");
    expect(await prisma.strategyVersion.count({ where: { channelId: f.channel.id } })).toBe(3);
  });
  it("keeps allocation stable, isolates platform, expires the period and protects reserved terms", async () => {
    const fixture = await seed();
    const content = await prisma.contentItem.create({ data: { channelId: fixture.channel.id, title: "Science", topicKey: fixture.key } });
    const assign = (platform = "INSTAGRAM") => prisma.$transaction((tx) => assignProductionExperiment(tx, fixture.channel.id, content.id, platform));
    const first = await assign();
    expect(first).not.toBeNull(); expect(await assign()).toEqual(first);
    expect(await assign("YOUTUBE")).toBeNull();
    expect(await prisma.experimentAssignment.count({ where: { experimentId: fixture.experiment.id, contentItemId: content.id } })).toBe(1);
    await prisma.experiment.update({ where: { id: fixture.experiment.id }, data: { stopCriteria: { maxAssignments: 1 } } });
    const capped = await prisma.contentItem.create({ data: { channelId: fixture.channel.id, title: "Capped", topicKey: `${fixture.key}:capped` } });
    expect(await prisma.$transaction((tx) => assignProductionExperiment(tx, fixture.channel.id, capped.id, "INSTAGRAM"))).toBeNull();
    expect(await assign()).toEqual(first);
    await prisma.channel.update({ where: { id: fixture.channel.id }, data: { optimizationSettings: { protectedTopics: ["science"] } } });
    expect(await assign()).toBeNull();
    await prisma.channel.update({ where: { id: fixture.channel.id }, data: { optimizationSettings: {} } });
    await prisma.experiment.update({ where: { id: fixture.experiment.id }, data: { startedAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect(await assign()).toBeNull();
  });
  it("compares only the experiment's actually published output and never completes with insufficient per-arm samples", async () => {
    const fixture = await seed(4);
    await expect(fixture.service.experimentAction(fixture.workspace.id, "OWNER", fixture.experiment.id, { action: "complete" })).rejects.toThrow("각 그룹");
    expect((await prisma.experiment.findUniqueOrThrow({ where: { id: fixture.experiment.id } })).status).toBe("RUNNING");
    await prisma.experiment.update({ where: { id: fixture.experiment.id }, data: { startedAt: new Date(Date.now() - 2 * 3_600_000) } });
    const account = await prisma.platformAccount.create({ data: { workspaceId: fixture.workspace.id, channelId: fixture.channel.id, platform: "INSTAGRAM", externalAccountId: fixture.key } });
    const sync = await prisma.analyticsSync.create({ data: { channelId: fixture.channel.id, platform: "INSTAGRAM", status: "SUCCEEDED", idempotencyKey: fixture.key, periodStart: new Date(Date.now() - 60_000), periodEnd: new Date(), timezone: "UTC" } });
    const counts = { control: 0, variant: 0 };
    for (let index = 0; counts.control < 2 || counts.variant < 2; index++) {
      if (index > 50) throw new Error("FIXTURE_ALLOCATION_FAILED");
      const content = await prisma.contentItem.create({ data: { channelId: fixture.channel.id, title: "Experiment output", topicKey: `${fixture.key}:${index}` } });
      const predicted = deterministicExperimentArm(fixture.experiment.id, content.id);
      if (counts[predicted] >= 2) continue;
      const assignment = await prisma.$transaction((tx) => assignProductionExperiment(tx, fixture.channel.id, content.id, "INSTAGRAM"));
      if (!assignment || (assignment.arm !== "control" && assignment.arm !== "variant") || counts[assignment.arm] >= 2) continue;
      await prisma.experimentAssignment.updateMany({ where: { contentItemId: content.id, experimentId: fixture.experiment.id }, data: { assignedAt: new Date(Date.now() - 3_600_000 - 1000) } });
      counts[assignment.arm]++;
      const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "INSTAGRAM", version: 1, hook: "Hook", body: "Body", qualitySnapshot: { generationContext: { experiment: { assignmentKey: assignment.assignmentKey } } } } });
      const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform: "INSTAGRAM", version: 1, schemaVersion: "1.0.0", sceneDocument: {} } });
      const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, platform: "INSTAGRAM", platformAccountId: account.id, sceneVersionId: scene.id, status: "PUBLISHED", scheduledAt: new Date(Date.now() - 500), idempotencyKey: `${fixture.key}:plan:${index}`, title: "Fixture" } });
      const post = await prisma.platformPost.create({ data: { publicationState: "PUBLISHED", publishPlanId: plan.id, platformAccountId: account.id, platform: "INSTAGRAM", externalPostId: `${fixture.key}:post:${index}`, postUrl: "https://example.com/fixture", publishedAt: new Date(Date.now() - 3_600_000), policyVersion: 1, productionSnapshot: { version: "published-features-v1", platform: "INSTAGRAM", sceneVersionId: scene.id, scriptVersionId: script.id, actualDurationSeconds: assignment.arm === "control" ? 30 : 33, experiment: { assignmentKey: assignment.assignmentKey, compliant: true } } } });
      await prisma.analyticsMetricSnapshot.create({ data: { analyticsSyncId: sync.id, platformPostId: post.id, metric: "views", mappingVersion: "v3", observationKind: "LIFETIME_SNAPSHOT", unit: "count", aggregation: "sum", sceneVersionId: scene.id, scriptVersionId: script.id, status: "AVAILABLE", value: new Prisma.Decimal(assignment.arm === "control" ? 100 : 130), observedAt: new Date(Date.now() - 100), rawSnapshot: {} } });
      // A later unavailable observation is not zero and does not erase valid evidence.
      await prisma.analyticsMetricSnapshot.create({ data: { analyticsSyncId: sync.id, platformPostId: post.id, metric: "views", mappingVersion: "analytics-mapping-v1", status: "UNAVAILABLE", observedAt: new Date(), rawSnapshot: {} } });
    }
    const variant = await prisma.platformPost.findFirstOrThrow({ where: { platformAccountId: account.id, productionSnapshot: { path: "$.actualDurationSeconds", equals: 33 } } });
    const originalFeatures = variant.productionSnapshot;
    await prisma.platformPost.update({ where: { id: variant.id }, data: { productionSnapshot: { ...(originalFeatures as Prisma.JsonObject), actualDurationSeconds: 50 } } });
    await expect(fixture.service.experimentAction(fixture.workspace.id, "OWNER", fixture.experiment.id, { action: "complete" })).rejects.toMatchObject({ response: { code: "EXPERIMENT_INSUFFICIENT_SAMPLES" } });
    await prisma.platformPost.update({ where: { id: variant.id }, data: { productionSnapshot: originalFeatures ?? Prisma.JsonNull } });
    const metric = await prisma.analyticsMetricSnapshot.findFirstOrThrow({ where: { platformPostId: variant.id, status: "AVAILABLE" } });
    await prisma.analyticsMetricSnapshot.update({ where: { id: metric.id }, data: { collectedAt: new Date(Date.now() - 1_800_000) } });
    await expect(fixture.service.experimentAction(fixture.workspace.id, "OWNER", fixture.experiment.id, { action: "complete" })).rejects.toMatchObject({ response: { code: "EXPERIMENT_INSUFFICIENT_SAMPLES" } });
    await prisma.analyticsMetricSnapshot.update({ where: { id: metric.id }, data: { collectedAt: new Date() } });
    await prisma.experiment.update({ where: { id: fixture.experiment.id }, data: { stopCriteria: { maxAssignments: 8 } } });
    await expect(fixture.service.experimentAction(fixture.workspace.id, "OWNER", fixture.experiment.id, { action: "complete" })).rejects.toMatchObject({ response: { code: "EXPERIMENT_NOT_READY_FOR_FINAL_ANALYSIS" } });
    await prisma.experiment.update({ where: { id: fixture.experiment.id }, data: { stopCriteria: { maxAssignments: 4 } } });
    const completed = await fixture.service.experimentAction(fixture.workspace.id, "OWNER", fixture.experiment.id, { action: "complete" });
    expect(completed).toMatchObject({ status: "COMPLETED", result: { control: { sampleSize: 2, mean: 100 }, variant: { sampleSize: 2, mean: 130 }, winner: "variant", relativeChange: 0.3, causalClaim: false } });
    expect(await fixture.service.experimentAction(fixture.workspace.id, "OWNER", fixture.experiment.id, { action: "complete" })).toEqual(completed);
  });
  it("serializes competing starts and rejects out-of-range strategies", async () => {
    const fixture = await seed();
    await expect(fixture.service.createExperiment(fixture.workspace.id, "OWNER", { channelId: fixture.channel.id, name: "Unsafe", hypothesis: "Unsafe change", targetMetric: "views", minSampleSize: 2, control: { durationSeconds: 30 }, variant: { durationSeconds: 60 }, successCriteria: {} })).rejects.toThrow("EXPERIMENT_DURATION_OUTSIDE_ALLOWED_RANGE");
    const draft = await fixture.service.createExperiment(fixture.workspace.id, "OWNER", { channelId: fixture.channel.id, platform: "INSTAGRAM", name: "Second", hypothesis: "Second change", targetMetric: "views", minSampleSize: 2, control: { durationSeconds: 30 }, variant: { durationSeconds: 33 }, successCriteria: {} });
    await expect(fixture.service.experimentAction(fixture.workspace.id, "OWNER", draft.id, { action: "start" })).rejects.toThrow("CONFLICTING_CHANNEL_EXPERIMENT");
  });
  it("holds mixed observation cohorts and reads frozen output instead of later edits", async () => {
    const fixture = await seed();
    const account = await prisma.platformAccount.create({ data: { workspaceId: fixture.workspace.id, channelId: fixture.channel.id, platform: "INSTAGRAM", externalAccountId: fixture.key } });
    const now = new Date();
    const sync = await prisma.analyticsSync.create({ data: { channelId: fixture.channel.id, platform: "INSTAGRAM", status: "SUCCEEDED", idempotencyKey: fixture.key, periodStart: new Date(now.getTime() - 86_400_000), periodEnd: now, timezone: "UTC" } });
    for (let index = 0; index < 4; index++) {
      const content = await prisma.contentItem.create({ data: { channelId: fixture.channel.id, title: "Frozen output", topicKey: `${fixture.key}:${index}` } });
      const script = await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "INSTAGRAM", version: 1, hook: "Original", body: "Body" } });
      const scene = await prisma.sceneVersion.create({ data: { contentItemId: content.id, scriptVersionId: script.id, platform: "INSTAGRAM", version: 1, schemaVersion: "1.0.0", sceneDocument: {} } });
      const plan = await prisma.publishPlan.create({ data: { contentItemId: content.id, platformAccountId: account.id, platform: "INSTAGRAM", sceneVersionId: scene.id, scheduledAt: now, title: "Frozen", idempotencyKey: `${fixture.key}:${index}` } });
      const post = await prisma.platformPost.create({ data: { publicationState: "PUBLISHED", publishPlanId: plan.id, platformAccountId: account.id, platform: "INSTAGRAM", externalPostId: `${fixture.key}:${index}`, postUrl: "https://example.com/fixture", publishedAt: new Date(now.getTime() - 3_600_000), policyVersion: 1, productionSnapshot: { version: "published-features-v1", sceneVersionId: scene.id, scriptVersionId: script.id, actualDurationSeconds: 30, hookType: "QUESTION" } } });
      await prisma.analyticsMetricSnapshot.create({ data: { analyticsSyncId: sync.id, platformPostId: post.id, metric: "views", mappingVersion: "v3", status: "AVAILABLE", value: index + 1, observedAt: now, collectedAt: new Date(now.getTime() + (index < 2 ? 0 : 3_600_000)), observationKind: "LIFETIME_SNAPSHOT", sceneVersionId: scene.id, scriptVersionId: script.id, rawSnapshot: {} } });
      await prisma.scriptVersion.create({ data: { contentItemId: content.id, platform: "INSTAGRAM", version: 2, hook: "Later edit", body: "Unrelated", qualitySnapshot: { durationSeconds: 90 } } });
    }
    const request = { channelId: fixture.channel.id, platform: "INSTAGRAM", metric: "views", periodStart: new Date(now.getTime() - 1000).toISOString(), periodEnd: new Date(now.getTime() + 7_200_000).toISOString(), idempotencyKey: randomUUID() };
    const mixed = await fixture.service.generate(fixture.workspace.id, request);
    expect(mixed).toMatchObject({ status: "HELD", sampleSize: 2, confidenceScore: null, evidence: { excludedOtherObservationCohorts: 2, baseline: { topDuration: 30, bottomDuration: 30 } } });
    await prisma.analyticsMetricSnapshot.updateMany({ where: { analyticsSyncId: sync.id }, data: { collectedAt: now } });
    await prisma.channel.update({ where: { id: fixture.channel.id }, data: { status: "ACTIVE" } });
    const queue = new BullMqQueueAdapter(process.env.REDIS_URL ?? "redis://127.0.0.1:16379", `analysis-${fixture.key}`);
    try {
      const jobs = new JobsService(new PrismaJobsRepository(prisma), queue);
      await Promise.all([scheduleAnalysis(prisma, jobs, now, fixture.channel.id.slice(0, -1)), scheduleAnalysis(prisma, jobs, now, fixture.channel.id.slice(0, -1))]);
      const queued = await prisma.productionJob.findMany({ where: { channelId: fixture.channel.id, type: "ANALYTICS" } });
      expect(queued).toHaveLength(1);
      expect(await queue.state(queued[0]?.id ?? "missing", "analytics")).toBe("waiting");
      const payload = queued[0]?.payload as Prisma.JsonObject;
      await fixture.service.generate(fixture.workspace.id, payload.analysis);
      expect((await analysisReadiness(prisma, fixture.channel.id, now)).eligible).toHaveLength(0);
      await scheduleAnalysis(prisma, jobs, now, fixture.channel.id.slice(0, -1));
      expect(await prisma.productionJob.count({ where: { channelId: fixture.channel.id } })).toBe(1);
    } finally { await queue.close(); }
    expect(await fixture.service.generate(fixture.workspace.id, { ...request, idempotencyKey: randomUUID() })).toMatchObject({ status: "HELD", sampleSize: 4, evidence: { baseline: { topDuration: 30, bottomDuration: 30 } } });
  });
  it("keeps YouTube native observations separate from restricted derived strategies", async () => {
    const fixture = await seed();
    const result = await fixture.service.generate(fixture.workspace.id, { channelId: fixture.channel.id, platform: "YOUTUBE", metric: "views", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2027-01-01T00:00:00Z", idempotencyKey: randomUUID() });
    expect(result).toMatchObject({ status: "HELD", confidenceScore: null, targetStrategy: null, evidence: { policyStatus: "YOUTUBE_DERIVED_DATA_RESTRICTED", baseline: null, featureAnalysis: [] } });
    await prisma.experiment.update({ where: { id: fixture.experiment.id }, data: { allocation: { platform: "YOUTUBE" } } });
    await expect(fixture.service.experimentAction(fixture.workspace.id, "OWNER", fixture.experiment.id, { action: "complete" })).rejects.toThrow("YOUTUBE_DERIVED_DATA_RESTRICTED");
  });
});
