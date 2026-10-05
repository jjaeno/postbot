import { expect, test, type Page } from "@playwright/test";

const session = {
  csrfToken: "fixture-csrf-token-for-cross-host-browser-testing",
  user: {
    id: "user-1",
    email: "owner@example.com",
    displayName: "Owner",
    timezone: "Asia/Seoul"
  },
  workspace: {
    id: "workspace-1",
    name: "Personal Workspace",
    slug: "personal",
    role: "OWNER"
  }
};

const channel = (
  name: string,
  connected = false,
  automationMode: "APPROVAL" | "FULL_AUTO" = "APPROVAL"
) => ({
  id: "channel-1",
  workspaceId: "workspace-1",
  name,
  slug: "science-today",
  description: "Science channel settings",
  topic: "Daily science facts",
  targetAudience: "Adults who want verified short knowledge",
  excludedTopics: ["politics"],
  language: "ko-KR",
  status: "ACTIVE",
  automationMode,
  minInventoryCount: 5,
  dailyPublishLimit: 2,
  errorAction: {
    onPolicyFailure: "hold",
    onAssetLicenseUnknown: "hold",
    onConsecutiveFailures: "pause_channel"
  },
  template: {
    name: "Default vertical short",
    tone: "question hook",
    voiceProfile: "neutral-ko",
    subtitleStyle: {},
    visualStyle: {},
    aiStockRatio: 0.5
  },
  outputProfiles: [
    {
      platform: "YOUTUBE",
      minDurationSeconds: 35,
      maxDurationSeconds: 55,
      hookStyle: "question hook",
      captionStyle: "readable",
      metadataRules: {},
      publicSetting: "PUBLIC"
    }
  ],
  collectionRule: {
    keywords: ["science"],
    excludedKeywords: ["politics"],
    allowedSources: [],
    excludedSources: [],
    recencyHours: 72,
    collectionFrequencyMinutes: 240
  },
  scheduleRules: [
    {
      platform: "YOUTUBE",
      dayOfWeek: 1,
      timeOfDayLocal: "09:00",
      timezone: "Asia/Seoul",
      maxPosts: 1
    }
  ],
  platformConnections: [
    {
      platform: "YOUTUBE",
      status: connected ? "CONNECTED" : "PLANNED",
      handle: connected ? "@postbot-fake" : null,
      displayName: connected ? "Postbot Fake YouTube" : null
    }
  ],
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z"
});

const account = {
  id: "account-1",
  workspaceId: "workspace-1",
  channelId: "channel-1",
  platform: "YOUTUBE",
  externalAccountId: "fake-youtube-channel",
  handle: "@postbot-fake",
  displayName: "Postbot Fake YouTube",
  status: "CONNECTED",
  scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
  expiresAt: "2026-08-28T12:00:00.000Z",
  connectedAt: "2026-08-28T00:00:00.000Z",
  disconnectedAt: null
};

const mockApi = async (page: Page): Promise<void> => {
  await page.route("**/operations/notifications", (route) => route.fulfill({ json: [] }));
  await page.route("**/optimization/channels/*/strategies", (route) => route.fulfill({ json: [] }));
  await page.route("**/optimization/suggestions?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/optimization/experiments?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/channels/channel-1/stock-assets", (route) => route.fulfill({ json: { assets: [] } }));
  await page.route("**/analytics/report?**", (route) => route.fulfill({ json: { channelId: "channel-1", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-05T00:00:00.000Z", metrics: [], partial: false, lastSyncedAt: null } }));
  await page.route("**/operations/costs?**", (route) => route.fulfill({ json: { currency: "USD", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-05T00:00:00.000Z", estimated: 0, actual: 0, credit: 0, reconciled: true, discrepancy: 0, byProvider: [] } }));
  let connected = false;
  let channels = [channel("Science Today", connected)];
  let review = {
    id: "content-1",
    channelId: "channel-1",
    status: "REVIEW_REQUIRED",
    title: "Reusable rocket",
    description: "Verified science content",
    durationSeconds: 30,
    sources: [
      { title: "Reusable rocket", url: "https://example.com/rocket", sourceName: "Example" }
    ],
    assets: [{ id: "asset-1", licenseStatus: "VERIFIED", purpose: "image" }],
    policy: null as { status: "pass"; findings: never[]; snapshotId: string } | null,
    ideaId: "idea-1",
    outputs: [{ platform: "YOUTUBE", scriptVersionId: "script-1", sceneVersionId: "scene-1", scriptStatus: "ready", renderStatus: "ready", videoReady: true, metadata: { description: "Verified science content", hashtags: ["science"] } }]
  };

  await page.route("**/auth/me", async (route) => {
    await route.fulfill({ json: session });
  });

  await page.route("**/platform-accounts/youtube/connect", async (route) => {
    await route.fulfill({
      json: {
        authorizationUrl:
          "http://localhost:3000/platform-accounts/youtube/callback?state=fake-state-123456789012345678901234&code=fake-code",
        stateExpiresAt: "2026-08-28T01:00:00.000Z",
        provider: "fake",
        requiredScopes: ["https://www.googleapis.com/auth/youtube.readonly"]
      }
    });
  });

  await page.route("**/platform-accounts/youtube/callback?**", async (route) => {
    connected = true;
    channels = [channel("Science Today", connected)];
    await route.fulfill({ json: { account } });
  });

  await page.route("**/platform-accounts/account-1/disconnect", async (route) => {
    connected = false;
    channels = [channel("Science Today", connected)];
    await route.fulfill({ json: { ok: true } });
  });

  await page.route("**/platform-accounts", async (route) => {
    await route.fulfill({ json: { accounts: connected ? [account] : [] } });
  });

  await page.route("**/content", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: "content-1",
            channelId: "channel-1",
            title: "Reusable rocket",
            status: "REVIEW_REQUIRED",
            updatedAt: "2026-09-21T00:00:00.000Z",
            sceneVersionId: "scene-1",
            renderReady: true
          }
        ]
      }
    });
  });

  await page.route("**/content/content-1/review", async (route) => {
    await route.fulfill({ json: review });
  });

  await page.route("**/content/content-1/review/preview?**", async (route) => {
    await route.fulfill({ json: { url: "https://example.com/preview.mp4", expiresInSeconds: 900 } });
  });

  await page.route("**/automation/budgets", async (route) => {
    if (route.request().method() === "POST") {
        expect(route.request().headers()["x-csrf-token"]).toBe(session.csrfToken);
      const body = route.request().postDataJSON() as { channelId: string | null; currency?: string; dailySoftLimit?: number | null; dailyHardLimit?: number | null; monthlySoftLimit?: number | null; monthlyHardLimit?: number | null };
      await route.fulfill({ json: { id: "budget-1", currency: "USD", dailySoftLimit: null, monthlySoftLimit: null, dailyHardLimit: null, monthlyHardLimit: null, ...body, updatedAt: "2026-10-02T00:00:00.000Z" } }); return;
    }
    await route.fulfill({ json: [] });
  });

  await page.route("**/publishing/plans", async (route) => {
    if (route.request().method() === "GET") { await route.fulfill({ json: [] }); return; }
    await route.fallback();
  });

  await page.route(/\/ideas\/channels\/channel-1(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { ideas: [{ id: "idea-1", channelId: "channel-1", status: "CANDIDATE", title: "Moon ice", summary: "Verified lunar science", canonicalUrl: "https://example.com/moon", sourceName: "Example", sourceKind: "OFFICIAL", provider: "fixture", publishedAt: null, collectedAt: "2026-10-02T00:00:00.000Z", suitabilityScore: 0.9, freshnessScore: 0.8, reliabilityScore: 0.9, expectedValueScore: 0.85, rejectionReason: null, createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" }] } });
  });

  await page.route("**/automation/runs", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { channelId: string; ideaId: string; platforms: string[]; idempotencyKey: string };
      await route.fulfill({ status: 201, json: { id: "run-generation-1", channelId: body.channelId, status: "RUNNING", idempotencyKey: body.idempotencyKey, checkpoint: { source: "manual-idea" }, failureCount: 0, pausedReason: null, nextRunAt: null, heartbeatAt: "2026-10-02T00:00:00.000Z", lastErrorCode: null, lastErrorMessage: null, steps: [{ stage: "COLLECT", platform: null, status: "SUCCEEDED", attemptCount: 0, maxAttempts: 3, productionJobId: null, errorCode: null, errorMessage: null }, { stage: "SCRIPT", platform: "YOUTUBE", status: "QUEUED", attemptCount: 0, maxAttempts: 3, productionJobId: "job-1", errorCode: null, errorMessage: null }] } }); return;
    }
    await route.fulfill({ json: [] });
  });
  await page.route("**/automation/runs/run-generation-1", (route) => route.fulfill({ json: { id: "run-generation-1", channelId: "channel-1", status: "PAUSED", idempotencyKey: "wizard-sample", checkpoint: { sample: true }, failureCount: 0, pausedReason: "SAMPLE_REVIEW_REQUIRED", nextRunAt: null, heartbeatAt: null, lastErrorCode: null, lastErrorMessage: null, steps: [{ stage: "SCRIPT", platform: "YOUTUBE", status: "SUCCEEDED", attemptCount: 1, maxAttempts: 3, productionJobId: "job-1", errorCode: null, errorMessage: null, output: { contentItemId: "content-1", sceneVersionId: "scene-1" } }, { stage: "PUBLISH", platform: "YOUTUBE", status: "HELD", attemptCount: 0, maxAttempts: 3, productionJobId: null, errorCode: "SAMPLE_REVIEW_REQUIRED", errorMessage: "Sample only" }] } }));
  await page.route("**/automation/runs/run-generation-1/complete-setup", (route) => route.fulfill({ json: { ok: true } }));

  await page.route("**/content/content-1/review/policy-check", async (route) => {
    const policy = { status: "pass" as const, findings: [], snapshotId: "snapshot-1" };
    review = { ...review, policy, outputs: review.outputs.map((output) => ({ ...output, policy })) };
    await route.fulfill({ json: review });
  });

  await page.route("**/content/content-1/review/action", async (route) => {
    const action = route.request().postDataJSON() as {
      action: "approve" | "hold" | "discard" | "schedule";
    };
    review = {
      ...review,
      outputs: review.outputs.map((output) => ({ ...output, reviewStatus: action.action === "approve" ? "APPROVED" as const : action.action === "discard" ? "DISCARDED" as const : "HELD" as const })),
      status:
        action.action === "approve"
          ? "APPROVED"
          : action.action === "schedule"
            ? "SCHEDULED"
            : "HELD"
    };
    await route.fulfill({ json: review });
  });

  await page.route("**/channels", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        name: string;
        automation?: { mode?: "APPROVAL" | "FULL_AUTO" };
      };
      channels = [channel(body.name, connected, body.automation?.mode)];
      await route.fulfill({ status: 201, json: channels[0] });
      return;
    }

    await route.fulfill({ json: { channels } });
  });

  await page.route(/^https?:\/\/[^/]+\/channels\/channel-1$/, async (route) => {
    const body = route.request().postDataJSON() as { name?: string; automation?: { mode: "APPROVAL" | "FULL_AUTO" } } | null;
    channels = [channel(body?.name ?? channels[0]?.name ?? "Science Today", connected, body?.automation?.mode)];
    await route.fulfill({ json: channels[0] });
  });

  await page.route("**/channels/channel-1/pause", async (route) => {
    await route.fulfill({ json: { ...channel("Science Today", connected), status: "PAUSED" } });
  });

  await page.route("**/channels/channel-1/resume", async (route) => {
    await route.fulfill({ json: channel("Science Today", connected) });
  });
};

test("creates and edits a channel through the eight-step wizard", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "채널 운영 설정" })).toBeVisible();

  await page.getByTestId("create-channel").click();
  await expect(page.getByRole("heading", { name: "기본" })).toBeVisible();
  await page.locator('input[name="name"]').fill("Science Today");

  await page.getByTestId("wizard-next").click();
  await page.getByRole("dialog").getByTestId("wizard-next").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("최소 1개");
  await page.getByRole("dialog").getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("YouTube Shorts · 연결됨");
  for (let index = 1; index < 7; index += 1) {
    await page.getByTestId("wizard-next").click();
  }
  await expect(page.getByTestId("wizard-create")).toBeDisabled();
  await page.getByRole("button", { name: "실제 샘플 제작", exact: true }).click();
  await expect(page.getByRole("dialog").locator("video")).toBeVisible();
  await page.getByRole("button", { name: "정책 검사 후 샘플 승인", exact: true }).click();
  await page.getByLabel("모든 플랫폼의 실제 샘플 영상과 출처를 확인했습니다.").check();
  await expect(page.getByTestId("wizard-create")).toBeEnabled();
  await page.getByTestId("wizard-create").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("Science Today");
  await expect(page.getByTestId("channel-card-channel-1")).toContainText("연결됨");

  await page.getByTestId("edit-channel-channel-1").click();
  await page.getByLabel("채널 이름", { exact: true }).fill("Science Today Updated");
  await page.getByTestId("save-channel-settings").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("Science Today Updated");
});

test("connects and disconnects YouTube with the fake OAuth provider", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await page.getByTestId("connect-youtube-channel-1").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("연결됨");
  await expect(page.getByTestId("disconnect-youtube-channel-1")).toBeVisible();

  await page.getByTestId("disconnect-youtube-channel-1").click();
  await expect(page.getByTestId("channel-card-channel-1")).toContainText("연결 예정");
});

test("restores the operating dashboard and calendar after refresh", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByLabel("운영 현황")).toContainText("검토 필요");
  await expect(page.getByTestId("calendar-panel")).toContainText("09:00");
  await expect(page.getByRole("button", { name: /Reusable rocket/ })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("calendar-panel")).toContainText("Science Today");
});

test("approves reviewed content through the fake API", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await page.getByLabel("검토할 콘텐츠").selectOption("content-1");
  await page.getByRole("button", { name: "정책 검사" }).click();
  await expect(page.getByText("통과", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(page.getByText("승인됨", { exact: true })).toBeVisible();
});

test("creates a full-auto channel through the fake API", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await page.getByTestId("create-channel").click();
  await page.locator('input[name="name"]').fill("Auto Science");

  await page.getByTestId("wizard-next").click();
  await page.getByRole("dialog").getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("YouTube Shorts · 연결됨");
  for (let index = 1; index < 6; index += 1) {
    await page.getByTestId("wizard-next").click();
  }

  await page.locator('select[name="automationMode"]').selectOption("FULL_AUTO");
  await page.getByTestId("wizard-next").click();
  const sampleRequest = page.waitForRequest((candidate) => candidate.url().endsWith("/automation/runs") && candidate.method() === "POST");
  await page.getByRole("button", { name: "실제 샘플 제작", exact: true }).click();
  expect((await sampleRequest).postDataJSON()).toMatchObject({ sample: true });
  await page.getByRole("button", { name: "정책 검사 후 샘플 승인", exact: true }).click();
  await page.getByLabel("모든 플랫폼의 실제 샘플 영상과 출처를 확인했습니다.").check();
  await expect(page.getByTestId("wizard-create")).toBeEnabled();
  await page.getByTestId("wizard-create").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("Auto Science");
  await expect(page.getByTestId("channel-card-channel-1")).toContainText("완전 자동형");
});

test("starts production from an idea without internal identifiers", async ({ page }) => {
  await mockApi(page); await page.goto("/");
  await page.getByLabel("제작 플랫폼").selectOption("YOUTUBE");
  const request = page.waitForRequest((candidate) => candidate.url().endsWith("/automation/runs") && candidate.method() === "POST");
  await page.getByRole("button", { name: "이 소재로 영상 만들기" }).click();
  expect((await request).postDataJSON()).toMatchObject({ ideaId: "idea-1", platforms: ["YOUTUBE"] });
  await expect(page.getByText(/제작 작업을 시작했습니다/)).toBeVisible();
});

test("configures a workspace budget from the screen", async ({ page }) => {
  await mockApi(page); await page.goto("/");
  await page.getByLabel("일간 중단 (USD)").fill("12.5");
  const request = page.waitForRequest((candidate) => candidate.url().endsWith("/automation/budgets") && candidate.method() === "POST");
  await page.getByRole("button", { name: "예산 저장" }).click();
  expect((await request).postDataJSON()).toMatchObject({ channelId: null, currency: "USD", dailyHardLimit: 12.5 });
});

test("preserves review input across polling and restores the selected content", async ({ page }, testInfo) => {
  await mockApi(page); await page.goto("/?content=content-1");
  const title = page.getByTestId("review-panel").getByLabel("제목", { exact: true });
  await expect(title).not.toHaveValue("");
  await title.fill("검수 중인 제목");
  await expect(title).toHaveValue("검수 중인 제목", { timeout: 8_000 });
  await page.waitForResponse((response) => response.url().endsWith("/content/content-1/review"));
  await expect(title).toHaveValue("검수 중인 제목");
  await page.reload();
  await expect(page.getByLabel("검토할 콘텐츠")).toHaveValue("content-1");
  await page.screenshot({ path: testInfo.outputPath("review-dashboard.png"), fullPage: true });
});

test("validates timezone input without crashing and supports modal Escape", async ({ page }) => {
  await mockApi(page); await page.goto("/"); await page.getByTestId("create-channel").click();
  await page.getByTestId("wizard-next").click();
  await page.getByRole("dialog").getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("YouTube Shorts · 연결됨");
  for (let index = 1; index < 5; index += 1) await page.getByTestId("wizard-next").click();
  await page.locator('input[name="timezone"]').fill("Not/AZone"); await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("alert")).toContainText("IANA");
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("explains OAuth return failure and does not display unavailable costs as zero", async ({ page }) => {
  await mockApi(page);
  await page.route("**/operations/costs?**", (route) => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  await page.goto("/?oauth=failed#channels");
  await expect(page.getByText(/권한 거절, 연결 만료/)).toBeVisible();
  await expect(page.getByTestId("operations-panel")).toContainText("조회 실패");
});

test("creates, starts and compares a limited experiment without claiming causality", async ({ page }) => {
  await mockApi(page);
  let state = "DRAFT"; let created = false;
  const experiment = () => ({ id: "experiment-1", channelId: "channel-1", status: state, name: "Duration test", hypothesis: "Longer duration may help", targetMetric: "views", minSampleSize: 4, allocation: { platform: "YOUTUBE", periodDays: 30 }, successCriteria: {}, stopCriteria: { maxAssignments: 100 }, result: state === "COMPLETED" ? { control: { sampleSize: 4, mean: 100 }, variant: { sampleSize: 4, mean: 125 }, relativeChange: 0.25, winner: "variant", causalClaim: false } : null, stopReason: null, startedAt: state === "DRAFT" ? null : "2026-10-05T00:00:00.000Z", endedAt: state === "COMPLETED" ? "2026-10-05T01:00:00.000Z" : null });
  await page.route("**/optimization/experiments?**", (route) => route.fulfill({ json: created ? [experiment()] : [] }));
  await page.route("**/optimization/experiments", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ platform: "YOUTUBE", minSampleSize: 4, control: { durationSeconds: 40 }, variant: { durationSeconds: 44 }, stopCriteria: { maxAssignments: 100 } });
    created = true; await route.fulfill({ json: experiment() });
  });
  await page.route("**/optimization/experiments/experiment-1/action", async (route) => { const input = route.request().postDataJSON() as { action: string }; state = input.action === "start" ? "RUNNING" : "COMPLETED"; await route.fulfill({ json: experiment() }); });
  await page.goto("/");
  const panel = page.getByTestId("experiment-panel");
  await panel.getByLabel("실험 이름", { exact: true }).fill("Duration test");
  await panel.getByLabel("가설", { exact: true }).fill("Longer duration may help");
  await panel.getByRole("button", { name: "실험 초안 생성" }).click();
  await panel.getByRole("button", { name: "실험 시작", exact: true }).click();
  await panel.getByRole("button", { name: "가용 성과로 비교 완료" }).click();
  await expect(panel).toContainText("25.0%"); await expect(panel).toContainText("변경군 우세 가설");
  await expect(panel).toContainText("인과 효과나 통계적 유의성을 주장하지 않습니다");
});
