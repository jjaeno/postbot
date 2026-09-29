import { expect, test, type Page } from "@playwright/test";

const session = {
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
    policy: null as { status: "pass"; findings: never[]; snapshotId: string } | null
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

  await page.route("**/content/content-1/review/policy-check", async (route) => {
    review = { ...review, policy: { status: "pass", findings: [], snapshotId: "snapshot-1" } };
    await route.fulfill({ json: review });
  });

  await page.route("**/content/content-1/review/action", async (route) => {
    const action = route.request().postDataJSON() as {
      action: "approve" | "hold" | "discard" | "schedule";
    };
    review = {
      ...review,
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

  await page.route("**/channels/channel-1", async (route) => {
    const body = route.request().postDataJSON() as { name?: string } | null;
    channels = [channel(body?.name ?? "Science Today", connected)];
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

  for (let index = 0; index < 7; index += 1) {
    await page.getByTestId("wizard-next").click();
  }

  await page.getByTestId("wizard-create").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("Science Today");
  await expect(page.getByTestId("channel-card-channel-1")).toContainText("연결 예정");

  await page.getByTestId("edit-channel-channel-1").click();
  await page.locator("aside input").first().fill("Science Today Updated");
  await page.getByTestId("save-channel-settings").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("Science Today Updated");
});

test("connects and disconnects YouTube with the fake OAuth provider", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await page.getByTestId("connect-youtube-channel-1").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("CONNECTED");
  await expect(page.getByTestId("disconnect-youtube-channel-1")).toBeVisible();

  await page.getByTestId("disconnect-youtube-channel-1").click();
  await expect(page.getByTestId("channel-card-channel-1")).toContainText("연결 예정");
});

test("restores the operating dashboard and calendar after refresh", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByLabel("Operations overview")).toContainText("Needs review");
  await expect(page.getByTestId("calendar-panel")).toContainText("09:00");
  await expect(page.getByText("Reusable rocket")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("calendar-panel")).toContainText("Science Today");
});

test("approves reviewed content through the fake API", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await page.getByLabel("Content item ID").fill("content-1");
  await page.getByRole("button", { name: "Run policy check" }).click();
  await expect(page.getByText("pass", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
});

test("creates a full-auto channel through the fake API", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await page.getByTestId("create-channel").click();
  await page.locator('input[name="name"]').fill("Auto Science");

  for (let index = 0; index < 6; index += 1) {
    await page.getByTestId("wizard-next").click();
  }

  await page.locator('select[name="automationMode"]').selectOption("FULL_AUTO");
  await page.getByTestId("wizard-next").click();

  await page.getByTestId("wizard-create").click();

  await expect(page.getByTestId("channel-card-channel-1")).toContainText("Auto Science");
  await expect(page.getByTestId("channel-card-channel-1")).toContainText("완전 자동형");
});
