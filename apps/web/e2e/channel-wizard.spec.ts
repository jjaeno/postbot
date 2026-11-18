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
  await page.route("**/automation/switches", (route) => route.fulfill({ json: [] }));
  await page.route("**/automation/policy-profiles", (route) => route.fulfill({ json: [{ platform: "YOUTUBE", region: "GLOBAL", version: 1, checkedAt: "2026-10-01T00:00:00.000Z", minDurationSeconds: 30, maxDurationSeconds: 60 }] }));
  await page.route("**/optimization/settings?**", (route) => route.fulfill({ json: { protectedTopics: [], protectedBrandPhrases: [], prohibitedPatterns: [], autoApplyFields: [], maxChangeRatio: 0.2 } }));
  await page.route("**/operations/notifications", (route) => route.fulfill({ json: [] }));
  await page.route("**/optimization/channels/*/strategies", (route) => route.fulfill({ json: [] }));
  await page.route("**/optimization/suggestions?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/optimization/experiments?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/channels/channel-1/stock-assets", (route) => route.fulfill({ json: { assets: [] } }));
  await page.route("**/channels/channel-1/audio-assets", (route) => route.fulfill({ json: { assets: [] } }));
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

test("keeps long cost filter options inside narrow screens without losing selections", async ({ page }) => {
  await mockApi(page);
  const title = "Reusable rocket test reaches new altitude";
  await page.route("**/content", (route) => route.fulfill({ json: { items: [{ id: "content-1", channelId: "channel-1", title, status: "REVIEW_REQUIRED", updatedAt: "2026-09-21T00:00:00.000Z", sceneVersionId: "scene-1", renderReady: true }] } }));
  await page.goto("/#settings");
  await page.getByLabel("비용 채널").selectOption("channel-1");
  await page.getByLabel("비용 콘텐츠").selectOption("content-1");
  await page.getByLabel("비용 제공자", { exact: true }).fill("fake-llm");
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/operations/costs" && url.searchParams.get("contentItemId") === "content-1" && url.searchParams.get("provider") === "fake-llm";
  });
  await page.getByLabel("비용 기간").selectOption("90");
  await filtered;
  for (const width of [320, 360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByLabel("비용 콘텐츠")).toHaveValue("content-1");
    await expect(page.getByLabel("비용 콘텐츠").getByRole("option", { name: title, exact: true })).toHaveText(title);
    await expect(page.getByLabel("비용 채널")).toHaveValue("channel-1");
    await expect(page.getByLabel("비용 제공자", { exact: true })).toHaveValue("fake-llm");
    await expect(page.getByLabel("비용 기간")).toHaveValue("90");
  }
});

test("saves operational controls without overwriting independent platform settings on mobile", async ({ page }) => {
  await mockApi(page);
  let saved = false;
  await page.route(/^https?:\/\/[^/]+\/channels\/channel-1$/, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ topic: "Verified rocket", collectionRule: { keywords: ["rocket", "space"], allowedSources: ["https://example.com"], profile: { language: "fr", subtopics: ["Roman history", "Egyptian history"], cadence: { collectMinutes: 360, selectMinutes: 60, produceMinutes: 120 } } }, outputProfiles: [{ platform: "YOUTUBE", hookStyle: "YT only" }], automation: { minInventoryCount: 3 } });
    expect(route.request().postDataJSON()).toMatchObject({ collectionRule: { profile: { production: { producerConcurrency: 2, reviewCap: 7, scheduledBufferHours: 12 } } } });
    saved = true; await route.fulfill({ json: channel("Science Today") });
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/#channels");
  await page.getByTestId("edit-channel-channel-1").click();
  const editor = page.getByTestId("channel-operations-editor");
  await editor.getByRole("button", { name: "역사 초기값", exact: true }).click();
  await editor.getByLabel("제작·검색 언어", { exact: true }).fill("fr");
  await editor.getByLabel("동시 제작 상한", { exact: true }).fill("2");
  await editor.getByLabel("검수 대기 상한", { exact: true }).fill("7");
  await editor.getByLabel("재고에 포함할 가까운 예약 (시간)", { exact: true }).fill("12");
  await editor.getByLabel("세부 주제 (한 줄에 하나)", { exact: true }).fill("Roman history\nEgyptian history");
  await editor.getByLabel("주제", { exact: true }).fill("Verified rocket");
  await editor.getByLabel("수집 키워드 (쉼표 구분)").fill("rocket,space");
  await editor.getByLabel("허용 출처 URL (쉼표 구분)").fill("https://example.com");
  await editor.getByLabel("최소 콘텐츠 재고", { exact: true }).fill("3");
  await editor.getByLabel("YOUTUBE 훅", { exact: true }).fill("YT only");
  const layout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll<HTMLElement>("body *")].flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && (bounds.right > innerWidth + 1 || bounds.left < -1)
        ? [{ tag: element.tagName, className: element.className, width: bounds.width, left: bounds.left, right: bounds.right }]
        : [];
    })
  }));
  expect(layout.width, JSON.stringify(layout.overflowing)).toBe(390);
  await page.getByTestId("save-channel-settings").click(); await expect(editor).not.toBeVisible(); expect(saved).toBe(true);
});

test("uses keyboard review tabs and labels populated descriptions independently of textarea content", async ({ page }) => {
  await mockApi(page); await page.goto("/?contentItemId=content-1&platform=YOUTUBE#content");
  await page.getByLabel("검토할 콘텐츠").selectOption("content-1");
  const panel = page.getByTestId("review-panel");
  await expect(panel.getByLabel("설명", { exact: true })).toHaveValue("Verified science content");
  await panel.getByRole("button", { name: "AI 생성 고지 추가" }).click();
  await expect(panel.getByLabel("설명", { exact: true })).toHaveValue(/AI generated/);
  await panel.getByRole("tab", { name: "YouTube Shorts" }).focus(); await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("tab", { name: "Instagram Reels" })).toBeFocused();
  await expect(panel.getByRole("tab", { name: "Instagram Reels" })).toHaveAttribute("aria-selected", "true");
  await page.reload(); await expect(panel.getByRole("tab", { name: "Instagram Reels" })).toHaveAttribute("aria-selected", "true");
});

test("loads the regenerated scene preview without requiring a page reload", async ({ page }) => {
  await mockApi(page);
  let version = 1;
  await page.route("**/content/content-1/review", (route) => route.fulfill({ json: { id: "content-1", channelId: "channel-1", status: "REVIEW_REQUIRED", title: "Rocket", description: "AI generated", durationSeconds: 30, sources: [], assets: [], policy: null, outputs: [{ platform: "YOUTUBE", scriptVersionId: `script-${version}`, sceneVersionId: `scene-${version}`, videoReady: true, scriptStatus: "ready", renderStatus: "ready", metadata: { description: "AI generated", hashtags: [] } }] } }));
  await page.route("**/content/content-1/review/preview?**", (route) => route.fulfill({ json: { url: `https://example.com/scene-${version}.mp4`, expiresInSeconds: 900 } }));
  await page.goto("/#content"); await page.getByLabel("검토할 콘텐츠").selectOption("content-1");
  const video = page.getByTestId("review-panel").locator("video");
  await expect(video).toHaveAttribute("src", "https://example.com/scene-1.mp4");
  version = 2;
  await expect(video).toHaveAttribute("src", "https://example.com/scene-2.mp4", { timeout: 10000 });
});

test("keeps later wizard settings editable after an audio-only advanced change", async ({ page }) => {
  await mockApi(page); await page.goto("/"); await page.getByTestId("create-channel").click();
  await page.getByTestId("wizard-next").click();
  await page.getByRole("dialog").getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("YouTube Shorts · 연결됨");
  await page.getByTestId("wizard-next").click(); await page.getByTestId("wizard-next").click();
  await page.getByTestId("channel-audio-editor").getByLabel("배경음 볼륨 (0~1)").fill("0.35");
  await page.locator('input[name="voiceProfile"]').fill("updated-voice");
  await page.getByTestId("wizard-next").click();
  await page.locator('input[name="durationMinSeconds"]').fill("40");
  await page.locator('input[name="durationMaxSeconds"]').fill("50");
  for (let index = 4; index < 7; index += 1) await page.getByTestId("wizard-next").click();
  await page.getByRole("dialog").locator("summary").filter({ hasText: "플랫폼별 출력·수집 출처·세부 운영 설정" }).click();
  const editor = page.getByTestId("channel-operations-editor");
  await expect(editor.getByLabel("YOUTUBE 최소 길이 초")).toHaveValue("40");
  await expect(editor.getByLabel("수집 키워드 (쉼표 구분)")).not.toHaveValue("");
  await expect(editor.getByLabel("주제", { exact: true })).not.toHaveValue("");
});

test("shows suggestion failures and confirms provider stop and recovery", async ({ page }) => {
  await mockApi(page);
  let enabled = true;
  await page.route("**/automation/switches", async (route) => {
    if (route.request().method() === "POST") { enabled = (route.request().postDataJSON() as { isEnabled: boolean }).isEnabled; await route.fulfill({ json: { provider: "image", isEnabled: enabled, reason: null } }); }
    else await route.fulfill({ json: [{ provider: "image", isEnabled: enabled, reason: null }] });
  });
  await page.route("**/optimization/suggestions/generate", (route) => route.fulfill({ status: 409, json: { message: "표본을 확인할 수 없습니다" } }));
  await page.goto("/#insights"); await page.getByLabel("분석 플랫폼").selectOption("YOUTUBE");
  await page.getByTestId("insight-controls").getByRole("button", { name: "최적화 제안 생성" }).click();
  await expect(page.getByTestId("insight-controls").getByRole("alert")).toContainText("표본을 확인할 수 없습니다");
  await page.getByRole("navigation", { name: "운영 메뉴" }).getByRole("link", { name: "사용량·설정" }).click();
  const provider = page.getByTestId("provider-controls").locator("article").filter({ hasText: /^image:/ });
  page.once("dialog", (dialog) => dialog.accept()); await provider.getByRole("button", { name: "중지", exact: true }).click(); await expect(provider).toContainText("차단");
  page.once("dialog", (dialog) => dialog.accept()); await provider.getByRole("button", { name: "복구 후 활성화" }).click(); await expect(provider).toContainText("활성");
});

test("creates and edits a channel through the eight-step wizard", async ({ page }) => {
  await mockApi(page);

  await page.goto("/#channels");
  await expect(page.getByRole("heading", { name: "채널", exact: true })).toBeVisible();

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

  await page.goto("/#channels");
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
  await page.getByRole("navigation", { name: "운영 메뉴" }).getByRole("link", { name: "캘린더" }).click();
  await expect(page.getByTestId("calendar-panel")).toContainText("09:00");
  await page.getByRole("navigation", { name: "운영 메뉴" }).getByRole("link", { name: "콘텐츠", exact: true }).click();
  await expect(page.getByRole("button", { name: /Reusable rocket/ })).toBeVisible();
  await page.getByRole("navigation", { name: "운영 메뉴" }).getByRole("link", { name: "캘린더" }).click();
  await page.reload();
  await expect(page.getByTestId("calendar-panel")).toContainText("Science Today");
});

test("approves reviewed content through the fake API", async ({ page }) => {
  await mockApi(page);

  await page.goto("/#content");
  await page.getByLabel("검토할 콘텐츠").selectOption("content-1");
  await page.getByRole("button", { name: "정책 검사" }).click();
  await expect(page.getByText("통과", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(page.getByText("승인됨", { exact: true })).toBeVisible();
});

test("creates a full-auto channel through the fake API", async ({ page }) => {
  await mockApi(page);

  await page.goto("/#channels");
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
  await mockApi(page); await page.goto("/#ideas");
  await page.getByLabel("제작 플랫폼").selectOption("YOUTUBE");
  const request = page.waitForRequest((candidate) => candidate.url().endsWith("/automation/runs") && candidate.method() === "POST");
  await page.getByRole("button", { name: "이 소재로 영상 만들기" }).click();
  expect((await request).postDataJSON()).toMatchObject({ ideaId: "idea-1", platforms: ["YOUTUBE"] });
  await expect(page.getByText(/제작 작업을 시작했습니다/)).toBeVisible();
});

test("configures a workspace budget from the screen", async ({ page }) => {
  await mockApi(page); await page.goto("/#settings");
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
  await page.getByRole("navigation", { name: "운영 메뉴" }).getByRole("link", { name: "사용량·설정" }).click();
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
  await page.goto("/#insights");
  await page.getByText("실험 및 전략 관리", { exact: false }).click();
  const panel = page.getByTestId("experiment-panel");
  await panel.getByLabel("실험 이름", { exact: true }).fill("Duration test");
  await panel.getByLabel("가설", { exact: true }).fill("Longer duration may help");
  await panel.getByRole("button", { name: "실험 초안 생성" }).click();
  await panel.getByRole("button", { name: "실험 시작", exact: true }).click();
  await panel.getByRole("button", { name: "가용 성과로 비교 완료" }).click();
  await expect(panel).toContainText("25.0%"); await expect(panel).toContainText("변경군 우세 가설");
  await expect(panel).toContainText("인과 효과나 통계적 유의성을 주장하지 않습니다");
});

test("separates sidebar pages, restores history and preserves unsaved input", async ({ page }) => {
  await mockApi(page); await page.goto("/#home");
  const nav = page.getByRole("navigation", { name: "운영 메뉴" });
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await expect(page.getByTestId("experiment-panel")).not.toBeVisible();
  await nav.getByRole("link", { name: "콘텐츠", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "콘텐츠" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "콘텐츠", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("검토할 콘텐츠").selectOption("content-1");
  const title = page.getByTestId("review-panel").getByLabel("제목", { exact: true });
  await title.fill("아직 저장하지 않은 제목");
  await nav.getByRole("link", { name: "사용량·설정" }).click();
  await page.getByLabel("일간 중단 (USD)").fill("17.5");
  await page.goBack();
  await expect(title).toBeVisible(); await expect(title).toHaveValue("아직 저장하지 않은 제목");
  await page.goForward(); await expect(page.getByLabel("일간 중단 (USD)")).toHaveValue("17.5");
  await page.reload(); await expect(page.getByRole("heading", { level: 1, name: "사용량·설정" })).toBeVisible();
});

test("opens mobile navigation and keeps page layouts within the viewport", async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/#home");
  await expect(page.getByRole("link", { name: "분석·최적화" })).not.toBeInViewport();
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(page.getByRole("link", { name: "분석·최적화" })).toBeInViewport();
  await page.getByRole("link", { name: "콘텐츠", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "콘텐츠" })).toBeVisible();
  await expect(page.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute("aria-expanded", "false");
  for (const hash of ["home", "channels", "ideas", "content", "calendar", "insights", "settings"]) {
    await page.goto("/#" + hash);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
});

test("recovers a held plan from the calendar without typing an internal identifier", async ({ page }) => {
  await mockApi(page);
  let cancelled = false;
  await page.route("**/publishing/plans", (route) => route.fulfill({ json: cancelled ? [] : [{ id: "held-plan", contentItemId: "content-1", channelId: "channel-1", platform: "YOUTUBE", status: "HELD", scheduledAt: "2099-01-01T00:00:00.000Z", title: "수정으로 보류된 예약", postUrl: null, publishedAt: null, failureReason: null }] }));
  await page.route("**/publishing/plans/held-plan/cancel", (route) => { cancelled = true; return route.fulfill({ json: { ok: true } }); });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/#calendar");
  await expect(page.getByText("수정으로 보류된 예약 · YouTube")).toBeVisible();
  await page.getByRole("button", { name: "예약 변경", exact: true }).click();
  await expect.poll(() => cancelled).toBe(true);
  await expect(page.getByTestId("review-panel")).toBeVisible();
  await expect(page.getByLabel("검토할 콘텐츠")).toHaveValue("content-1");
});

test("confirms an ambiguous publication with local evidence on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route("**/publishing/plans", (route) => route.fulfill({ json: [{ id: "held-plan", contentItemId: "content-1", channelId: "channel-1", platform: "YOUTUBE", status: "HELD", scheduledAt: "2026-11-01T00:00:00.000Z", title: "확인이 필요한 게시", postUrl: null, publishedAt: null, failureReason: null, reconciliationRequired: true }] }));
  let submitted: { externalVideoId: string; evidenceHash: string; idempotencyKey: string } | undefined;
  await page.route("**/publishing/plans/held-plan/reconcile", (route) => {
    submitted = route.request().postDataJSON() as typeof submitted;
    return route.fulfill({ json: { jobId: "confirmation-job", publishPlanId: "held-plan" } });
  });
  await page.goto("/#calendar");
  await expect(page.getByTestId("calendar-panel")).toContainText("공개 완료 미확인");
  const button = page.getByRole("button", { name: "플랫폼 상태 확인", exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel("확인한 게시물 ID", { exact: true }).fill("verified-video-id");
  await page.getByLabel("게시 결과 확인 자료").setInputFiles({ name: "proof.txt", mimeType: "text/plain", buffer: Buffer.from("local-proof") });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole("status")).toContainText("상태 확인 작업을 등록했습니다.");
  expect(submitted?.externalVideoId).toBe("verified-video-id");
  expect(submitted?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(submitted?.idempotencyKey).toBeTruthy();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("distinguishes per-video snapshots, native metrics and collection failure", async ({ page }) => {
  await mockApi(page);
  const base = { metric: "average_view_ratio", status: "AVAILABLE", value: 0.5, unit: "ratio", aggregation: "average", unavailableReason: null, observedAt: "2026-10-05T00:00:00.000Z", revision: 1, mappingVersion: "v2", platform: "YOUTUBE", periodStart: "2026-10-01", periodEnd: "2026-10-05" };
  await page.route("**/analytics/report?**", (route) => route.fulfill({ json: { channelId: "channel-1", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-05T00:00:00.000Z", metrics: [{ ...base, id: "one", title: "첫 영상", externalPostId: "post-one", platformPostId: "one", latest: true }, { ...base, id: "two", title: "둘째 영상", externalPostId: "post-two", platformPostId: "two", latest: false }], partial: false, lastSyncedAt: base.observedAt, lastError: "ANALYTICS_SYNC_FAILED" } }));
  await page.goto("/#insights");
  const panel = page.getByTestId("analytics-panel");
  await expect(panel).toContainText("첫 영상"); await expect(panel).toContainText("둘째 영상");
  await expect(panel).toContainText("이전 스냅샷"); await expect(panel).toContainText("post-two");
  await expect(panel).toContainText("ANALYTICS_SYNC_FAILED"); await expect(panel).toContainText("완주율·노출 수와 다릅니다");
});

test("shows the next analysis condition and policy boundary on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route("**/optimization/channels/channel-1/analysis-status", (route) => route.fulfill({ json: { status: "WAITING_FOR_FRESH_COMPARABLE_DATA", requiredDistinctPosts: 4, maximumComparablePosts: 2, nextCheckAt: "2026-11-19T00:00:00Z" } }));
  await page.goto("/#insights");
  await page.getByLabel("분석할 채널", { exact: true }).selectOption("channel-1");
  const panel = page.getByTestId("optimization-panel");
  await expect(panel).toContainText("비교 가능 2편 · 필요 4편");
  await expect(panel).toContainText("다음 확인");
  await expect(panel).toContainText("정책상 제한되는 파생 분석은 보류");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
