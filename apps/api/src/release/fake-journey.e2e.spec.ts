import {
  AnalyticsReportResponseSchema, AuthResponseSchema, ChannelResponseSchema,
  AutomationRunResponseSchema,
  CollectIdeasResponseSchema, ContentReviewResponseSchema, OAuthCallbackResultSchema,
  OptimizationSuggestionResponseSchema, ProductionJobResponseSchema,
  PublishPlanResponseSchema, StartOAuthConnectionResponseSchema
} from "@postbot/contracts";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

// This is an HTTP test against separately running API/BullMQ worker processes.
// Run only against docker-compose.acceptance.yml's disposable database/storage.
const enabled = process.env.RUN_RELEASE_E2E === "1";
const baseUrl = process.env.API_BASE_URL ?? "http://api:3000";

class Session {
  private readonly cookies = new Map<string, string>();
  async response(path: string, body?: unknown, csrf = true): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
    };
    if (csrf) headers["x-csrf-token"] = decodeURIComponent(this.cookies.get("postbot_csrf") ?? "");
    const result = await fetch(new URL(path, baseUrl), {
      method: body === undefined ? "GET" : "POST", headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000)
    });
    for (const cookie of result.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return result;
  }
  async json(path: string, body?: unknown): Promise<unknown> {
    const response = await this.response(path, body);
    // Do not print response bodies: authentication responses contain credentials.
    if (!response.ok) {
      const failure = await response.clone().json().catch(() => ({})) as { code?: unknown; message?: unknown };
      const code = typeof failure.code === "string" ? failure.code : "UNKNOWN";
      const message = typeof failure.message === "string" ? failure.message.slice(0, 300) : "Request failed";
      throw new Error(`HTTP ${response.status} ${code} for ${path.split("?")[0]}: ${message}`);
    }
    return response.json() as Promise<unknown>;
  }
  async job(id: string) {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      const job = ProductionJobResponseSchema.parse(await this.json(`/jobs/${id}`));
      if (job.status === "SUCCEEDED") return job;
      if (["FAILED", "CANCELLED", "NEEDS_REVIEW"].includes(job.status)) {
        throw new Error(`${job.type} ended ${job.status}: ${job.errorCode ?? "unknown"}`);
      }
      await delay(2_000);
    }
    throw new Error(`Timed out waiting for job ${id}`);
  }

  async automationRun(id: string, predicate: (run: ReturnType<typeof AutomationRunResponseSchema.parse>) => boolean) {
    const deadline = Date.now() + 600_000;
    let lastState = "not observed";
    let lastJobs = "not observed";
    let lastInspectedAt = Date.now();
    while (Date.now() < deadline) {
      const run = AutomationRunResponseSchema.parse(await this.json(`/automation/runs/${id}`));
      lastState = JSON.stringify({ status: run.status, pausedReason: run.pausedReason,
        steps: run.steps.map(({ stage, platform, status, errorCode, productionJobId }) => ({ stage, platform, status, errorCode, productionJobId })) });
      if (predicate(run)) return run;
      if (["FAILED", "CANCELLED", "PAUSED"].includes(run.status)) {
        throw new Error(`Automation ended ${run.status}: ${run.pausedReason ?? run.lastErrorCode ?? "unknown"}`);
      }
      if (Date.now() - lastInspectedAt >= 60_000) {
        lastInspectedAt = Date.now();
        const states = await Promise.all(run.steps.filter((step) => step.status === "QUEUED" && step.productionJobId).map(async (step) => {
          const job = ProductionJobResponseSchema.parse(await this.json(`/jobs/${step.productionJobId}`));
          // Only state metadata is safe to log; payloads/results may contain credentials or content.
          return { stage: step.stage, platform: step.platform, jobId: job.id, status: job.status, startedAt: job.startedAt,
            runAfter: job.runAfter, errorCode: job.errorCode,
            attempts: job.attempts.map(({ attemptNumber, status, errorCode }) => ({ attemptNumber, status, errorCode })) };
        }));
        lastJobs = JSON.stringify(states);
        if (states.some((job) => job.status === "RUNNING" && job.startedAt && Date.now() - Date.parse(job.startedAt) >= 60_000)) {
          throw new Error(`Worker claim did not advance its automation step: ${lastJobs}`);
        }
      }
      await delay(2_000);
    }
    throw new Error(`Timed out waiting for automation run ${id}: ${lastState}; jobs: ${lastJobs}`);
  }
}

describe.skipIf(!enabled)("release: real HTTP + MySQL + BullMQ + S3 + renderer, fake external providers", () => {
  const prisma = new PrismaClient();
  const fixtureChannels = new Set<string>();
  beforeAll(() => {
    const database = new URL(process.env.DATABASE_URL ?? "mysql://invalid/");
    if (database.pathname !== "/postbot_acceptance_test") throw new Error("Dedicated acceptance DB required");
  });
  afterAll(async () => { await prisma.$disconnect(); });
  afterEach(async () => {
    await prisma.channel.updateMany({ where: { id: { in: [...fixtureChannels] } }, data: { status: "PAUSED" } });
    fixtureChannels.clear();
  });

  it("registers, logs in, collects, generates, renders, approves, publishes and analyzes without duplicated costs", async () => {
    const flowStartedAt = performance.now();
    const timings: Record<string, number> = {};
    const suffix = randomUUID();
    const session = new Session();
    const accountInput = { email: `${suffix}@acceptance.test`, password: randomUUID(), displayName: "Acceptance" };
    AuthResponseSchema.parse(await session.json("/auth/register", accountInput));
    const auth = AuthResponseSchema.parse(await session.json("/auth/login", accountInput));
    const channelInput = {
      name: `Acceptance ${suffix}`, language: "en", targetAudience: "Science readers", topic: "science",
      platforms: ["YOUTUBE"],
      collectionRule: { keywords: ["rocket"], recencyHours: 24, collectionFrequencyMinutes: 1440 },
      template: { name: "Acceptance", tone: "clear", voiceProfile: "neutral", subtitleStyle: {}, visualStyle: {}, aiStockRatio: 1 },
      outputProfiles: [{ platform: "YOUTUBE", minDurationSeconds: 30, maxDurationSeconds: 60, hookStyle: "question", captionStyle: "simple", metadataRules: {} }],
      scheduleRules: [{ platform: "YOUTUBE", dayOfWeek: 1, timeOfDayLocal: "12:00", timezone: "UTC", maxPosts: 1 }],
      automation: { mode: "APPROVAL", minInventoryCount: 1, dailyPublishLimit: 1,
        errorAction: { onPolicyFailure: "hold", onAssetLicenseUnknown: "hold", onConsecutiveFailures: "pause_channel" } }
    };
    expect((await session.response("/channels", channelInput, false)).status).toBe(403);
    const channel = ChannelResponseSchema.parse(await session.json("/channels", channelInput));
    fixtureChannels.add(channel.id);
    expect(channel.workspaceId).toBe(auth.session.workspace.id);

    const oauth = StartOAuthConnectionResponseSchema.parse(await session.json("/platform-accounts/youtube/connect", { channelId: channel.id }));
    expect(oauth.provider).toBe("fake");
    const callbackUrl = new URL(oauth.authorizationUrl);
    const callback = OAuthCallbackResultSchema.parse(await session.json(`${callbackUrl.pathname}${callbackUrl.search}`));

    const undatedCollection = { channelId: channel.id, idempotencyKey: `undated:${suffix}`, source: "manual", manualCandidates: [{
      title: "Rocket observation", summary: "A repeatable rocket observation.",
      url: `https://example.com/science/${suffix}`, sourceName: "Acceptance fixture", sourceKind: "MANUAL"
    }] };
    expect(CollectIdeasResponseSchema.parse(await session.json("/ideas/collect", undatedCollection))).toMatchObject({ created: 0, rejected: 1 });
    // The passing journey needs an actual collected original, not a bare URL or
    // undated manual summary. The fixture provider supplies dated FULL_TEXT.
    const collection = { channelId: channel.id, idempotencyKey: `collect:${suffix}`, source: "auto" };
    const collected = CollectIdeasResponseSchema.parse(await session.json("/ideas/collect", collection));
    expect(collected.created).toBe(1);
    expect(CollectIdeasResponseSchema.parse(await session.json("/ideas/collect", collection))).toEqual(collected);
    const idea = collected.ideas[0];
    if (!idea) throw new Error("No collected idea");
    await session.json("/automation/budgets", { channelId: channel.id, currency: "USD", dailyHardLimit: 100, monthlyHardLimit: 1000 });
    const production = AutomationRunResponseSchema.parse(await session.json("/automation/runs", { channelId: channel.id, ideaId: idea.id, platforms: ["YOUTUBE"], idempotencyKey: `production:${suffix}` }));
    const scriptStartedAt = performance.now();
    const ready = await session.automationRun(production.id, (run) => run.steps.some((step) => step.stage === "RENDER" && step.status === "SUCCEEDED"));
    const scriptJobId = ready.steps.find((step) => step.stage === "SCRIPT")?.productionJobId;
    if (!scriptJobId) throw new Error("Production script job missing");
    const scriptJob = ProductionJobResponseSchema.parse(await session.json(`/jobs/${scriptJobId}`));
    // This manual publishing journey pauses automatic scheduling before approval.
    await session.json(`/automation/runs/${production.id}/control`, { action: "pause" });
    const sseStartedAt = performance.now();
    const sseResponse = await session.response(`/jobs/${scriptJob.id}/events`);
    timings.sseConnectMs = Math.round(performance.now() - sseStartedAt);
    expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");
    const generated = z.object({ contentItemId: z.string(), sceneVersionId: z.string() }).parse((await session.job(scriptJob.id)).result);
    expect(await sseResponse.text()).toContain('"progress":100');
    timings.scriptJobMs = Math.round(performance.now() - scriptStartedAt);
    const { contentItemId } = generated;
    const renderJobId = ready.steps.find((step) => step.stage === "RENDER")?.productionJobId;
    if (!renderJobId) throw new Error("Production render job missing");
    const render = await session.job(renderJobId);
    expect(render.result).toMatchObject({ qa: { width: 1080, height: 1920 } });
    expect((await session.response("/jobs", { type: "PUBLISH", channelId: channel.id, contentItemId, payload: { publish: { publishPlanId: "injected" } } })).status).toBe(403);
    const reviewed = ContentReviewResponseSchema.parse(await session.json(`/content/${contentItemId}/review/policy-check`, { platform: "YOUTUBE" }));
    expect(reviewed.policy?.status).toBe("pass");
    expect(ContentReviewResponseSchema.parse(await session.json(`/content/${contentItemId}/review/action`, { action: "approve" })).status).toBe("APPROVED");

    const publishInput = { contentItemId, platformAccountId: callback.account.id, scheduledAt: new Date(Date.now() + 15_000).toISOString(), idempotencyKey: `publish:${suffix}` };
    const plan = PublishPlanResponseSchema.parse(await session.json("/publishing/plans", publishInput));
    expect(PublishPlanResponseSchema.parse(await session.json("/publishing/plans", publishInput)).id).toBe(plan.id);
    const publishJob = await prisma.productionJob.findUniqueOrThrow({ where: { idempotencyKey: `publish:${plan.id}` } });
    await session.job(publishJob.id);
    expect(await prisma.platformPost.count({ where: { publishPlanId: plan.id } })).toBe(1);
    expect(await prisma.providerUsage.count({ where: { productionJobId: scriptJob.id } })).toBe(1);
    expect(await prisma.costLedger.count({ where: { providerUsage: { productionJobId: scriptJob.id } } })).toBe(1);

    const period = { periodStart: new Date(Date.now() - 86_400_000).toISOString(), periodEnd: new Date(Date.now() + 86_400_000).toISOString() };
    const analytics = ProductionJobResponseSchema.parse(await session.json("/analytics/sync", { channelId: channel.id, platform: "YOUTUBE", ...period, timezone: "UTC", idempotencyKey: `analytics:${suffix}` }));
    const analyticsStartedAt = performance.now();
    expect((await session.job(analytics.id)).result).toMatchObject({ collectionStatus: "PARTIAL" });
    timings.analyticsJobMs = Math.round(performance.now() - analyticsStartedAt);
    const report = AnalyticsReportResponseSchema.parse(await session.json(`/analytics/report?${new URLSearchParams({ channelId: channel.id, ...period })}`));
    expect(report.metrics.some((metric) => metric.metric === "views" && metric.value !== null)).toBe(true);
    expect(report.collectionStatus).toBe("PARTIAL");
    expect(report.nextCollectionAt).not.toBeNull();
    const suggestion = OptimizationSuggestionResponseSchema.parse(await session.json("/optimization/suggestions/generate", { channelId: channel.id, platform: "YOUTUBE", metric: "views", ...period, idempotencyKey: `optimize:${suffix}` }));
    // Fresh period totals have not passed the provider's reporting delay.
    // Preserve their values, schedule recollection, and exclude them from advice.
    expect(suggestion).toMatchObject({ sampleSize: 0, status: "HELD", confidenceScore: null });
    expect(suggestion.targetStrategy).toBeNull();
    expect(suggestion.evidence).toMatchObject({ excludedUnknownOrUnbound: 1, conclusion: "YOUTUBE_DERIVED_DATA_RESTRICTED", policyStatus: "YOUTUBE_DERIVED_DATA_RESTRICTED" });

    const stranger = new Session();
    AuthResponseSchema.parse(await stranger.json("/auth/register", { ...accountInput, email: `other-${suffix}@acceptance.test` }));
    expect((await stranger.response(`/content/${contentItemId}/review`)).status).toBe(404);
    expect((await stranger.response(`/jobs/${scriptJob.id}`)).status).toBe(404);
    timings.totalMs = Math.round(performance.now() - flowStartedAt);
    process.stdout.write(`LOCAL_BASELINE ${JSON.stringify({ flow: "manual", timings })}\n`);
  }, 360_000);

  it.each(["APPROVAL", "FULL_AUTO"] as const)("runs the %s automation path through publish, analytics and optimization", async (mode) => {
    const flowStartedAt = performance.now();
    const suffix = randomUUID();
    const session = new Session();
    const accountInput = { email: `${mode.toLowerCase()}-${suffix}@acceptance.test`, password: randomUUID(), displayName: mode };
    AuthResponseSchema.parse(await session.json("/auth/register", accountInput));
    // Rendering time varies significantly on cold CI hosts. Give the pipeline a
    // rolling set of near-future slots so a completed render never rolls a
    // single missed weekly slot into the following week.
    const platforms = ["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const;
    const scheduleBase = Date.now();
    const scheduleRules = platforms.flatMap((platform) => Array.from({ length: 7 }, (_, index) => {
      const scheduleAt = new Date(scheduleBase + (index + 1) * 2 * 60_000);
      return {
        platform,
        dayOfWeek: scheduleAt.getUTCDay(),
        timeOfDayLocal: `${String(scheduleAt.getUTCHours()).padStart(2, "0")}:${String(scheduleAt.getUTCMinutes()).padStart(2, "0")}`,
        timezone: "UTC",
        maxPosts: 1
      };
    }));
    const channel = ChannelResponseSchema.parse(await session.json("/channels", {
      name: `${mode} ${suffix}`, startPaused: true, language: "en", targetAudience: "Science readers", topic: "science", platforms,
      collectionRule: { keywords: ["rocket"], recencyHours: 24, collectionFrequencyMinutes: 1440 },
      template: { name: mode, tone: "clear", voiceProfile: "neutral", subtitleStyle: {}, visualStyle: {}, aiStockRatio: 1 },
      outputProfiles: platforms.map((platform) => ({ platform, minDurationSeconds: 30, maxDurationSeconds: 30, hookStyle: "question", captionStyle: "simple", metadataRules: {} })),
      scheduleRules,
      automation: { mode, minInventoryCount: 1, dailyPublishLimit: 1, errorAction: { onPolicyFailure: "hold", onAssetLicenseUnknown: "hold", onConsecutiveFailures: "pause_channel" } }
    }));
    const schedulerStartedAt = performance.now();
    fixtureChannels.add(channel.id);
    const schedulerObservation = (async (): Promise<number | null> => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const scheduled = await prisma.automationRun.findFirst({ where: { channelId: channel.id, idempotencyKey: { startsWith: `scheduler:${channel.id}:` } } });
        if (scheduled) return Math.round(performance.now() - schedulerStartedAt);
        await delay(250);
      }
      return null;
    })();
    for (const platform of platforms) {
      const oauth = StartOAuthConnectionResponseSchema.parse(await session.json(`/platform-accounts/${platform.toLowerCase()}/connect`, { channelId: channel.id }));
      const callbackUrl = new URL(oauth.authorizationUrl);
      OAuthCallbackResultSchema.parse(await session.json(`${callbackUrl.pathname}${callbackUrl.search}`));
    }
    await session.json("/automation/budgets", { channelId: channel.id, currency: "USD", dailySoftLimit: 50, dailyHardLimit: 100, monthlySoftLimit: 500, monthlyHardLimit: 1_000 });
    // Let the scheduler see the channel only after all required setup is ready.
    // Otherwise FULL_AUTO can retain a held run created during OAuth setup.
    await session.json(`/channels/${channel.id}/resume`, {});
    const input = { channelId: channel.id, idempotencyKey: `automation:${mode.toLowerCase()}:${suffix}` };
    const started = AutomationRunResponseSchema.parse(await session.json("/automation/runs", input));
    expect(AutomationRunResponseSchema.parse(await session.json("/automation/runs", input)).id).toBe(started.id);

    if (mode === "APPROVAL") {
      const held = await session.automationRun(started.id, (run) => run.status === "PAUSED" && run.pausedReason === "AWAITING_APPROVAL");
      const scriptJobId = held.steps.find((step) => step.stage === "SCRIPT" && step.platform === "YOUTUBE")?.productionJobId;
      if (!scriptJobId) throw new Error("Automation SCRIPT job missing");
      const scriptJob = await prisma.productionJob.findUniqueOrThrow({ where: { id: scriptJobId } });
      const result = z.object({ contentItemId: z.string() }).parse(scriptJob.result);
      expect(ContentReviewResponseSchema.parse(await session.json(`/content/${result.contentItemId}/review/action`, { action: "approve" })).status).toBe("APPROVED");
    }

    const completed = await session.automationRun(started.id, (run) => run.status === "SUCCEEDED");
    expect(completed.steps.every((step) => step.status === "SUCCEEDED")).toBe(true);
    expect(completed.steps).toHaveLength(1 + platforms.length * 6);
    const publishJobId = completed.steps.find((step) => step.stage === "PUBLISH" && step.platform === "YOUTUBE")?.productionJobId;
    if (!publishJobId) throw new Error("Automation PUBLISH job missing");
    const publishJob = await prisma.productionJob.findUniqueOrThrow({ where: { id: publishJobId } });
    const contentItemId = publishJob.contentItemId;
    if (!contentItemId) throw new Error("Automation content item missing");
    expect(await prisma.scriptVersion.count({ where: { contentItemId, platform: { in: [...platforms] } } })).toBe(3);
    expect(await prisma.sceneVersion.count({ where: { contentItemId, platform: { in: [...platforms] } } })).toBe(3);
    expect(await prisma.publishPlan.count({ where: { contentItemId, platform: { in: [...platforms] } } })).toBe(3);
    const posts = await prisma.platformPost.findMany({ where: { publishPlan: { contentItemId } } });
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((post) => post.externalPostId)).size).toBe(3);
    // Collection waits for an actual observation age. Advance isolated fixture
    // publication times; the production scheduler must rebuild due work itself.
    expect(await prisma.analyticsSync.count({ where: { channelId: channel.id, idempotencyKey: { startsWith: `automation:${started.id}:` } } })).toBe(0);
    await prisma.platformPost.updateMany({ where: { id: { in: posts.map((post) => post.id) } }, data: { publishedAt: new Date(Date.now() - 8 * 86400000) } });
    await expect.poll(() => prisma.analyticsSync.count({ where: { channelId: channel.id, OR: posts.map((post) => ({ idempotencyKey: { startsWith: `post:${post.id}:` } })) } }), { timeout: 30000 }).toBe(9);
    await expect.poll(() => prisma.productionJob.count({ where: { channelId: channel.id, type: "ANALYTICS", status: "SUCCEEDED" } }), { timeout: 30000 }).toBe(9);
    expect(AutomationRunResponseSchema.parse(await session.json("/automation/runs", input)).id).toBe(started.id);
    expect(await prisma.platformPost.count({ where: { publishPlan: { contentItemId } } })).toBe(3);
    const period = { periodStart: new Date(Date.now() - 86_400_000).toISOString(), periodEnd: new Date(Date.now() + 86_400_000).toISOString() };
    const suggestion = OptimizationSuggestionResponseSchema.parse(await session.json("/optimization/suggestions/generate", { channelId: channel.id, platform: "YOUTUBE", metric: "views", ...period, idempotencyKey: `optimization:${started.id}` }));
    expect(suggestion).toMatchObject({ sampleSize: 1, status: "HELD", targetStrategy: null, confidenceScore: null, evidence: { policyStatus: "YOUTUBE_DERIVED_DATA_RESTRICTED" } });
    process.stdout.write(`LOCAL_BASELINE ${JSON.stringify({ flow: mode.toLowerCase(), timings: { schedulerObservedMs: await schedulerObservation, totalMs: Math.round(performance.now() - flowStartedAt) } })}\n`);
  }, 900_000);
});
