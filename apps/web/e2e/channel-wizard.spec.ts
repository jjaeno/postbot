import { expect, test, type Page } from "@playwright/test";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    displayName: "운영자",
    timezone: "Asia/Seoul"
  },
  workspace: {
    id: "workspace-1",
    name: "개인 워크스페이스",
    slug: "personal",
    role: "OWNER"
  }
};

const channel = (name: string) => ({
  id: "channel-1",
  workspaceId: "workspace-1",
  name,
  slug: "science-today",
  description: "과학 채널 운영 설정",
  topic: "일상에서 발견하는 과학 상식",
  targetAudience: "짧고 신뢰할 수 있는 지식을 원하는 20-40대",
  excludedTopics: ["정치"],
  language: "ko-KR",
  status: "ACTIVE",
  automationMode: "APPROVAL",
  minInventoryCount: 5,
  dailyPublishLimit: 2,
  errorAction: {
    onPolicyFailure: "hold",
    onAssetLicenseUnknown: "hold",
    onConsecutiveFailures: "pause_channel"
  },
  template: {
    name: "기본 9:16 숏폼",
    tone: "질문형 훅",
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
      hookStyle: "질문형 훅",
      captionStyle: "readable",
      metadataRules: {},
      publicSetting: "PUBLIC"
    }
  ],
  collectionRule: {
    keywords: ["과학"],
    excludedKeywords: ["정치"],
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
      status: "PLANNED",
      handle: null,
      displayName: null
    }
  ],
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z"
});

const mockApi = async (page: Page): Promise<void> => {
  let channels: Array<ReturnType<typeof channel>> = [];

  await page.route("**/auth/me", async (route) => {
    await route.fulfill({ json: session });
  });

  await page.route("**/channels", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { name: string };
      channels = [channel(body.name)];
      await route.fulfill({ status: 201, json: channels[0] });
      return;
    }

    await route.fulfill({ json: { channels } });
  });

  await page.route("**/channels/channel-1", async (route) => {
    const body = route.request().postDataJSON() as { name?: string };
    channels = [channel(body.name ?? "오늘의 과학")];
    await route.fulfill({ json: channels[0] });
  });

  await page.route("**/channels/channel-1/pause", async (route) => {
    await route.fulfill({ json: { ...channel("오늘의 과학"), status: "PAUSED" } });
  });

  await page.route("**/channels/channel-1/resume", async (route) => {
    await route.fulfill({ json: channel("오늘의 과학") });
  });
};

test("creates and edits a channel through the eight-step wizard", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "채널 운영 설정" })).toBeVisible();

  await page.getByRole("button", { name: "채널 만들기" }).click();
  await expect(page.getByRole("heading", { name: "기본" })).toBeVisible();

  for (let index = 0; index < 7; index += 1) {
    await page.getByRole("button", { name: "다음" }).click();
  }

  await expect(page.getByText("연결 예정").first()).toBeVisible();
  const createButton = page.locator("form").getByRole("button").last();
  if ((await createButton.count()) > 0) {
    await createButton.click();
  }

  await expect(page.getByRole("heading", { name: "오늘의 과학" })).toBeVisible();
  await expect(page.getByText("연결 예정")).toBeVisible();

  await page.getByRole("button", { name: "설정" }).click();
  await page.getByLabel("채널 이름").fill("오늘의 과학 업데이트");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.getByRole("heading", { name: "오늘의 과학 업데이트" })).toBeVisible();
});
