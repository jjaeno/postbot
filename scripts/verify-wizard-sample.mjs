// Local acceptance only: real queue/render/storage, explicit Fake external providers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../packages/database/dist/index.js";

for (const key of ["LLM_PROVIDER", "IMAGE_PROVIDER", "TTS_PROVIDER", "YOUTUBE_OAUTH_PROVIDER"]) assert.equal(process.env[key], "fake", `${key} must be fake`);
assert.equal(process.env.APP_ENV, "test");
assert.equal(process.env.TOPIC_SOURCE_PROVIDER, "fixture");
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith("_test"));
const base = process.env.API_BASE_URL ?? "http://api:3000";
const prisma = new PrismaClient();
let cookies = ""; let csrf = ""; let channelId;
const call = async (path, body, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(new URL(path, base), { method, headers: { "content-type": "application/json", ...(cookies ? { cookie: cookies } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.headers.getSetCookie().length) cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const result = await response.json();
  assert.ok(response.ok, `${method} ${path.split("?")[0]} failed: ${response.status} ${typeof result.code === "string" ? result.code : ""}`);
  return result;
};
try {
  const key = randomUUID();
  const auth = await call("/auth/register", { email: `${key}@wizard-smoke.invalid`, password: `${randomUUID()}${randomUUID()}`, displayName: "Wizard QA", timezone: "UTC" });
  csrf = auth.csrfToken;
  const channel = await call("/channels", {
    name: `Wizard sample ${key.slice(0, 8)}`, startPaused: true, description: "Isolated local sample acceptance", language: "en", targetAudience: "Science viewers", topic: "Science and space", excludedTopics: [], platforms: ["YOUTUBE"],
    collectionRule: { keywords: ["rocket"], excludedKeywords: [], allowedSources: [], excludedSources: [], recencyHours: 72, collectionFrequencyMinutes: 240 },
    template: { name: "Branded QA", tone: "Clear and factual", voiceProfile: "neutral-ko", aiStockRatio: 1, subtitleStyle: { color: "#ffff00", backgroundColor: "#123456", fontSize: 40 }, visualStyle: { brandColor: "#ffcc00", fontFamily: "serif", watermark: "WIZARD SAMPLE QA" } },
    outputProfiles: [{ platform: "YOUTUBE", minDurationSeconds: 30, maxDurationSeconds: 30, hookStyle: "Question", captionStyle: "readable", metadataRules: {}, publicSetting: "PUBLIC" }],
    scheduleRules: [{ platform: "YOUTUBE", dayOfWeek: 1, timeOfDayLocal: "09:00", timezone: "UTC", maxPosts: 1 }],
    automation: { mode: "FULL_AUTO", minInventoryCount: 1, dailyPublishLimit: 1, errorAction: { onPolicyFailure: "hold", onAssetLicenseUnknown: "hold", onConsecutiveFailures: "pause_channel" } }
  });
  channelId = channel.id; assert.equal(channel.status, "PAUSED");
  const oauth = await call("/platform-accounts/youtube/connect", { channelId }); assert.equal(oauth.provider, "fake");
  const callback = new URL(oauth.authorizationUrl); await call(callback.pathname + callback.search);
  await call("/automation/budgets", { channelId, dailyHardLimit: 5, monthlyHardLimit: 20 });
  const started = await call("/automation/runs", { channelId, sample: true, platforms: ["YOUTUBE"], idempotencyKey: `wizard-smoke:${key}` });
  assert.equal(started.checkpoint.sample, true);
  const deadline = Date.now() + 900_000;
  let run;
  while (Date.now() < deadline) {
    run = await call(`/automation/runs/${started.id}`);
    const blocked = run.steps.find((step) => ["HELD", "FAILED"].includes(step.status) && step.stage !== "PUBLISH");
    assert.ok(!blocked, `Unexpected held stage: ${blocked?.stage} ${blocked?.errorCode}`);
    if (run.steps.find((step) => step.stage === "PUBLISH")?.errorCode === "SAMPLE_REVIEW_REQUIRED") break;
    console.log(JSON.stringify({ run: started.id, status: run.status, stages: run.steps.map((step) => `${step.stage}:${step.status}`) }));
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  assert.equal(run.steps.find((step) => step.stage === "PUBLISH")?.errorCode, "SAMPLE_REVIEW_REQUIRED");
  const contentId = run.steps.find((step) => step.stage === "SCRIPT").output.contentItemId;
  const review = await call(`/content/${contentId}/review`); assert.ok(review.outputs[0].videoReady);
  const preview = await call(`/content/${contentId}/review/preview?platform=YOUTUBE`);
  const media = await fetch(preview.url); assert.ok(media.ok); assert.ok((await media.arrayBuffer()).byteLength > 1000);
  await call(`/content/${contentId}/review/policy-check`, { platform: "YOUTUBE" });
  await call(`/content/${contentId}/review/action`, { action: "approve", platform: "YOUTUBE" });
  await call(`/automation/runs/${started.id}/control`, { action: "retry", stage: "PUBLISH", platform: "YOUTUBE" });
  assert.equal(await prisma.publishPlan.count({ where: { contentItemId: contentId } }), 0);
  const scene = await prisma.sceneVersion.findFirstOrThrow({ where: { contentItemId: contentId, platform: "YOUTUBE" }, orderBy: { version: "desc" } });
  assert.equal(scene.sceneDocument.style.watermark, "WIZARD SAMPLE QA"); assert.equal(scene.renderManifest.style.captionColor, "#ffff00");
  await call(`/automation/runs/${started.id}/complete-setup`, {});
  const completed = await call(`/automation/runs/${started.id}`); assert.equal(completed.status, "SUCCEEDED");
  assert.equal(await prisma.publishPlan.count({ where: { contentItemId: contentId } }), 0);
  console.log(JSON.stringify({ result: "PASS", channelId, runId: started.id, contentId, noPublishPlans: true, qa: scene.renderManifest.qa, style: scene.renderManifest.style }));
} finally {
  // Preserve evidence; pause only this script's disposable fixture channel.
  if (channelId) await prisma.channel.update({ where: { id: channelId }, data: { status: "PAUSED" } });
  await prisma.$disconnect();
}
