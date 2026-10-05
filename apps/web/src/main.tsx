import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Lightbulb,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
  UserPlus
} from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import {
  AuthResponseSchema,
  AnalyticsReportResponseSchema,
  AutomationRunResponseSchema,
  AutomationBudgetResponseSchema,
  AuthSessionSchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  CollectIdeasResponseSchema,
  ContentReviewResponseSchema,
  ContentIdeaListResponseSchema,
  ContentItemListResponseSchema,
  ContentIdeaSchema,
  CreateChannelRequestSchema,
  OAuthCallbackResultSchema,
  OptimizationSuggestionResponseSchema,
  StrategyVersionResponseSchema,
  PublishPlanResponseSchema,
  PublishCalendarItemSchema,
  ReviewPreviewResponseSchema,
  CostReportResponseSchema,
  NotificationResponseSchema,
  PlatformAccountListResponseSchema,
  StartOAuthConnectionResponseSchema,
  type AuthResponse,
  type AnalyticsReportResponse,
  type AutomationRunResponse,
  type AutomationBudgetResponse,
  type AuthSession,
  type ChannelResponse,
  type ContentIdea,
  type ContentItemSummary,
  type ContentReviewResponse,
  type CreateChannelRequest,
  type IdeaStatus,
  type PlatformAccountResponse,
  type Platform
  , type OptimizationSuggestionResponse, type CostReportResponse, type NotificationResponse, type PublishCalendarItem
} from "@postbot/contracts";
import { Button } from "./components/ui/button";
import "./styles.css";

const queryClient = new QueryClient();
const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
const apiBaseUrl = viteEnv["VITE_API_BASE_URL"] ?? "http://localhost:3000";

const csrfFromCookie = (): string | null => {
  const cookie = document.cookie.split("; ").find((item) => item.startsWith("postbot_csrf="));
  return cookie ? decodeURIComponent(cookie.split("=")[1] ?? "") : null;
};

const request = async <Result,>(
  path: string,
  options: RequestInit,
  parser: { parse(value: unknown): Result }
): Promise<Result> => {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  const csrfToken = csrfFromCookie();
  if (csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    credentials: "include"
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  return parser.parse(body);
};

const authMutation = (path: "/auth/login" | "/auth/register", body: object): Promise<AuthResponse> =>
  request(path, { method: "POST", body: JSON.stringify(body) }, AuthResponseSchema);

const fetchMe = (): Promise<AuthSession> => request("/auth/me", { method: "GET" }, AuthSessionSchema);
const fetchChannels = (): Promise<ChannelResponse[]> =>
  request("/channels", { method: "GET" }, ChannelListResponseSchema).then((data) => data.channels);
const fetchPlatformAccounts = (): Promise<PlatformAccountResponse[]> =>
  request("/platform-accounts", { method: "GET" }, PlatformAccountListResponseSchema).then((data) => data.accounts);
const fetchIdeas = (channelId: string, status: IdeaStatus | "ALL"): Promise<ContentIdea[]> => {
  const query = status === "ALL" ? "" : `?status=${status}`;
  return request(`/ideas/channels/${channelId}${query}`, { method: "GET" }, ContentIdeaListResponseSchema).then((data) => data.ideas);
};
const fetchReview = (contentItemId: string): Promise<ContentReviewResponse> =>
  request(`/content/${contentItemId}/review`, { method: "GET" }, ContentReviewResponseSchema);
const fetchContent = (): Promise<ContentItemSummary[]> => request("/content", { method: "GET" }, ContentItemListResponseSchema).then((data) => data.items);
const fetchAutomationRuns = (): Promise<AutomationRunResponse[]> => request("/automation/runs", { method: "GET" }, { parse: (value: unknown) => AutomationRunResponseSchema.array().parse(value) });
const fetchBudgets = (): Promise<AutomationBudgetResponse[]> => request("/automation/budgets", { method: "GET" }, { parse: (value: unknown) => AutomationBudgetResponseSchema.array().parse(value) });
const fetchAnalyticsReport = (channelId: string, platform: string, days: number): Promise<AnalyticsReportResponse> => {
  const end = new Date(); const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return request(`/analytics/report?channelId=${encodeURIComponent(channelId)}&periodStart=${encodeURIComponent(start.toISOString())}&periodEnd=${encodeURIComponent(end.toISOString())}${platform ? `&platform=${platform}` : ""}`, { method: "GET" }, AnalyticsReportResponseSchema);
};
const fetchSuggestions = (channelId: string): Promise<OptimizationSuggestionResponse[]> =>
  request(`/optimization/suggestions?channelId=${encodeURIComponent(channelId)}`, { method: "GET" }, { parse: (value: unknown) => OptimizationSuggestionResponseSchema.array().parse(value) });
const fetchCosts = (): Promise<CostReportResponse> => { const end = new Date(); const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); return request(`/operations/costs?periodStart=${encodeURIComponent(start.toISOString())}&periodEnd=${encodeURIComponent(end.toISOString())}`, { method: "GET" }, CostReportResponseSchema); };
const fetchNotifications = (): Promise<NotificationResponse[]> => request("/operations/notifications", { method: "GET" }, { parse: (value: unknown) => NotificationResponseSchema.array().parse(value) });
const fetchPublishPlans = (): Promise<PublishCalendarItem[]> => request("/publishing/plans", { method: "GET" }, { parse: (value: unknown) => PublishCalendarItemSchema.array().parse(value) });

const requestAbsolute = async <Result,>(
  url: string,
  options: RequestInit,
  parser: { parse(value: unknown): Result }
): Promise<Result> => {
  const response = await fetch(url, { ...options, credentials: "include" });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  return parser.parse(body);
};

const formText = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const platforms: Array<{ value: Platform; label: string }> = [
  { value: "YOUTUBE", label: "YouTube Shorts" },
  { value: "INSTAGRAM", label: "Instagram Reels" },
  { value: "TIKTOK", label: "TikTok" }
];

const statusLabels: Record<string, string> = {
  ACTIVE: "운영 중",
  ALL: "전체",
  APPLIED: "적용됨",
  APPROVED: "승인됨",
  AVAILABLE: "사용 가능",
  CANDIDATE: "후보",
  CANCELLED: "취소됨",
  CONNECTED: "연결됨",
  CRITICAL: "심각",
  DISCARDED: "폐기됨",
  DRAFT: "초안",
  DRAINING: "종료 중",
  ERROR: "오류",
  EXPIRED: "만료됨",
  FAIL: "실패",
  FAILED: "실패",
  HELD: "보류됨",
  INFO: "정보",
  INCONCLUSIVE: "결론 없음",
  IDEA: "아이디어",
  NEEDS_REVIEW: "검토 필요",
  PAUSED: "일시 중지",
  PASS: "통과",
  PENDING: "대기 중",
  PARTIAL: "일부만 사용 가능",
  PLANNED: "연결 예정",
  PROPOSED: "제안됨",
  PUBLISHED: "게시됨",
  PUBLISHING: "게시 중",
  QUEUED: "대기열 등록",
  REJECTED: "제외됨",
  RETRY_WAIT: "재시도 대기",
  REVIEW_REQUIRED: "검토 필요",
  REVOKED: "연결 해제됨",
  RUNNING: "실행 중",
  SCHEDULED: "예약됨",
  SHORTLISTED: "선정됨",
  SKIPPED: "건너뜀",
  SUCCEEDED: "완료",
  STOPPED: "중단됨",
  UNAVAILABLE: "사용 불가",
  UNKNOWN: "미확인",
  USED: "사용됨",
  VALIDATING: "검증 중",
  VERIFIED: "확인됨",
  WARNING: "주의",
  block: "차단",
  missing: "없음",
  pass: "통과",
  pending: "대기 중",
  ready: "준비됨",
  review: "검토 필요",
  warning: "주의"
};

const stageLabels: Record<string, string> = {
  COLLECT: "소재 수집",
  SCRIPT: "대본 생성",
  ASSET: "에셋 준비",
  TTS: "음성 생성",
  RENDER: "영상 렌더링",
  POLICY: "정책 검사",
  PUBLISH: "게시"
};

const statusLabel = (status: string): string => statusLabels[status] ?? status;
const stageLabel = (stage: string): string => stageLabels[stage] ?? stage;
const platformLabel = (platform: string | null | undefined): string =>
  platform ? platforms.find((item) => item.value === platform)?.label ?? platform : "전체 플랫폼";
const localDateTimeValue = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

type WizardForm = {
  name: string;
  topic: string;
  audience: string;
  language: string;
  platforms: Platform[];
  keywords: string;
  excludedKeywords: string;
  recencyHours: number;
  collectionFrequencyMinutes: number;
  templateName: string;
  hookStyle: string;
  ctaStyle: string;
  durationMinSeconds: number;
  durationMaxSeconds: number;
  aspectRatio: "9:16";
  resolution: "1080x1920";
  timezone: string;
  days: string[];
  times: string;
  minContentInventory: number;
  automationMode: "APPROVAL" | "FULL_AUTO";
  requiresPolicyPass: boolean;
  requiresRightsCheck: boolean;
  blocksSensitiveTopics: boolean;
  maxDailyPosts: number;
};

const defaultWizardValues: WizardForm = {
  name: "오늘의 과학",
  topic: "일상에서 발견하는 과학 상식",
  audience: "짧고 신뢰할 수 있는 지식을 원하는 20-40대",
  language: "ko-KR",
  platforms: ["YOUTUBE"],
  keywords: "과학,우주,기술",
  excludedKeywords: "정치,투자,의학 조언",
  recencyHours: 72,
  collectionFrequencyMinutes: 240,
  templateName: "기본 9:16 숏폼",
  hookStyle: "첫 3초에 질문형 훅",
  ctaStyle: "출처 확인 유도",
  durationMinSeconds: 35,
  durationMaxSeconds: 55,
  aspectRatio: "9:16",
  resolution: "1080x1920",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  days: ["1", "3", "5"],
  times: "09:00,18:00",
  minContentInventory: 5,
  automationMode: "APPROVAL",
  requiresPolicyPass: true,
  requiresRightsCheck: true,
  blocksSensitiveTopics: true,
  maxDailyPosts: 2
};

const splitCsv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const buildChannelInput = (values: WizardForm): CreateChannelRequest => ({
    name: values.name,
    description: `${values.topic} 채널 운영 설정`,
    topic: values.topic,
    targetAudience: values.audience,
    excludedTopics: splitCsv(values.excludedKeywords),
    language: values.language,
    platforms: values.platforms,
    template: {
      name: values.templateName,
      tone: values.hookStyle,
      voiceProfile: "neutral-ko",
      subtitleStyle: {
        mode: "readable",
        cta: values.ctaStyle
      },
      visualStyle: {
        aspectRatio: values.aspectRatio,
        resolution: values.resolution
      },
      aiStockRatio: 0.5
    },
    outputProfiles: values.platforms.map((platform) => ({
      platform,
      minDurationSeconds: Number(values.durationMinSeconds),
      maxDurationSeconds: Number(values.durationMaxSeconds),
      hookStyle: values.hookStyle,
      captionStyle: "readable",
      metadataRules: {
        language: values.language,
        aspectRatio: values.aspectRatio,
        resolution: values.resolution
      },
      publicSetting: "PUBLIC"
    })),
    collectionRule: {
      keywords: splitCsv(values.keywords),
      excludedKeywords: splitCsv(values.excludedKeywords),
      allowedSources: [],
      excludedSources: [],
      recencyHours: Number(values.recencyHours),
      collectionFrequencyMinutes: Number(values.collectionFrequencyMinutes)
    },
    scheduleRules: values.platforms.flatMap((platform) =>
      values.days.flatMap((day) =>
        splitCsv(values.times).map((time) => ({
          platform,
          dayOfWeek: Number(day),
          timeOfDayLocal: time,
          timezone: values.timezone,
          maxPosts: 1
        }))
      )
    ),
    automation: {
      mode: values.automationMode,
      minInventoryCount: Number(values.minContentInventory),
      dailyPublishLimit: Number(values.maxDailyPosts),
      errorAction: {
        onPolicyFailure: values.requiresPolicyPass ? "hold" : "regenerate",
        onAssetLicenseUnknown: "hold",
        onConsecutiveFailures: values.blocksSensitiveTopics || values.requiresRightsCheck ? "pause_channel" : "notify_only"
      }
    }
  });

const Field = ({
  label,
  type = "text",
  registration,
  helper
}: {
  label: string;
  type?: string;
  registration: UseFormRegisterReturn;
  helper?: string;
}): ReactElement => (
  <label className="block text-sm font-medium text-foreground">
    {label}
    <input
      className="mt-2 h-11 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-primary"
      type={type}
      {...registration}
    />
    {helper ? <span className="mt-1 block text-xs text-muted-foreground">{helper}</span> : null}
  </label>
);

const AuthForm = (): ReactElement => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => {
      const payload =
        mode === "login"
          ? {
              email: formText(formData, "email"),
              password: formText(formData, "password")
            }
          : {
              email: formText(formData, "email"),
              password: formText(formData, "password"),
              displayName: formText(formData, "displayName"),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            };
      return authMutation(mode === "login" ? "/auth/login" : "/auth/register", payload);
    },
    onSuccess: (data) => {
      setFormError(null);
      queryClient.setQueryData(["auth", "me"], data.session);
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "로그인할 수 없습니다.")
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    mutation.mutate(new FormData(event.currentTarget));
  };

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-3 text-primary">
        <ShieldCheck aria-hidden="true" className="h-7 w-7" />
        <span className="text-lg font-semibold">Postbot</span>
      </div>
      <div className="mb-6 flex rounded-md border border-border p-1">
        <button
          className={`h-10 flex-1 rounded text-sm font-medium ${mode === "login" ? "bg-foreground text-white" : "text-muted-foreground"}`}
          onClick={() => setMode("login")}
          type="button"
        >
          로그인
        </button>
        <button
          className={`h-10 flex-1 rounded text-sm font-medium ${mode === "register" ? "bg-foreground text-white" : "text-muted-foreground"}`}
          onClick={() => setMode("register")}
          type="button"
        >
          회원가입
        </button>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        {mode === "register" ? <LegacyField label="이름" name="displayName" /> : null}
        <LegacyField label="이메일" name="email" type="email" />
        <LegacyField
          label="비밀번호"
          name="password"
          type="password"
          helper={mode === "register" ? "12자 이상으로 입력해 주세요." : undefined}
        />
        {formError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        ) : null}
        <Button className="w-full gap-2" disabled={mutation.isPending} type="submit">
          {mode === "login" ? (
            <LogIn aria-hidden="true" className="h-4 w-4" />
          ) : (
            <UserPlus aria-hidden="true" className="h-4 w-4" />
          )}
          {mode === "login" ? "로그인" : "회원가입"}
        </Button>
      </form>
    </section>
  );
};

const LegacyField = ({
  label,
  name,
  type = "text",
  helper
}: {
  label: string;
  name: string;
  type?: string;
  helper?: string;
}): ReactElement => (
  <label className="block text-sm font-medium text-foreground">
    {label}
    <input
      className="mt-2 h-11 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-primary"
      name={name}
      required
      type={type}
    />
    {helper ? <span className="mt-1 block text-xs text-muted-foreground">{helper}</span> : null}
  </label>
);

const Dashboard = ({ session }: { session: AuthSession }): ReactElement => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelResponse | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("content"));
  const [insightChannelId, setInsightChannelId] = useState("");
  const [insightPlatform, setInsightPlatform] = useState("");
  const [insightDays, setInsightDays] = useState(7);
  const oauthResult = new URLSearchParams(window.location.search).get("oauth");
  useEffect(() => {
    if (!oauthResult) return;
    const channelId = new URLSearchParams(window.location.search).get("channel") ?? sessionStorage.getItem("postbot-oauth-channel");
    if (channelId) document.getElementById(`channel-${channelId}`)?.scrollIntoView({ block: "center" });
  }, [oauthResult]);

  const logout = useMutation({
    mutationFn: () => request("/auth/logout", { method: "POST" }, { parse: () => ({ ok: true }) }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["auth", "me"] });
    },
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : "로그아웃할 수 없습니다.")
  });

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: fetchChannels,
    enabled: Boolean(session)
  });
  const platformAccounts = useQuery({
    queryKey: ["platform-accounts"],
    queryFn: fetchPlatformAccounts,
    enabled: Boolean(session)
  });
  const content = useQuery({ queryKey: ["content"], queryFn: fetchContent, enabled: Boolean(session), refetchInterval: 5_000 });
  const automationRuns = useQuery({ queryKey: ["automation-runs"], queryFn: fetchAutomationRuns, enabled: Boolean(session), refetchInterval: 5_000 });
  useEffect(() => { if (!insightChannelId && channels.data?.[0]) setInsightChannelId(channels.data[0].id); }, [channels.data, insightChannelId]);
  const analytics = useQuery({ queryKey: ["analytics", insightChannelId, insightPlatform, insightDays], queryFn: () => fetchAnalyticsReport(insightChannelId, insightPlatform, insightDays), enabled: Boolean(insightChannelId) });
  const suggestions = useQuery({ queryKey: ["optimization-suggestions", insightChannelId], queryFn: () => fetchSuggestions(insightChannelId), enabled: Boolean(insightChannelId) });
  const costs = useQuery({ queryKey: ["operations-costs"], queryFn: fetchCosts, enabled: Boolean(session), retry: false });
  const budgets = useQuery({ queryKey: ["automation-budgets"], queryFn: fetchBudgets, enabled: Boolean(session) });
  const notifications = useQuery({ queryKey: ["operations-notifications"], queryFn: fetchNotifications, enabled: Boolean(session), refetchInterval: 30_000 });
  const publishPlans = useQuery({ queryKey: ["publish-plans"], queryFn: fetchPublishPlans, enabled: Boolean(session), refetchInterval: 30_000 });

  return (
    <main className="min-h-screen bg-background px-5 py-6 text-foreground md:px-8">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <ShieldCheck aria-hidden="true" className="h-5 w-5" />
              <span className="text-sm font-semibold">Postbot</span>
            </div>
            <h1 className="text-2xl font-semibold">채널 운영 설정</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {session.workspace.name} · {session.user.displayName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" data-testid="create-channel" onClick={() => setWizardOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              채널 만들기
            </Button>
            <Button className="gap-2 bg-foreground" onClick={() => logout.mutate()} disabled={logout.isPending}>
              <LogOut aria-hidden="true" className="h-4 w-4" />
              로그아웃
            </Button>
          </div>
        </header>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {oauthResult ? <p role={oauthResult === "connected" ? "status" : "alert"} className="rounded-md border border-border bg-white p-3 text-sm">{oauthResult === "connected" ? "플랫폼 계정 연결이 완료되었습니다. 채널의 연결 상태를 확인해 주세요." : "연결을 완료하지 못했습니다. 권한 거절, 연결 만료 또는 제공자 설정을 확인한 뒤 원래 채널에서 다시 연결해 주세요."}</p> : null}

        <nav aria-label="운영 메뉴" className="flex flex-wrap gap-2 text-sm">{[["home", "홈"], ["channels", "채널"], ["ideas", "아이디어"], ["content", "콘텐츠"], ["calendar", "캘린더"], ["insights", "분석·최적화"], ["settings", "사용량·설정"]].map(([id, label]) => <a className="rounded border border-border bg-white px-3 py-2 hover:border-primary" href={`#${id}`} key={id}>{label}</a>)}</nav>
        {[channels, platformAccounts, content, automationRuns, analytics, suggestions, costs, budgets, notifications, publishPlans].some((query) => query.isError) ? <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">일부 운영 정보를 불러오지 못했습니다. 표시되지 않은 항목은 데이터 없음이나 비용 0을 뜻하지 않습니다. <Button onClick={() => void queryClient.invalidateQueries()}>다시 불러오기</Button></p> : null}
        <div id="home"><OperationsOverview channels={channels.data ?? []} content={content.data ?? []} /></div>
        <HomeActions channels={channels.data ?? []} content={content.data ?? []} plans={publishPlans.data ?? []} accounts={platformAccounts.data ?? []} budgets={budgets.data ?? []} />
        <AutomationPanel runs={automationRuns.data ?? []} isLoading={automationRuns.isLoading} />
        <label id="insights" className="max-w-sm text-sm font-medium">분석할 채널<select className="mt-2 h-10 w-full rounded-md border border-border px-3" value={insightChannelId} onChange={(event) => setInsightChannelId(event.target.value)}>{(channels.data ?? []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <AnalyticsPanel report={analytics.data} isLoading={analytics.isLoading} />
        <div className="flex flex-wrap gap-3 text-sm"><label>분석 플랫폼<select className="ml-2 rounded border p-2" value={insightPlatform} onChange={(event) => setInsightPlatform(event.target.value)}><option value="">전체</option>{(["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const).map((platform) => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}</select></label><label>분석 기간<select className="ml-2 rounded border p-2" value={insightDays} onChange={(event) => setInsightDays(Number(event.target.value))}><option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option></select></label></div>
        <OptimizationPanel suggestions={suggestions.data ?? []} isLoading={suggestions.isLoading} />
        <StrategyPanel channelId={insightChannelId} />
        <div id="settings"><OperationsPanel costs={costs.data} notifications={notifications.data ?? []} isLoading={costs.isLoading || notifications.isLoading} /></div>
        <BudgetPanel budgets={budgets.data ?? []} channels={channels.data ?? []} isLoading={budgets.isLoading} onError={setError} />

        <div id="channels" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ChannelList
            accounts={platformAccounts.data ?? []}
            channels={channels.data ?? []}
            isLoading={channels.isLoading}
            onEdit={setEditing}
            onError={setError}
          />
          <EditPanel channel={editing} onClose={() => setEditing(null)} onError={setError} />
        </div>
        <div id="ideas"><IdeasPanel channels={channels.data ?? []} onError={setError} /></div>
        <ContentPanel channels={channels.data ?? []} content={content.data ?? []} isLoading={content.isLoading} onError={setError} selectedId={selectedContentId} onSelect={(id) => { setSelectedContentId(id); const url = new URL(window.location.href); url.searchParams.set("content", id); window.history.replaceState({}, "", url); }} />
        <div id="calendar"><CalendarPanel channels={channels.data ?? []} plans={publishPlans.data ?? []} onSelect={(id) => { setSelectedContentId(id); const url = new URL(window.location.href); url.searchParams.set("content", id); window.history.replaceState({}, "", url); }} /></div>
        <ReviewPanel accounts={platformAccounts.data ?? []} content={content.data ?? []} contentItemId={selectedContentId} onSelectContent={(id) => { setSelectedContentId(id); const url = new URL(window.location.href); url.searchParams.set("content", id); window.history.replaceState({}, "", url); }} onError={setError} />
      </section>
      {wizardOpen ? <ChannelWizard onClose={() => setWizardOpen(false)} onError={setError} /> : null}
    </main>
  );
};

const AutomationPanel = ({ runs, isLoading }: { runs: AutomationRunResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const control = useMutation({
    mutationFn: ({ runId, action, stage, platform }: { runId: string; action: "pause" | "resume" | "retry" | "kill"; stage?: string; platform?: Platform | null }) => request(`/automation/runs/${runId}/control`, { method: "POST", body: JSON.stringify({ action, stage, platform: platform ?? undefined }) }, AutomationRunResponseSchema),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ["automation-runs"] }); void cache.invalidateQueries({ queryKey: ["content"] }); }
  });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="automation-panel">
    <div><h2 className="text-lg font-semibold">자동화 운영</h2><p className="mt-1 text-sm text-muted-foreground">실행 상태, 최근 신호, 실패 단계와 운영자 보류 상태를 확인합니다.</p></div>
    {control.error ? <p role="alert" className="mt-3 text-sm text-red-700">{control.error.message}</p> : null}
    {runs.filter((run) => run.createdAt).map((run) => <p className="mt-3 text-sm" key={`elapsed-${run.id}`}>{statusLabel(run.status)} · {run.steps.filter((step) => step.status === "SUCCEEDED").length}/{run.steps.length}단계 완료 · {run.finishedAt ? "총 소요" : "경과"} {Math.max(0, Math.floor((new Date(run.finishedAt ?? Date.now()).getTime() - new Date(run.createdAt ?? Date.now()).getTime()) / 60_000))}분</p>)}
    {runs.map((run) => <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" key={`actions-${run.id}`}><span>{stageLabel(run.steps.find((step) => ["RUNNING", "QUEUED", "HELD", "FAILED"].includes(step.status))?.stage ?? "COLLECT")} · 다음 실행 {run.nextRunAt ? new Date(run.nextRunAt).toLocaleString() : "미정"}</span>{run.steps.filter((step) => ["FAILED", "HELD"].includes(step.status)).map((step) => <div className="rounded border border-border p-2" key={`${step.stage}-${step.platform}`}><p>{platformLabel(step.platform)} {stageLabel(step.stage)}: {step.errorMessage ?? step.errorCode ?? run.pausedReason ?? "확인 필요"}</p><p className="text-xs text-muted-foreground">원인을 해결한 뒤 이 단계만 다시 실행할 수 있습니다. 예산 부족은 사용량·설정, 승인 대기는 콘텐츠 검수에서 해결하세요.</p><Button disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "retry", stage: step.stage, platform: step.platform })}>이 단계 재시도</Button></div>)}{!["SUCCEEDED", "CANCELLED"].includes(run.status) ? <Button className="bg-foreground" disabled={control.isPending} onClick={() => { if (window.confirm("이 제작을 취소할까요? 이미 진행 중인 작업은 중단 요청을 받으며 완료된 결과는 유지됩니다.")) control.mutate({ runId: run.id, action: "kill" }); }}>제작 취소</Button> : null}</div>)}
    {isLoading ? <p className="mt-4 text-sm text-muted-foreground">자동화 실행을 불러오는 중입니다.</p> : runs.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">아직 자동화 실행 기록이 없습니다.</p> : <div className="mt-4 grid gap-2">{runs.slice(0, 10).map((run) => <article className="rounded-md border border-border p-3 text-sm" key={run.id}><div className="flex items-center justify-between gap-3"><span className="font-medium">{statusLabel(run.status)}</span><span className="text-xs text-muted-foreground">{run.heartbeatAt ?? "최근 신호 없음"}</span></div><p className="mt-2 text-xs text-muted-foreground">{run.lastErrorCode ?? "오류 없음"}</p><div className="mt-2 flex flex-wrap gap-1">{run.steps.map((step) => <span className="rounded bg-muted px-2 py-1 text-xs" key={`${step.stage}-${step.platform ?? "COMMON"}`}>{stageLabel(step.stage)}: {statusLabel(step.status)}</span>)}</div>{["RUNNING", "QUEUED"].includes(run.status) ? <Button className="mt-3 h-8" disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "pause" })}>일시 중지</Button> : run.status === "PAUSED" ? <Button className="mt-3 h-8" disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "resume" })}>다시 시작</Button> : null}</article>)}</div>}
  </section>;
};

const AnalyticsPanel = ({ report, isLoading }: { report: AnalyticsReportResponse | undefined; isLoading: boolean }): ReactElement => <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="analytics-panel">
  <div><h2 className="text-lg font-semibold">성과 분석</h2><p className="mt-1 text-sm text-muted-foreground">최근 7일간 플랫폼별로 정규화한 성과 지표입니다.</p></div>
  {isLoading ? <p className="mt-4 text-sm text-muted-foreground">성과 지표를 불러오는 중입니다.</p> : !report || report.metrics.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">이 기간에 동기화된 지표가 없습니다.</p> : <><div className="mt-4 grid gap-2 md:grid-cols-2">{report.metrics.map((metric) => <article className="rounded-md border border-border p-3 text-sm" key={`${metric.metric}-${metric.observedAt}`}><p className="font-medium">{metric.metric}</p><p className="mt-1 text-lg">{metric.status === "AVAILABLE" ? `${metric.value ?? 0} ${metric.unit ?? ""}` : "사용할 수 없음"}</p><p className="mt-1 text-xs text-muted-foreground">{metric.unavailableReason ?? `${metric.aggregation ?? "원본"} · ${metric.observedAt}`}</p></article>)}</div><p className="mt-3 text-xs text-muted-foreground">{report.partial ? "일부 데이터 또는 사용할 수 없는 지표가 포함되어 있습니다." : "반환된 모든 지표를 사용할 수 있습니다."} 마지막 동기화: {report.lastSyncedAt ?? "기록 없음"}</p></>}
</section>;

const OptimizationPanel = ({ suggestions, isLoading }: { suggestions: OptimizationSuggestionResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const action = useMutation({ mutationFn: ({ id, next }: { id: string; next: "approve" | "reject" | "apply" }) => request(`/optimization/suggestions/${id}/action`, { method: "POST", body: JSON.stringify({ action: next }) }, OptimizationSuggestionResponseSchema), onSuccess: () => { void cache.invalidateQueries({ queryKey: ["optimization-suggestions"] }); void cache.invalidateQueries({ queryKey: ["strategy-versions"] }); } });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="optimization-panel"><div><h2 className="text-lg font-semibold">최적화 제안</h2><p className="mt-1 text-sm text-muted-foreground">상관관계 기반 가설과 근거, 승인 이력, 안전하게 되돌릴 수 있는 전략 변경을 보여줍니다.</p></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">최적화 제안을 불러오는 중입니다.</p> : suggestions.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">아직 제안이 없습니다. 먼저 분석 데이터를 동기화하고 비교 집단을 생성해 주세요.</p> : <div className="mt-4 grid gap-2">{suggestions.map((suggestion) => <article className="rounded-md border border-border p-3 text-sm" key={suggestion.id}><div className="flex items-center justify-between gap-2"><p className="font-medium">{suggestion.title}</p><span className="rounded bg-muted px-2 py-1 text-xs">{statusLabel(suggestion.status)}</span></div><p className="mt-2 text-muted-foreground">{suggestion.rationale}</p><p className="mt-2 text-xs text-muted-foreground">표본: {suggestion.sampleSize} · 신뢰도: {suggestion.confidenceScore ?? "미확정"} · 만료: {suggestion.expiresAt ?? "없음"}</p>{suggestion.status === "PENDING" ? <div className="mt-3 flex gap-2"><Button className="h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "approve" })}>승인</Button><Button className="h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "reject" })}>거절</Button></div> : suggestion.status === "APPROVED" ? <Button className="mt-3 h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "apply" })}>변경 불가 전략으로 적용</Button> : null}</article>)}</div>}</section>;
};

const StrategyPanel = ({ channelId }: { channelId: string }): ReactElement => {
  const cache = useQueryClient();
  const versions = useQuery({ queryKey: ["strategy-versions", channelId], enabled: Boolean(channelId), queryFn: () => request(`/optimization/channels/${channelId}/strategies`, { method: "GET" }, { parse: (value: unknown) => StrategyVersionResponseSchema.array().parse(value) }) });
  const rollback = useMutation({ mutationFn: (version: number) => request(`/optimization/channels/${channelId}/rollback/${version}`, { method: "POST", body: "{}" }, { parse: () => ({ ok: true }) }), onSuccess: () => void cache.invalidateQueries({ queryKey: ["strategy-versions", channelId] }) });
  return <section className="rounded border border-border bg-white p-5"><h2 className="text-lg font-semibold">전략 적용 이력·되돌리기</h2><p className="mt-1 text-sm text-muted-foreground">선택한 전략은 이후 제작에만 적용됩니다. 기존 예약은 그대로 유지됩니다. 실험은 아직 제작 자동 배정·결과 비교를 제공하지 않습니다.</p>{versions.isError ? <p role="alert">전략 이력을 불러오지 못했습니다.</p> : versions.data?.map((version, index) => <div key={version.version} className="mt-3 flex items-center justify-between gap-2 text-sm"><span>버전 {version.version} · {version.name} · {index === 0 ? "현재 적용" : "이전 전략"}</span>{index > 0 ? <Button disabled={rollback.isPending} onClick={() => { if (window.confirm("이 전략으로 이후 제작 설정을 되돌릴까요?")) rollback.mutate(version.version); }}>이 전략으로 되돌리기</Button> : null}</div>)}{rollback.error ? <p role="alert">{rollback.error.message}</p> : null}{rollback.isSuccess ? <p role="status">전략을 복원했습니다. 다음 제작부터 반영됩니다.</p> : null}</section>;
};

const OperationsPanel = ({ costs, notifications, isLoading }: { costs: CostReportResponse | undefined; notifications: NotificationResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const acknowledge = useMutation({ mutationFn: (id: string) => request(`/operations/notifications/${id}/acknowledge`, { method: "POST" }, NotificationResponseSchema), onSuccess: () => void cache.invalidateQueries({ queryKey: ["operations-notifications"] }) });
return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="operations-panel"><div><h2 className="text-lg font-semibold">운영 비용 및 알림</h2><p className="mt-1 text-sm text-muted-foreground">원장과 대조한 비용 합계와 앱 내 운영 알림입니다.</p></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">운영 데이터를 불러오는 중입니다.</p> : <><div className="mt-4 grid gap-2 md:grid-cols-4"><article className="rounded border border-border p-3 text-sm"><p>예상 비용</p><p className="mt-1 text-lg">{costs?.estimated ?? "조회 실패"} {costs?.currency ?? "USD"}</p></article><article className="rounded border border-border p-3 text-sm"><p>실제 비용</p><p className="mt-1 text-lg">{costs?.actual ?? "조회 실패"} {costs?.currency ?? "USD"}</p></article><article className="rounded border border-border p-3 text-sm"><p>환급</p><p className="mt-1 text-lg">{costs?.credit ?? "조회 실패"}</p></article><article className="rounded border border-border p-3 text-sm"><p>원장 대조</p><p className="mt-1 text-lg">{!costs ? "조회 실패" : costs.reconciled ? "일치" : `차이 ${costs.discrepancy}`}</p></article></div><div className="mt-4 grid gap-2">{notifications.length === 0 ? <p className="text-sm text-muted-foreground">운영 알림이 없습니다.</p> : notifications.slice(0, 10).map((notification) => <article className="flex items-center justify-between gap-3 rounded border border-border p-3 text-sm" key={notification.id}><span>{statusLabel(notification.severity)} · {notification.eventKey}</span>{notification.acknowledgedAt ? <span className="text-xs text-muted-foreground">확인함</span> : <Button className="h-8" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(notification.id)}>확인</Button>}</article>)}</div></>}</section>;
};

const BudgetPanel = ({ budgets, channels, isLoading, onError }: { budgets: AutomationBudgetResponse[]; channels: ChannelResponse[]; isLoading: boolean; onError: (message: string) => void }): ReactElement => {
  const cache = useQueryClient();
  const [channelId, setChannelId] = useState("");
  const [dailySoft, setDailySoft] = useState("20");
  const [dailyHard, setDailyHard] = useState("25");
  const [monthlySoft, setMonthlySoft] = useState("80");
  const [monthlyHard, setMonthlyHard] = useState("100");
  const selected = budgets.find((budget) => (budget.channelId ?? "") === channelId);
  useEffect(() => {
    if (!selected) return;
    setDailySoft(selected.dailySoftLimit?.toString() ?? ""); setDailyHard(selected.dailyHardLimit?.toString() ?? "");
    setMonthlySoft(selected.monthlySoftLimit?.toString() ?? ""); setMonthlyHard(selected.monthlyHardLimit?.toString() ?? "");
  }, [selected?.id, selected?.updatedAt]);
  const numberOrNull = (value: string): number | null => value.trim() === "" ? null : Number(value);
  const save = useMutation({
    mutationFn: () => request("/automation/budgets", { method: "POST", body: JSON.stringify({ channelId: channelId || null, currency: "USD", dailySoftLimit: numberOrNull(dailySoft), dailyHardLimit: numberOrNull(dailyHard), monthlySoftLimit: numberOrNull(monthlySoft), monthlyHardLimit: numberOrNull(monthlyHard) }) }, AutomationBudgetResponseSchema),
    onSuccess: () => { onError(""); void cache.invalidateQueries({ queryKey: ["automation-budgets"] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "예산을 저장하지 못했습니다.")
  });
  const fields: Array<{ label: string; value: string; setValue: (next: string) => void }> = [
    { label: "일간 알림", value: dailySoft, setValue: setDailySoft }, { label: "일간 중단", value: dailyHard, setValue: setDailyHard },
    { label: "월간 알림", value: monthlySoft, setValue: setMonthlySoft }, { label: "월간 중단", value: monthlyHard, setValue: setMonthlyHard }
  ];
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="budget-panel"><div><h2 className="text-lg font-semibold">자동화 예산</h2><p className="mt-1 text-sm text-muted-foreground">채널별 예산이 있으면 전체 예산보다 우선합니다. 비용 단가를 확인할 수 없는 작업은 0원 처리하지 않고 보류됩니다.</p></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">예산을 불러오는 중입니다.</p> : <div className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-sm font-medium">적용 범위<select className="mt-1 h-10 w-full rounded border border-border px-3" value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">워크스페이스 전체</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>{fields.map((field) => <label className="text-sm font-medium" key={field.label}>{field.label} (USD)<input className="mt-1 h-10 w-full rounded border border-border px-3" min="0" step="0.01" type="number" value={field.value} onChange={(event) => field.setValue(event.target.value)} /></label>)}<div className="flex items-end"><Button className="h-10" disabled={save.isPending} onClick={() => save.mutate()}>예산 저장</Button></div></div>}</section>;
};

const OperationsOverview = ({ channels, content }: { channels: ChannelResponse[]; content: ContentItemSummary[] }): ReactElement => {
  const active = channels.filter((channel) => channel.status === "ACTIVE").length;
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="운영 현황">
    {[{ label: "운영 중인 채널", value: active }, { label: "검토 필요", value: content.filter((item) => item.status === "REVIEW_REQUIRED").length }, { label: "예약 준비 완료", value: content.filter((item) => item.status === "APPROVED").length }, { label: "주간 게시 슬롯", value: channels.flatMap((channel) => channel.scheduleRules).reduce((total, rule) => total + rule.maxPosts, 0) }].map((metric) => <article className="rounded-md border border-border bg-white p-4 shadow-sm" key={metric.label}><p className="text-sm text-muted-foreground">{metric.label}</p><p className="mt-2 text-2xl font-semibold">{metric.value}</p></article>)}
  </section>;
};

const HomeActions = ({ channels, content, plans, accounts, budgets }: { channels: ChannelResponse[]; content: ContentItemSummary[]; plans: PublishCalendarItem[]; accounts: PlatformAccountResponse[]; budgets: AutomationBudgetResponse[] }): ReactElement => {
  const today = new Date().toLocaleDateString();
  const todaysPlans = plans.filter((plan) => new Date(plan.scheduledAt).toLocaleDateString() === today);
  const next = plans.filter((plan) => plan.status === "SCHEDULED" && new Date(plan.scheduledAt) > new Date()).sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))[0];
  const lowStock = channels.filter((channel) => content.filter((item) => item.channelId === channel.id && ["GENERATING", "REVIEW_REQUIRED", "APPROVED", "SCHEDULED"].includes(item.status)).length < channel.minInventoryCount);
  const disconnected = channels.filter((channel) => channel.outputProfiles.some((profile) => !accounts.some((account) => account.channelId === channel.id && account.platform === profile.platform && account.status === "CONNECTED")));
  const unbudgeted = channels.filter((channel) => !budgets.some((budget) => budget.channelId === channel.id || budget.channelId === null));
  return <section className="rounded border border-border bg-white p-5 text-sm"><h2 className="text-lg font-semibold">오늘의 다음 행동</h2><p className="mt-2">오늘 예약 {todaysPlans.filter((plan) => plan.status === "SCHEDULED").length} · 성공 {todaysPlans.filter((plan) => plan.status === "PUBLISHED").length} · 실패 {todaysPlans.filter((plan) => plan.status === "FAILED").length}</p><p>다음 게시: {next ? `${next.title} · ${new Date(next.scheduledAt).toLocaleString()}` : "예약 없음"}</p><div className="mt-3 flex flex-wrap gap-2"><a className="rounded border px-3 py-2" href="#content">검수·승인하기</a><a className="rounded border px-3 py-2" href="#ideas">재고 부족 {lowStock.length}채널 · 소재로 제작</a><a className="rounded border px-3 py-2" href="#channels">계정 연결 확인 {disconnected.length}채널</a><a className="rounded border px-3 py-2" href="#settings">예산 미설정 {unbudgeted.length}채널</a><a className="rounded border px-3 py-2" href="#calendar">게시 결과·예약 확인</a></div></section>;
};

const ContentPanel = ({ channels, content, isLoading, onError, selectedId, onSelect }: { channels: ChannelResponse[]; content: ContentItemSummary[]; isLoading: boolean; onError: (error: string) => void; selectedId: string | null; onSelect: (id: string) => void }): ReactElement => {
  const retry = useQueryClient();
  const [search, setSearch] = useState(""); const [channelFilter, setChannelFilter] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [platformFilter, setPlatformFilter] = useState("");
  const filtered = content.filter((item) => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (!channelFilter || item.channelId === channelFilter) && (!statusFilter || item.status === statusFilter) && (!platformFilter || item.platforms.some((platform) => platform === platformFilter)));
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">콘텐츠 운영</h2><p className="mt-1 text-sm text-muted-foreground">항목을 선택하면 아래 검토 화면으로 바로 이동합니다.</p></div><Button className="bg-foreground" onClick={() => { onError(""); void retry.invalidateQueries({ queryKey: ["content"] }); }}>다시 불러오기</Button></div><div className="mt-3 flex flex-wrap gap-2"><label className="text-sm">검색<input aria-label="콘텐츠 검색" className="ml-2 rounded border p-2" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="text-sm">채널<select aria-label="콘텐츠 채널" className="ml-2 rounded border p-2" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="">전체</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label className="text-sm">상태<select aria-label="콘텐츠 상태" className="ml-2 rounded border p-2" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">전체</option>{[...new Set(content.map((item) => item.status))].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label className="text-sm">플랫폼<select aria-label="콘텐츠 플랫폼" className="ml-2 rounded border p-2" value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}><option value="">전체</option>{(["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const).map((platform) => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}</select></label></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">콘텐츠를 불러오는 중입니다.</p> : filtered.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">조건에 맞는 콘텐츠가 없습니다. 필터를 변경하거나 아이디어에서 제작을 시작해 주세요.</p> : <div className="mt-4 grid gap-2">{filtered.map((item) => <button className={`flex items-center justify-between rounded-md border p-3 text-left text-sm ${selectedId === item.id ? "border-primary" : "border-border"}`} key={item.id} onClick={() => { onSelect(item.id); document.getElementById("content")?.scrollIntoView({ block: "start" }); }} type="button"><span><span className="font-medium">{item.title}</span><span className="ml-2 text-muted-foreground">{statusLabel(item.status)}</span></span><span className="text-xs text-muted-foreground">{item.renderReady ? "렌더링 완료" : "렌더링 대기"}</span></button>)}</div>}</section>;
};

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;
const CalendarPanel = ({ channels, plans, onSelect }: { channels: ChannelResponse[]; plans: PublishCalendarItem[]; onSelect: (id: string) => void }): ReactElement => {
  const cache = useQueryClient();
  const change = useMutation({ mutationFn: (plan: PublishCalendarItem) => request(`/publishing/plans/${plan.id}/cancel`, { method: "POST", body: "{}" }, { parse: () => ({ ok: true }) }), onSuccess: (_, plan) => { void cache.invalidateQueries({ queryKey: ["publish-plans"] }); void cache.invalidateQueries({ queryKey: ["content"] }); onSelect(plan.contentItemId); document.getElementById("content")?.scrollIntoView({ block: "start" }); } });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="calendar-panel">
    <h2 className="text-lg font-semibold">게시 캘린더</h2><p className="mt-1 text-sm text-muted-foreground">반복 슬롯과 실제 예약·게시 결과를 구분합니다. 예약 변경은 기존 예약을 취소한 뒤 검수 화면에서 새 시간으로 예약합니다.</p>
    {change.error ? <p role="alert" className="mt-2 text-sm text-red-700">{change.error.message}</p> : null}
    {plans.length > 0 ? <div className="mt-4 grid gap-2">{plans.map((plan) => <article className="rounded border border-primary/30 bg-primary/5 p-3 text-sm" key={plan.id}><div className="flex items-center justify-between gap-3"><button type="button" className="font-medium underline" onClick={() => onSelect(plan.contentItemId)}>{plan.title} · {platformLabel(plan.platform)}</button><span>{statusLabel(plan.status)}</span></div><p className="mt-1 text-xs text-muted-foreground">예약: {new Date(plan.scheduledAt).toLocaleString()} · 게시: {plan.publishedAt ? new Date(plan.publishedAt).toLocaleString() : "아직 게시되지 않음"}</p>{plan.failureReason ? <p role="alert">{plan.failureReason}</p> : null}{plan.postUrl ? <a className="mt-1 block text-primary" href={plan.postUrl} rel="noreferrer" target="_blank">게시물 열기</a> : null}{plan.status === "SCHEDULED" ? <Button className="mt-2" disabled={change.isPending} onClick={() => { if (window.confirm("기존 예약을 취소하고 검수 화면에서 새 시간을 선택할까요? 새 예약을 저장하기 전까지 게시되지 않습니다.")) change.mutate(plan); }}>예약 변경</Button> : null}</article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">아직 실제 예약 게시물이 없습니다.</p>}
    <h3 className="mt-5 text-sm font-semibold">반복 게시 슬롯</h3>
    <div className="mt-4 grid gap-3 md:grid-cols-7">{weekdayLabels.map((day, index) => <article className="min-h-32 rounded-md border border-border p-3" key={day}><h3 className="text-sm font-semibold">{day}</h3><div className="mt-3 space-y-2">{channels.flatMap((channel) => channel.scheduleRules.filter((rule) => rule.dayOfWeek === index).map((rule) => ({ channel, rule }))).map(({ channel, rule }) => <div className="rounded bg-muted p-2 text-xs" key={`${channel.id}-${rule.platform}-${rule.timeOfDayLocal}`}><p className="font-medium">{rule.timeOfDayLocal} · {rule.timezone}</p><p className="mt-1">{channel.name}</p><p>{platformLabel(rule.platform)} · 최대 {rule.maxPosts}개</p></div>)}</div></article>)}</div>
  </section>;
};

const ReviewPanel = ({ accounts, content, contentItemId, onSelectContent, onError }: { accounts: PlatformAccountResponse[]; content: ContentItemSummary[]; contentItemId: string | null; onSelectContent: (id: string) => void; onError: (error: string) => void }): ReactElement => {
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState<Platform>("YOUTUBE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [regenerationPart, setRegenerationPart] = useState<"full" | "hook" | "body" | "metadata" | "scene">("full");
  const [licenseAssetId, setLicenseAssetId] = useState(""); const [licenseProof, setLicenseProof] = useState(""); const [licenseName, setLicenseName] = useState(""); const [commercialAllowed, setCommercialAllowed] = useState(false); const [derivativeAllowed, setDerivativeAllowed] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => localDateTimeValue(new Date(Date.now() + 10 * 60_000)));
  const review = useQuery({ queryKey: ["content-review", contentItemId], queryFn: () => fetchReview(contentItemId ?? ""), enabled: Boolean(contentItemId), retry: false, refetchInterval: 5_000 });
  const preview = useQuery({ queryKey: ["content-preview", contentItemId, platform], queryFn: () => request(`/content/${contentItemId}/review/preview?platform=${platform}`, { method: "GET" }, ReviewPreviewResponseSchema), enabled: Boolean(contentItemId && review.data?.outputs.some((output) => output.platform === platform && output.videoReady)), retry: false });
  const policyCheck = useMutation({
    mutationFn: (platform: Platform) => request(`/content/${contentItemId ?? ""}/review/policy-check`, { method: "POST", body: JSON.stringify({ platform }) }, ContentReviewResponseSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "정책 검사에 실패했습니다.")
  });
  const action = useMutation({
    mutationFn: (nextAction: "approve" | "hold" | "discard") => request(`/content/${contentItemId ?? ""}/review/action`, { method: "POST", body: JSON.stringify({ action: nextAction, platform }) }, ContentReviewResponseSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); void queryClient.invalidateQueries({ queryKey: ["content"] }); void queryClient.invalidateQueries({ queryKey: ["automation-runs"] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "검토 작업에 실패했습니다.")
  });
  const data = review.data;
  const output = data?.outputs.find((candidate) => candidate.platform === platform);
  const activePolicy = output ? output.policy : null;
  const selectedAssets = data?.assets.filter((asset) => asset.sceneVersionId == null || asset.sceneVersionId === output?.sceneVersionId) ?? [];
  useEffect(() => {
    if (!data) return;
    setTitle(output?.title || data.title);
    setDescription(output?.metadata.description ?? data.description);
    setHashtags(output?.metadata.hashtags.join(" ") ?? "");
  }, [data?.id, data?.title, data?.description, platform, output?.scriptVersionId, output?.title, output?.metadata.description, output?.metadata.hashtags.join(" ")]);
  const metadata = useMutation({
    mutationFn: () => request(`/content/${contentItemId ?? ""}/review/metadata`, { method: "PATCH", body: JSON.stringify({ platform, title, description, hashtags: hashtags.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean) }) }, ContentReviewResponseSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "메타데이터를 저장하지 못했습니다.")
  });
  const regenerate = useMutation({
    mutationFn: (partial: "full" | "hook" | "body" | "metadata" | "scene") => {
      if (!data?.ideaId) throw new Error("다시 생성할 원본 아이디어를 찾을 수 없습니다.");
      return request("/automation/runs", { method: "POST", body: JSON.stringify({ channelId: data.channelId, ideaId: data.ideaId, platforms: [platform], partial, idempotencyKey: `review:${contentItemId}:${platform}:${partial}:${Date.now()}` }) }, AutomationRunResponseSchema);
    },
    onSuccess: () => { setGenerationNotice("재생성을 시작했습니다. 위 제작 진행에서 추적하며 완료 시 새 결과가 자동으로 표시됩니다."); void queryClient.invalidateQueries({ queryKey: ["automation-runs"] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "재생성에 실패했습니다.")
  });
  const schedule = useMutation({
    mutationFn: () => {
      const account = accounts.find((candidate) => candidate.channelId === data?.channelId && candidate.platform === platform && candidate.status === "CONNECTED");
      if (!account) throw new Error(`예약 전에 ${platformLabel(platform)} 계정을 연결해 주세요.`);
      return request("/publishing/plans", { method: "POST", body: JSON.stringify({ contentItemId, platformAccountId: account.id, scheduledAt: new Date(scheduledAt).toISOString(), idempotencyKey: `review:${contentItemId}:${platform}:${new Date(scheduledAt).toISOString()}` }) }, PublishPlanResponseSchema);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); void queryClient.invalidateQueries({ queryKey: ["content"] }); void queryClient.invalidateQueries({ queryKey: ["publish-plans"] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "게시 예약에 실패했습니다.")
  });
  const license = useMutation({ mutationFn: (status: "VERIFIED" | "REJECTED") => request(`/content/${contentItemId}/review/asset-license`, { method: "POST", body: JSON.stringify({ assetId: licenseAssetId, proofUrl: licenseProof, licenseName, status, commercialUseAllowed: commercialAllowed, derivativeAllowed }) }, ContentReviewResponseSchema), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); void queryClient.invalidateQueries({ queryKey: ["content"] }); void queryClient.invalidateQueries({ queryKey: ["publish-plans"] }); } });
  return <section id="content" className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="review-panel">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">콘텐츠 검토</h2><p className="mt-1 text-sm text-muted-foreground">목록에서 콘텐츠를 선택해 플랫폼별 결과물과 게시 준비 상태를 검토합니다.</p></div><div className="flex gap-2"><label className="sr-only" htmlFor="review-content">검토할 콘텐츠</label><select id="review-content" aria-label="검토할 콘텐츠" className="h-10 min-w-56 rounded-md border border-border px-3 text-sm" onChange={(event) => onSelectContent(event.target.value)} value={contentItemId ?? ""}><option value="">콘텐츠 선택</option>{content.map((item) => <option key={item.id} value={item.id}>{item.title} · {statusLabel(item.status)}</option>)}</select><Button disabled={!contentItemId || policyCheck.isPending || !output?.videoReady} onClick={() => policyCheck.mutate(platform)}>정책 검사</Button></div></div>
    <div className="mt-4 flex gap-2" role="tablist" aria-label="검수 플랫폼">{(["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const).map((candidate) => <Button role="tab" aria-selected={platform === candidate} className={platform === candidate ? "" : "bg-foreground"} key={candidate} onClick={() => setPlatform(candidate)} type="button">{platformLabel(candidate)}</Button>)}</div>
    {generationNotice ? <p role="status" className="mt-3 text-sm text-primary">{generationNotice}</p> : null}
  {data?.assets.length ? <details className="mt-3 rounded border border-border p-3 text-sm"><summary>에셋 권리 증빙 검토 (소유자)</summary><p className="mt-2">제공자 요금제·음성 동의·상업 사용·변형 권리를 직접 확인한 뒤 증빙을 등록합니다. URL만 입력했다고 권리가 자동 확인되는 것은 아닙니다. 변경 후 재검사·재승인이 필요하고 기존 예약은 보류됩니다.</p><label className="mt-2 block">검토할 에셋<select className="ml-2 rounded border p-2" value={licenseAssetId} onChange={(event) => setLicenseAssetId(event.target.value)}><option value="">선택</option>{[...new Map(selectedAssets.map((asset) => [asset.id, asset])).values()].map((asset) => <option key={asset.id} value={asset.id}>{asset.purpose} · {statusLabel(asset.licenseStatus)}</option>)}</select></label><label className="mt-2 block">라이선스 이름<input className="ml-2 rounded border p-2" value={licenseName} onChange={(event) => setLicenseName(event.target.value)} /></label><label className="mt-2 block">권리 증빙 URL<input className="ml-2 rounded border p-2" type="url" value={licenseProof} onChange={(event) => setLicenseProof(event.target.value)} placeholder="https://" /></label><label className="mt-2 block"><input type="checkbox" checked={commercialAllowed} onChange={(event) => setCommercialAllowed(event.target.checked)} /> 상업 사용 허용을 확인했습니다</label><label className="mt-2 block"><input type="checkbox" checked={derivativeAllowed} onChange={(event) => setDerivativeAllowed(event.target.checked)} /> 변형·편집 허용을 확인했습니다</label><div className="mt-2 flex gap-2"><Button disabled={license.isPending || !licenseAssetId || !commercialAllowed || !derivativeAllowed || !licenseProof.startsWith("https://") || licenseName.length < 3} onClick={() => { if (window.confirm("실제 권리 증빙을 확인했으며 상업 사용을 승인할까요?")) license.mutate("VERIFIED"); }}>증빙 확인 후 승인</Button><Button disabled={license.isPending || !licenseAssetId || !licenseProof.startsWith("https://") || licenseName.length < 3} onClick={() => license.mutate("REJECTED")}>권리 사용 거절</Button></div>{license.error ? <p role="alert">{license.error.message}</p> : null}{license.isSuccess ? <p role="status">권리 검토를 기록했습니다. 정책 검사를 다시 실행해 주세요.</p> : null}</details> : null}
    {output?.script ? <details className="mt-3 rounded border border-border p-3 text-sm"><summary>대본·적용 언어 확인 ({output.script.language}, {output.durationSeconds ?? "미확정"}초)</summary><p className="mt-2">{output.script.hook}</p><p>{output.script.body}</p><p>{output.script.callToAction}</p></details> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><label>재생성 범위<select aria-label="재생성 범위" className="ml-2 rounded border p-2" value={regenerationPart} onChange={(event) => setRegenerationPart(event.target.value as typeof regenerationPart)}>{[["full", "전체"], ["hook", "훅"], ["body", "본문"], ["metadata", "메타데이터"], ["scene", "장면 이미지"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button disabled={regenerate.isPending || !output} onClick={() => regenerate.mutate(regenerationPart)}>선택 범위 재생성</Button><p>선택 플랫폼의 새 버전을 만들고 이미지·음성·영상·정책 검사를 다시 실행합니다. 서버가 단계별 예상 비용을 산정하며 예산·단가 미확정 시 보류합니다.</p></div>
    {review.isLoading ? <p className="mt-4 text-sm text-muted-foreground">검토 정보를 불러오는 중입니다.</p> : null}
      {data ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><article className="rounded-md border border-border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">{platformLabel(platform)} 결과물</h3><span className="rounded bg-muted px-2 py-1 text-xs">{statusLabel(output?.publishStatus ?? output?.reviewStatus ?? "REVIEW_REQUIRED")}</span></div><p className="mt-2 text-xs text-muted-foreground">대본: {statusLabel(output?.scriptStatus ?? "없음")} · 장면: {output?.sceneVersionId ? "준비됨" : "없음"} · 렌더링: {statusLabel(output?.renderStatus ?? "PENDING")}</p>{preview.data ? <video className="mt-3 aspect-[9/16] max-h-[480px] w-full rounded bg-black" controls src={preview.data.url} /> : <p className="mt-3 rounded bg-muted p-4 text-sm">이 플랫폼 결과물의 렌더링 영상 미리보기가 없습니다.</p>}<label className="mt-4 block text-sm font-medium">제목<input className="mt-1 h-10 w-full rounded border border-border px-3" onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="mt-3 block text-sm font-medium">설명<textarea className="mt-1 min-h-24 w-full rounded border border-border p-3" onChange={(event) => setDescription(event.target.value)} value={description} /></label><label className="mt-3 block text-sm font-medium">해시태그<input className="mt-1 h-10 w-full rounded border border-border px-3" onChange={(event) => setHashtags(event.target.value)} value={hashtags} /></label><div className="mt-3 flex flex-wrap gap-2"><Button disabled={metadata.isPending || !output} onClick={() => metadata.mutate()}>메타데이터 저장</Button><Button className="bg-foreground" disabled={regenerate.isPending || !output} onClick={() => regenerate.mutate("scene")}>장면만 재생성</Button><Button className="bg-foreground" disabled={regenerate.isPending || !output} onClick={() => regenerate.mutate("full")}>전체 재생성</Button></div><h4 className="mt-4 text-sm font-semibold">출처</h4><ul className="mt-2 space-y-1 text-sm">{data.sources.map((source) => <li key={source.url}><a className="text-primary" href={source.url} rel="noreferrer" target="_blank">{source.sourceName}: {source.title}</a></li>)}</ul><h4 className="mt-4 text-sm font-semibold">에셋 권리</h4><ul className="mt-2 space-y-1 text-sm">{selectedAssets.map((asset) => <li key={`${asset.id}-${asset.purpose}`}>{asset.purpose}: {statusLabel(asset.licenseStatus)}</li>)}</ul></article><article className="rounded-md border border-border p-4"><h3 className="font-medium">{platformLabel(platform)} 정책 검사 결과</h3><p className="mt-2 text-sm">{activePolicy ? statusLabel(activePolicy.status) : "검사 전"}</p><ul className="mt-3 space-y-2 text-sm">{activePolicy?.findings.map((finding) => <li key={`${finding.code}-${finding.message}`} className="rounded bg-muted p-2">{statusLabel(finding.severity)}: {finding.message}</li>)}</ul><div className="mt-5 flex flex-wrap gap-2"><Button disabled={action.isPending || activePolicy?.status !== "pass" || !output?.videoReady} onClick={() => action.mutate("approve")}>승인</Button><Button className="bg-foreground" disabled={action.isPending || output?.publishStatus === "PUBLISHED"} onClick={() => action.mutate("hold")}>보류</Button><Button className="bg-foreground" disabled={action.isPending || output?.publishStatus === "PUBLISHED"} onClick={() => { if (window.confirm("선택 플랫폼 결과물을 폐기할까요?")) action.mutate("discard"); }}>폐기</Button></div><div className="mt-5 border-t border-border pt-4"><label className="block text-sm font-medium">예약 시각<input className="mt-1 h-10 w-full rounded border border-border px-3" min={localDateTimeValue(new Date(Date.now() + 60_000))} onChange={(event) => setScheduledAt(event.target.value)} type="datetime-local" value={scheduledAt} /></label><p className="mt-1 text-xs text-muted-foreground">현재 기기 시간대로 표시되며 저장할 때 UTC로 변환합니다.</p><Button className="mt-3" disabled={schedule.isPending || output?.reviewStatus !== "APPROVED" || !output?.videoReady || activePolicy?.status !== "pass"} onClick={() => schedule.mutate()}>게시 계획 만들기</Button></div></article></div> : <p className="mt-4 rounded border border-dashed border-border p-4 text-sm text-muted-foreground">위 목록에서 검토할 콘텐츠를 선택해 주세요.</p>}
  </section>;
};

const ideaStatuses: Array<IdeaStatus | "ALL"> = ["ALL", "CANDIDATE", "SHORTLISTED", "REJECTED", "USED", "EXPIRED"];

const IdeasPanel = ({
  channels,
  onError
}: {
  channels: ChannelResponse[];
  onError: (error: string) => void;
}): ReactElement => {
  const queryClient = useQueryClient();
  const [channelId, setChannelId] = useState("");
  const [status, setStatus] = useState<IdeaStatus | "ALL">("ALL");
  const [platform, setPlatform] = useState<Platform>("YOUTUBE");
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId && channels[0]) {
      setChannelId(channels[0].id);
    }
  }, [channelId, channels]);

  const ideas = useQuery({
    queryKey: ["ideas", channelId, status],
    queryFn: () => fetchIdeas(channelId, status),
    enabled: channelId.length > 0
  });

  const collectMutation = useMutation({
    mutationFn: () =>
      request(
        "/ideas/collect",
        {
          method: "POST",
          body: JSON.stringify({
            channelId,
            idempotencyKey: `manual-${channelId}-${Date.now()}`,
            source: "auto"
          })
        },
        CollectIdeasResponseSchema
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ideas"] });
    },
    onError: (error) => onError(error instanceof Error ? error.message : "아이디어 수집에 실패했습니다.")
  });

  const updateMutation = useMutation({
    mutationFn: ({ ideaId, nextStatus }: { ideaId: string; nextStatus: IdeaStatus }) =>
      request(
        `/ideas/${ideaId}/status`,
        { method: "PATCH", body: JSON.stringify({ status: nextStatus }) },
        ContentIdeaSchema
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ideas"] });
    },
    onError: (error) => onError(error instanceof Error ? error.message : "아이디어 상태를 변경하지 못했습니다.")
  });
  const generateMutation = useMutation({
    mutationFn: (ideaId: string) => request("/automation/runs", { method: "POST", body: JSON.stringify({ channelId, ideaId, platforms: [platform], idempotencyKey: `idea:${ideaId}:${platform}` }) }, AutomationRunResponseSchema),
    onSuccess: (run) => { setGenerationMessage(`제작 작업을 시작했습니다. 실행 ${run.id.slice(0, 8)}의 진행 상태는 자동화 운영에서 확인할 수 있습니다.`); void queryClient.invalidateQueries({ queryKey: ["automation-runs"] }); void queryClient.invalidateQueries({ queryKey: ["content"] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "영상 제작을 시작하지 못했습니다.")
  });

  if (channels.length === 0) {
    return <section className="rounded-md border border-border p-5 text-sm text-muted-foreground">아이디어를 수집하려면 먼저 채널을 만들어 주세요.</section>;
  }

  return (
    <section className="rounded-md border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb aria-hidden="true" className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">아이디어</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-10 rounded-md border border-border px-3 text-sm"
            onChange={(event) => setChannelId(event.target.value)}
            value={channelId}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
          <select aria-label="제작 플랫폼" className="h-10 rounded-md border border-border px-3 text-sm" onChange={(event) => setPlatform(event.target.value as Platform)} value={platform}>{platforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select
            className="h-10 rounded-md border border-border px-3 text-sm"
            onChange={(event) => setStatus(event.target.value as IdeaStatus | "ALL")}
            value={status}
          >
            {ideaStatuses.map((item) => (
              <option key={item} value={item}>
                {statusLabel(item)}
              </option>
            ))}
          </select>
          <Button className="gap-2" disabled={!channelId || collectMutation.isPending} onClick={() => collectMutation.mutate()}>
            <Search aria-hidden="true" className="h-4 w-4" />
            수집
          </Button>
        </div>
      </div>
      {generationMessage ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{generationMessage}</p> : null}
      <div className="mt-4 grid gap-3">
        {ideas.isLoading ? <p className="text-sm text-muted-foreground">아이디어를 불러오는 중입니다.</p> : null}
        {!ideas.isLoading && (ideas.data ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">이 조건에 맞는 아이디어가 없습니다.</p>
        ) : null}
        {(ideas.data ?? []).map((idea) => (
          <article className="rounded-md border border-border p-4" key={idea.id}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{idea.title}</h3>
                  <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{statusLabel(idea.status)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{idea.summary}</p>
                <a className="mt-2 block break-all text-sm text-primary" href={idea.canonicalUrl} rel="noreferrer" target="_blank">
                  {idea.sourceName}
                </a>
              </div>
              <div className="grid min-w-48 gap-2 text-sm">
                <span>예상 가치 {(idea.expectedValueScore * 100).toFixed(0)}%</span>
                <select
                  className="h-9 rounded-md border border-border px-2 text-sm"
                  disabled={updateMutation.isPending}
                  onChange={(event) => updateMutation.mutate({ ideaId: idea.id, nextStatus: event.target.value as IdeaStatus })}
                  value={idea.status}
                >
                  {ideaStatuses
                    .filter((item): item is IdeaStatus => item !== "ALL")
                    .map((item) => (
                      <option key={item} value={item}>
                        {statusLabel(item)}
                      </option>
                    ))}
                </select>
                <Button disabled={generateMutation.isPending || !["CANDIDATE", "SHORTLISTED"].includes(idea.status)} onClick={() => generateMutation.mutate(idea.id)}>이 소재로 영상 만들기</Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

const ChannelList = ({
  accounts,
  channels,
  isLoading,
  onEdit,
  onError
}: {
  accounts: PlatformAccountResponse[];
  channels: ChannelResponse[];
  isLoading: boolean;
  onEdit: (channel: ChannelResponse) => void;
  onError: (error: string) => void;
}): ReactElement => {
  if (isLoading) {
    return <section className="rounded-md border border-border p-5 text-sm text-muted-foreground">채널을 불러오는 중입니다.</section>;
  }

  if (channels.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        아직 운영 채널이 없습니다. 채널 만들기에서 주제, 템플릿, 일정, 안전 설정을 지정하세요.
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      {channels.map((channel) => (
        <ChannelCard key={channel.id} accounts={accounts} channel={channel} onEdit={onEdit} onError={onError} />
      ))}
    </section>
  );
};

const ChannelCard = ({
  accounts,
  channel,
  onEdit,
  onError
}: {
  accounts: PlatformAccountResponse[];
  channel: ChannelResponse;
  onEdit: (channel: ChannelResponse) => void;
  onError: (error: string) => void;
}): ReactElement => {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: (action: "pause" | "resume") =>
      request(`/channels/${channel.id}/${action}`, { method: "POST" }, ChannelResponseSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (error) => onError(error instanceof Error ? error.message : "채널 상태를 변경하지 못했습니다.")
  });
  const connectMutation = useMutation({
    mutationFn: async (platform: Platform) => {
      const started = await request(
        `/platform-accounts/${platform.toLowerCase()}/connect`,
        { method: "POST", body: JSON.stringify({ channelId: channel.id }) },
        StartOAuthConnectionResponseSchema
      );
      if (started.provider === "fake") {
        await requestAbsolute(started.authorizationUrl, { method: "GET" }, OAuthCallbackResultSchema);
        return;
      }
      sessionStorage.setItem("postbot-oauth-channel", channel.id);
      window.location.assign(started.authorizationUrl);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-accounts"] });
    },
    onError: (error) => onError(error instanceof Error ? error.message : "플랫폼 계정을 연결하지 못했습니다.")
  });
  const disconnectMutation = useMutation({
    mutationFn: (platformAccountId: string) => request(`/platform-accounts/${platformAccountId}/disconnect`, { method: "POST" }, { parse: () => ({ ok: true }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-accounts"] });
    },
    onError: (error) => onError(error instanceof Error ? error.message : "플랫폼 계정 연결을 해제하지 못했습니다.")
  });

  return (
    <article id={`channel-${channel.id}`} className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid={`channel-card-${channel.id}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{channel.name}</h2>
            <StatusBadge status={channel.status} />
          </div>
          <p className="text-sm text-muted-foreground">{channel.topic}</p>
          <p className="mt-1 text-sm text-muted-foreground">{channel.targetAudience} · {channel.language}</p>
        </div>
        <div className="flex gap-2">
          <Button className="gap-2 bg-foreground" data-testid={`edit-channel-${channel.id}`} onClick={() => onEdit(channel)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
            설정
          </Button>
          {channel.status === "PAUSED" ? (
            <Button className="gap-2" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("resume")}>
              <CirclePlay aria-hidden="true" className="h-4 w-4" />
              재개
            </Button>
          ) : (
            <Button className="gap-2" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("pause")}>
              <CirclePause aria-hidden="true" className="h-4 w-4" />
              일시 중지
            </Button>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {channel.platformConnections.map((connection) => {
          const account = accounts.find((candidate) => candidate.platform === connection.platform && candidate.channelId === channel.id);
          const connected = account?.status === "CONNECTED";
          const expired = account?.status === "EXPIRED";
          const scopeMissing = connected && (connection.platform === "YOUTUBE" ? !account.scopes.includes("https://www.googleapis.com/auth/youtube.readonly") : connection.platform === "INSTAGRAM" ? !account.scopes.includes("instagram_business_content_publish") : !account.scopes.includes("video.publish"));
          return <div key={connection.platform} className="rounded-md border border-border bg-muted px-3 py-2">
            <p className="text-sm font-medium">{platforms.find((item) => item.value === connection.platform)?.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {scopeMissing
                ? "권한 부족"
                : connection.status === "PLANNED"
                  ? "연결 예정"
                  : connection.status === "EXPIRED"
                    ? "만료"
                    : statusLabel(connection.status)}
            </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {connected || expired ? (
                  <>
                    <Button
                      className="h-9 gap-2"
                      data-testid={`connect-${connection.platform.toLowerCase()}-${channel.id}`}
                      disabled={connectMutation.isPending}
                      onClick={() => connectMutation.mutate(connection.platform)}
                    >
                      <RefreshCw aria-hidden="true" className="h-4 w-4" />
                      재연결
                    </Button>
                    <Button
                      className="h-9 gap-2 bg-foreground"
                      data-testid={`disconnect-${connection.platform.toLowerCase()}-${channel.id}`}
                      disabled={disconnectMutation.isPending}
                      onClick={() => account && disconnectMutation.mutate(account.id)}
                    >
                      <Unplug aria-hidden="true" className="h-4 w-4" />
                      해제
                    </Button>
                  </>
                ) : (
                  <Button
                    className="h-9 gap-2"
                    data-testid={`connect-${connection.platform.toLowerCase()}-${channel.id}`}
                    disabled={connectMutation.isPending}
                    onClick={() => connectMutation.mutate(connection.platform)}
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    연결
                  </Button>
                )}
              </div>
          </div>
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarDays aria-hidden="true" className="h-4 w-4" />
          재고 {channel.minInventoryCount}개 이상
        </span>
        <span>자동화: {channel.automationMode === "FULL_AUTO" ? "완전 자동형" : "승인형"}</span>
      </div>
    </article>
  );
};

const StatusBadge = ({ status }: { status: ChannelResponse["status"] }): ReactElement => {
  const label = status === "ACTIVE" ? "운영 중" : status === "PAUSED" ? "일시 중지" : "오류";
  return <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{label}</span>;
};

const EditPanel = ({
  channel,
  onClose,
  onError
}: {
  channel: ChannelResponse | null;
  onClose: () => void;
  onError: (error: string) => void;
}): ReactElement => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [maxDailyPosts, setMaxDailyPosts] = useState(1);
  const [language, setLanguage] = useState("ko-KR");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [hook, setHook] = useState("");
  const [cta, setCta] = useState("");
  const [durationMin, setDurationMin] = useState(15);
  const [durationMax, setDurationMax] = useState(60);

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setMaxDailyPosts(channel.dailyPublishLimit);
      setLanguage(channel.language); setAudience(channel.targetAudience); setTone(channel.template.tone);
      setHook(channel.outputProfiles[0]?.hookStyle ?? "질문형");
      setCta(typeof channel.template.subtitleStyle.cta === "string" ? channel.template.subtitleStyle.cta : "");
      setDurationMin(channel.outputProfiles[0]?.minDurationSeconds ?? 15); setDurationMax(channel.outputProfiles[0]?.maxDurationSeconds ?? 60);
    }
  }, [channel]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!channel) {
        throw new Error("수정할 채널이 없습니다.");
      }
      return request(
        `/channels/${channel.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name,
            language, targetAudience: audience,
            template: { ...channel.template, tone, subtitleStyle: { ...channel.template.subtitleStyle, cta } },
            outputProfiles: channel.outputProfiles.map((profile) => ({ ...profile, hookStyle: hook, minDurationSeconds: durationMin, maxDurationSeconds: durationMax })),
            automation: {
              mode: channel.automationMode,
              minInventoryCount: channel.minInventoryCount,
              dailyPublishLimit: Number(maxDailyPosts),
              errorAction: channel.errorAction
            }
          })
        },
        ChannelResponseSchema
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      onClose();
    },
    onError: (error) => onError(error instanceof Error ? error.message : "채널 설정을 저장하지 못했습니다.")
  });

  if (!channel) {
    return (
      <aside className="rounded-md border border-border p-5 text-sm text-muted-foreground">
        채널을 선택하면 이름과 자동화 안전 설정을 수정할 수 있습니다.
      </aside>
    );
  }

  return (
    <aside className="rounded-md border border-border bg-white p-5">
      <h2 className="text-lg font-semibold">설정 수정</h2>
      <div className="mt-4 space-y-4">
        <p className="text-xs text-muted-foreground">변경은 이후 제작에 적용됩니다. 이미 예약된 영상과 게시 메타데이터는 바뀌지 않습니다.</p>
        {[{ label: "생성 언어", value: language, set: setLanguage }, { label: "목표 시청자", value: audience, set: setAudience }, { label: "말투", value: tone, set: setTone }, { label: "훅 방식", value: hook, set: setHook }, { label: "CTA 방식", value: cta, set: setCta }].map((field) => <label className="block text-sm font-medium" key={field.label}>{field.label}<input className="mt-1 h-10 w-full rounded border border-border px-3" value={field.value} onChange={(event) => field.set(event.target.value)} /></label>)}
        <label className="block text-sm font-medium">최소 길이 초<input className="mt-1 h-10 w-full rounded border border-border px-3" type="number" min={15} max={180} value={durationMin} onChange={(event) => setDurationMin(Number(event.target.value))} /></label>
        <label className="block text-sm font-medium">최대 길이 초<input className="mt-1 h-10 w-full rounded border border-border px-3" type="number" min={15} max={180} value={durationMax} onChange={(event) => setDurationMax(Number(event.target.value))} /></label>
        <label className="block text-sm font-medium">
          채널 이름
          <input
            className="mt-2 h-11 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-primary"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="block text-sm font-medium">
          일일 최대 게시
          <input
            className="mt-2 h-11 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-primary"
            min={1}
            max={12}
            onChange={(event) => setMaxDailyPosts(Number(event.target.value))}
            type="number"
            value={maxDailyPosts}
          />
        </label>
        <div className="flex gap-2">
          <Button className="gap-2" data-testid="save-channel-settings" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            저장
          </Button>
          <Button className="bg-foreground" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </aside>
  );
};

const ChannelWizard = ({
  onClose,
  onError
}: {
  onClose: () => void;
  onError: (error: string) => void;
}): ReactElement => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const form = useForm<WizardForm>({ defaultValues: defaultWizardValues });
  const values = form.watch();
  const preview = useMemo(() => buildChannelInput(values), [values]);

  const mutation = useMutation({
    mutationFn: (data: WizardForm) =>
      request("/channels", { method: "POST", body: JSON.stringify(CreateChannelRequestSchema.parse(buildChannelInput(data))) }, ChannelResponseSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      onClose();
    },
    onError: (error) => onError(error instanceof Error ? error.message : "채널을 만들지 못했습니다.")
  });

  const submit = form.handleSubmit((data) => {
    mutation.mutate(data);
  });
  const lastStep = wizardSteps.length - 1;
  const nextStep = () => {
    const result = CreateChannelRequestSchema.safeParse(buildChannelInput(form.getValues()));
    const fields: Record<string, keyof WizardForm> = { name: "name", topic: "topic", targetAudience: "audience", language: "language", platforms: "platforms", "collectionRule.keywords": "keywords", "collectionRule.recencyHours": "recencyHours", "collectionRule.collectionFrequencyMinutes": "collectionFrequencyMinutes", "template.name": "templateName", "template.tone": "hookStyle", "outputProfiles.minDurationSeconds": "durationMinSeconds", "outputProfiles.maxDurationSeconds": "durationMaxSeconds", "scheduleRules.timezone": "timezone", "scheduleRules.timeOfDayLocal": "times", scheduleRules: "times", "automation.dailyPublishLimit": "maxDailyPosts", "automation.minInventoryCount": "minContentInventory" };
    const stepFields: Array<Array<keyof WizardForm>> = [["name", "topic", "audience", "language"], ["platforms"], ["keywords", "recencyHours", "collectionFrequencyMinutes"], ["templateName", "hookStyle", "ctaStyle"], ["durationMinSeconds", "durationMaxSeconds"], ["timezone", "times", "days", "minContentInventory"], ["maxDailyPosts"], []];
    form.clearErrors();
    let invalid = false;
    if (!result.success) for (const issue of result.error.issues) {
      const field = fields[issue.path.filter((part) => typeof part !== "number").join(".")];
      if (field && stepFields[step]?.includes(field)) { form.setError(field, { message: issue.message }); invalid = true; }
    }
    if (!invalid) setStep((current) => current + 1);
  };

  return (
    <dialog ref={dialog} aria-label="채널 설정 마법사" onCancel={onClose} className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-black/40 px-4 py-5">
      <form
        className="mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-4xl flex-col rounded-md bg-white shadow-xl"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <header className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{step + 1} / 8</p>
              <h2 className="text-xl font-semibold">{wizardSteps[step]?.title}</h2>
            </div>
            <Button className="bg-foreground" onClick={onClose} type="button">
              닫기
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-8 gap-1">
            {wizardSteps.map((item, index) => (
              <button
                aria-label={item.title}
                className={`h-2 rounded ${index <= step ? "bg-primary" : "bg-muted"}`}
                key={item.title}
                onClick={() => setStep(index)}
                type="button"
              />
            ))}
          </div>
        </header>
        <section className="flex-1 px-5 py-6">
          <WizardStep step={step} form={form} preview={preview} />
          {Object.entries(form.formState.errors).map(([field, issue]) => <p role="alert" className="mt-2 text-sm text-red-700" key={field}>{field}: {issue.message}</p>)}
        </section>
        <footer className="flex items-center justify-between border-t border-border px-5 py-4">
          <Button className="gap-2 bg-foreground" disabled={step === 0} onClick={() => setStep((current) => current - 1)} type="button">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            이전
          </Button>
          {step === lastStep ? (
            <Button className="gap-2" data-testid="wizard-create" disabled={mutation.isPending} key="create" type="submit">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              생성
            </Button>
          ) : (
            <Button className="gap-2" data-testid="wizard-next" key="next" onClick={nextStep} type="button">
              다음
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Button>
          )}
        </footer>
      </form>
    </dialog>
  );
};

const wizardSteps = [
  { title: "기본" },
  { title: "SNS" },
  { title: "소재" },
  { title: "템플릿" },
  { title: "출력" },
  { title: "일정" },
  { title: "자동화" },
  { title: "샘플" }
] as const;

const WizardStep = ({
  step,
  form,
  preview
}: {
  step: number;
  form: ReturnType<typeof useForm<WizardForm>>;
  preview: CreateChannelRequest;
}): ReactElement => {
  const { register } = form;

  if (step === 0) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="채널 이름" registration={register("name", { required: true })} />
        <Field label="언어" registration={register("language", { required: true })} />
        <label className="block text-sm font-medium md:col-span-2">
          명확한 주제
          <textarea className="mt-2 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary" {...register("topic", { required: true })} />
        </label>
        <label className="block text-sm font-medium md:col-span-2">
          시청자
          <textarea className="mt-2 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary" {...register("audience", { required: true })} />
        </label>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="grid gap-3">
        {platforms.map((platform) => (
          <label className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm" key={platform.value}>
            <span>
              <span className="font-medium">{platform.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">연결 예정</span>
            </span>
            <input className="h-4 w-4" type="checkbox" value={platform.value} {...register("platforms")} />
          </label>
        ))}
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="수집 키워드" helper="쉼표로 구분" registration={register("keywords", { required: true })} />
        <Field label="제외 키워드" helper="쉼표로 구분" registration={register("excludedKeywords")} />
        <Field label="최신성 기준 시간" type="number" registration={register("recencyHours", { valueAsNumber: true })} />
        <Field label="수집 주기 분" type="number" registration={register("collectionFrequencyMinutes", { valueAsNumber: true })} />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="템플릿 이름" registration={register("templateName", { required: true })} />
        <Field label="CTA 방식" registration={register("ctaStyle", { required: true })} />
        <Field label="훅 방식" registration={register("hookStyle", { required: true })} />
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="최소 길이 초" type="number" registration={register("durationMinSeconds", { valueAsNumber: true })} />
        <Field label="최대 길이 초" type="number" registration={register("durationMaxSeconds", { valueAsNumber: true })} />
        <p className="rounded bg-muted p-3 text-sm md:col-span-2">지원 출력: 9:16 · 1080×1920 · 가독성 자막. 다른 화면 비율·해상도·자막 테마는 아직 제공하지 않습니다.</p>
      </div>
    );
  }

  if (step === 5) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="시간대" registration={register("timezone", { required: true })} />
        <Field label="게시 시간" helper="09:00,18:00 형식" registration={register("times", { required: true })} />
        <Field label="최소 콘텐츠 재고" type="number" registration={register("minContentInventory", { valueAsNumber: true })} />
        <fieldset className="rounded-md border border-border p-4 md:col-span-2">
          <legend className="px-1 text-sm font-medium">게시 요일</legend>
          <div className="mt-3 grid grid-cols-4 gap-2 md:grid-cols-7">
            {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => (
              <label className="flex items-center gap-2 text-sm" key={day}>
                <input type="checkbox" value={String(index)} {...register("days")} />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    );
  }

  if (step === 6) {
    return (
      <div className="grid gap-4">
        <label className="block text-sm font-medium">
          자동화 모드
          <select className="mt-2 h-11 w-full rounded-md border border-border px-3 text-sm" {...register("automationMode")}>
            <option value="APPROVAL">승인형</option>
            <option value="FULL_AUTO">완전 자동형</option>
          </select>
        </label>
        <Field label="일일 최대 게시" type="number" registration={register("maxDailyPosts", { valueAsNumber: true })} />
        <Toggle registration={register("requiresPolicyPass")} label="정책 검사 통과 필수" />
        <Toggle registration={register("requiresRightsCheck")} label="권리 검사 통과 필수" />
        <Toggle registration={register("blocksSensitiveTopics")} label="민감 주제 자동 게시 차단" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle aria-hidden="true" className="mb-2 h-5 w-5" />
        OAuth 연결은 다음 단계에서 제공됩니다. 선택한 플랫폼은 실제 연결 성공으로 처리하지 않고 연결 예정 상태로 저장됩니다.
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">채널</h3><p className="mt-2 text-sm">{preview.name}</p><p className="text-sm text-muted-foreground">{preview.topic} · {preview.targetAudience}</p></article>
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">플랫폼</h3><p className="mt-2 text-sm">{preview.platforms.map(platformLabel).join(", ") || "선택 필요"}</p><p className="text-sm text-muted-foreground">계정 연결은 채널 생성 후 이어서 진행합니다.</p></article>
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">제작 설정</h3><p className="mt-2 text-sm">{preview.template.name} · {preview.outputProfiles[0]?.minDurationSeconds ?? "-"}~{preview.outputProfiles[0]?.maxDurationSeconds ?? "-"}초</p><p className="text-sm text-muted-foreground">{preview.template.tone} · 읽기 쉬운 자막</p></article>
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">운영</h3><p className="mt-2 text-sm">{preview.automation.mode === "FULL_AUTO" ? "완전 자동형" : "승인형"} · 최소 재고 {preview.automation.minInventoryCount}개</p><p className="text-sm text-muted-foreground">{preview.scheduleRules.length}개 반복 슬롯 · {preview.scheduleRules[0]?.timezone ?? "시간대 미설정"}</p></article>
      </div>
      <p className="text-sm text-muted-foreground">생성 후 계정 연결과 예산을 설정하면 자동 제작을 시작할 수 있습니다. 샘플 영상은 실제 제작 작업이 완료된 뒤 콘텐츠 검토 화면에서 확인합니다.</p>
    </div>
  );
};

const Toggle = ({ label, registration }: { label: string; registration: UseFormRegisterReturn }): ReactElement => (
  <label className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-sm">
    <input className="h-4 w-4" type="checkbox" {...registration} />
    {label}
  </label>
);

const App = (): ReactElement => {
  const me = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false
  });

  if (me.isLoading) {
    return <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">세션을 확인하는 중입니다.</main>;
  }

  return me.data ? <Dashboard session={me.data} /> : <AuthForm />;
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
