import { FirstChannelWelcome, WorkspaceShell, WorkspaceView, useWorkspacePage } from "./workspace-shell";
import { PublicationReconciliation } from "./publication-reconciliation";
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
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
  UserPlus
} from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { StrictMode, useEffect, useRef, useState } from "react";
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
  ExperimentResponseSchema,
  CreateExperimentRequestSchema,
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
import { z } from "zod";
import { Button } from "./components/ui/button";
import "./styles.css";
import { createSessionFetch } from "./session-fetch";
import { ChannelOperationsEditor, channelOperations } from "./channel-operations-editor";
import { UpdateChannelRequestSchema, type UpdateChannelRequest } from "@postbot/contracts";
import { InsightControls } from "./insight-controls";
import { ProviderControls } from "./provider-controls";
import { PolicyProfileNotice } from "./policy-profile-notice";
import { policyHelp } from "./policy-help";
import { ChannelAudioEditor } from "./channel-audio-editor";
import { ScriptEditor } from "./script-editor";

const queryClient = new QueryClient();
const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
const runtimeConfig = (window as Window & { __POSTBOT_CONFIG__?: { apiBaseUrl?: unknown } }).__POSTBOT_CONFIG__;
const apiBaseUrl = z.string().url().optional().parse(runtimeConfig?.apiBaseUrl) ?? viteEnv["VITE_API_BASE_URL"] ?? "http://localhost:3000";
let sessionCsrfToken: string | null = null;

const csrfFromCookie = (): string | null => {
  const cookie = document.cookie.split("; ").find((item) => item.startsWith("postbot_csrf="));
  try { return cookie ? decodeURIComponent(cookie.split("=")[1] ?? "") : null; }
  catch { return null; }
};

const sessionFetch = createSessionFetch(async () => {
  await request("/auth/refresh", { method: "POST", body: "{}" }, AuthResponseSchema);
}, () => {
  sessionCsrfToken = null;
  // Do not destroy the in-flight /auth/me observer: that would strand the login screen.
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
  queryClient.setQueryData(["auth", "me"], null);
  window.dispatchEvent(new Event("postbot-session-expired"));
});

const request = async <Result,>(
  path: string,
  options: RequestInit,
  parser: { parse(value: unknown): Result }
): Promise<Result> => {
  const makeInit = (): RequestInit => {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  const csrfToken = csrfFromCookie() ?? sessionCsrfToken;
  if (csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  return {
    ...options,
    headers,
    credentials: "include"
  };
  };
  const response = await sessionFetch(`${apiBaseUrl}${path}`, makeInit, !["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"].includes(path));
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  if (["/auth/me", "/auth/login", "/auth/register", "/auth/refresh"].includes(path) && body && typeof body === "object" && "csrfToken" in body && typeof body.csrfToken === "string") sessionCsrfToken = body.csrfToken;
  if (path === "/auth/logout") sessionCsrfToken = null;
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
const fetchCosts = (channelId: string, contentItemId: string, provider: string, days: number): Promise<CostReportResponse> => { const end = new Date(); const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000); return request(`/operations/costs?periodStart=${encodeURIComponent(start.toISOString())}&periodEnd=${encodeURIComponent(end.toISOString())}${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ""}${contentItemId ? `&contentItemId=${encodeURIComponent(contentItemId)}` : ""}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`, { method: "GET" }, CostReportResponseSchema); };
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
  UPLOADED: "업로드 완료 · 공개 확인 대기",
  PROCESSING: "플랫폼 처리 중",
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
  onConsecutiveFailures: "pause_channel" | "notify_only";
  maxDailyPosts: number;
  voiceProfile: string;
  aiStockRatio: number;
  brandColor: string;
  backgroundColor: string;
  fontFamily: "Arial" | "sans-serif" | "serif";
  watermark: string;
  logoAssetId: string;
  captionColor: string;
  captionBackground: string;
  captionFontSize: number;
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
  onConsecutiveFailures: "pause_channel",
  maxDailyPosts: 2,
  voiceProfile: "neutral-ko", aiStockRatio: 1, brandColor: "#0f766e", backgroundColor: "#f8fafc", fontFamily: "Arial", watermark: "", logoAssetId: "", captionColor: "#ffffff", captionBackground: "#0f172a", captionFontSize: 52
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
      voiceProfile: values.voiceProfile,
      subtitleStyle: {
        mode: "readable",
        cta: values.ctaStyle, color: values.captionColor, backgroundColor: values.captionBackground, fontSize: values.captionFontSize
      },
      visualStyle: {
        aspectRatio: values.aspectRatio,
        resolution: values.resolution, brandColor: values.brandColor, backgroundColor: values.backgroundColor, fontFamily: values.fontFamily, watermark: values.watermark || values.name, ...(values.logoAssetId ? { logoAssetId: values.logoAssetId } : {})
      },
      aiStockRatio: values.aiStockRatio
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
        onPolicyFailure: "hold",
        onAssetLicenseUnknown: "hold",
        onConsecutiveFailures: values.onConsecutiveFailures
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
  const page = useWorkspacePage();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(() => readWizardDraft() !== null);
  const [editing, setEditing] = useState<ChannelResponse | null>(null);
  const [selectedReviewPlatform, setSelectedReviewPlatform] = useState<Platform>(() => { const value = new URLSearchParams(window.location.search).get("platform"); return value === "INSTAGRAM" || value === "TIKTOK" ? value : "YOUTUBE"; });
  const selectReviewPlatform = (platform: Platform) => { setSelectedReviewPlatform(platform); const url = new URL(window.location.href); url.searchParams.set("platform", platform); window.history.replaceState({}, "", url); };
  const [selectedContentId, setSelectedContentId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("content"));
  const [insightChannelId, setInsightChannelId] = useState("");
  const [insightPlatform, setInsightPlatform] = useState("");
  const [insightDays, setInsightDays] = useState(7);
  const [costChannel, setCostChannel] = useState(""); const [costContent, setCostContent] = useState(""); const [costProvider, setCostProvider] = useState(""); const [costDays, setCostDays] = useState(30);
  const oauthResult = new URLSearchParams(window.location.search).get("oauth");
  useEffect(() => {
    if (!oauthResult) return;
    const channelId = new URLSearchParams(window.location.search).get("channel") ?? sessionStorage.getItem("postbot-oauth-channel");
    if (channelId) document.getElementById(`channel-${channelId}`)?.scrollIntoView({ block: "center" });
  }, [oauthResult]);

  const logout = useMutation({
    mutationFn: () => request("/auth/logout", { method: "POST" }, { parse: () => ({ ok: true }) }),
    onSuccess: () => {
      queryClient.clear();
      window.location.reload();
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
  const analytics = useQuery({ queryKey: ["analytics", insightChannelId, insightPlatform, insightDays], queryFn: () => fetchAnalyticsReport(insightChannelId, insightPlatform, insightDays), enabled: Boolean(insightChannelId), refetchInterval: 5000 });
  const suggestions = useQuery({ queryKey: ["optimization-suggestions", insightChannelId], queryFn: () => fetchSuggestions(insightChannelId), enabled: Boolean(insightChannelId) });
  const costs = useQuery({ queryKey: ["operations-costs", costChannel, costContent, costProvider, costDays], queryFn: () => fetchCosts(costChannel, costContent, costProvider, costDays), enabled: Boolean(session), retry: false });
  const budgets = useQuery({ queryKey: ["automation-budgets"], queryFn: fetchBudgets, enabled: Boolean(session) });
  const notifications = useQuery({ queryKey: ["operations-notifications"], queryFn: fetchNotifications, enabled: Boolean(session), refetchInterval: 30_000 });
  const publishPlans = useQuery({ queryKey: ["publish-plans"], queryFn: fetchPublishPlans, enabled: Boolean(session), refetchInterval: 30_000 });

  return (
    <WorkspaceShell page={page} workspace={session.workspace.name} user={session.user.displayName} logout={() => logout.mutate()} loggingOut={logout.isPending} action={<Button className="gap-2" data-testid="create-channel" onClick={() => setWizardOpen(true)}><Plus aria-hidden="true" className="h-4 w-4" />채널 만들기</Button>}>
        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {oauthResult ? <p role={oauthResult === "connected" ? "status" : "alert"} className="rounded-md border border-border bg-white p-3 text-sm">{oauthResult === "connected" ? "플랫폼 계정 연결이 완료되었습니다. 채널의 연결 상태를 확인해 주세요." : "연결을 완료하지 못했습니다. 권한 거절, 연결 만료 또는 제공자 설정을 확인한 뒤 원래 채널에서 다시 연결해 주세요."}</p> : null}


        {[channels, platformAccounts, content, automationRuns, analytics, suggestions, costs, budgets, notifications, publishPlans].some((query) => query.isError) ? <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">일부 운영 정보를 불러오지 못했습니다. 표시되지 않은 항목은 데이터 없음이나 비용 0을 뜻하지 않습니다. <Button onClick={() => void queryClient.invalidateQueries()}>다시 불러오기</Button></p> : null}
        <WorkspaceView active={page} page="home">
        {!channels.isLoading && !channels.isError && channels.data?.length === 0 ? <FirstChannelWelcome onCreate={() => setWizardOpen(true)} /> : null}
        <div id="home"><OperationsOverview channels={channels.data ?? []} content={content.data ?? []} /></div>
        {channels.data?.length ? <HomeActions channels={channels.data ?? []} content={content.data ?? []} plans={publishPlans.data ?? []} accounts={platformAccounts.data ?? []} budgets={budgets.data ?? []} /> : null}
        <AutomationPanel runs={automationRuns.data ?? []} isLoading={automationRuns.isLoading} />
        </WorkspaceView>
        <WorkspaceView active={page} page="insights">
        <div className="workspace-filterbar">
        <label id="insights" className="max-w-sm text-sm font-medium">분석할 채널<select className="mt-2 h-10 w-full rounded-md border border-border px-3" value={insightChannelId} onChange={(event) => setInsightChannelId(event.target.value)}>{(channels.data ?? []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <div className="flex flex-wrap gap-3 text-sm"><label>분석 플랫폼<select className="ml-2 rounded border p-2" value={insightPlatform} onChange={(event) => setInsightPlatform(event.target.value)}><option value="">전체</option>{(["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const).map((platform) => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}</select></label><label>분석 기간<select className="ml-2 rounded border p-2" value={insightDays} onChange={(event) => setInsightDays(Number(event.target.value))}><option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option></select></label></div>
        </div>
        <AnalyticsPanel report={analytics.data} isLoading={analytics.isLoading} />
        <div className="workspace-analysis-grid">
        <InsightControls request={request} channelId={insightChannelId} platform={insightPlatform} days={insightDays} owner={session.workspace.role === "OWNER"} />
        <OptimizationPanel channelId={insightChannelId} suggestions={suggestions.data ?? []} isLoading={suggestions.isLoading} />
        </div>
        <details className="workspace-advanced"><summary>실험 및 전략 관리<span>영상 길이 비교 · 적용 이력</span></summary><div className="workspace-advanced-content">
        <ExperimentPanel channelId={insightChannelId || channels.data?.[0]?.id || ""} />
        <StrategyPanel channelId={insightChannelId} />
        </div></details>
        </WorkspaceView>
        <WorkspaceView active={page} page="settings">
        <div aria-label="비용 필터" className="cost-filters flex flex-wrap gap-3 rounded border bg-white p-3 text-sm" data-testid="cost-filters" role="group"><label>비용 채널<select className="ml-2 rounded border p-2" value={costChannel} onChange={(event) => { setCostChannel(event.target.value); setCostContent(""); }}><option value="">전체</option>{channels.data?.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label>비용 콘텐츠<select className="ml-2 rounded border p-2" value={costContent} onChange={(event) => setCostContent(event.target.value)}><option value="">전체</option>{content.data?.filter((item) => !costChannel || item.channelId === costChannel).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>비용 제공자<input className="ml-2 rounded border p-2" placeholder="전체 또는 제공자 이름" value={costProvider} onChange={(event) => setCostProvider(event.target.value)} /></label><label>비용 기간<select className="ml-2 rounded border p-2" value={costDays} onChange={(event) => setCostDays(Number(event.target.value))}>{[7, 30, 90].map((days) => <option key={days} value={days}>최근 {days}일</option>)}</select></label></div>
        <div id="settings"><BusinessHealthPanel channels={channels.data ?? []} /><OperationsPanel costs={costs.data} notifications={notifications.data ?? []} isLoading={costs.isLoading || notifications.isLoading} /></div>
        <ProviderControls request={request} owner={session.workspace.role === "OWNER"} />
        <BudgetPanel budgets={budgets.data ?? []} channels={channels.data ?? []} isLoading={budgets.isLoading} onError={setError} />

        </WorkspaceView>
        <WorkspaceView active={page} page="channels">
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
        </WorkspaceView>
        <WorkspaceView active={page} page="ideas">
        <div id="ideas"><IdeasPanel channels={channels.data ?? []} onError={setError} /></div>
        </WorkspaceView>
        <WorkspaceView active={page} page="content">
        <ContentPanel channels={channels.data ?? []} content={content.data ?? []} isLoading={content.isLoading} onError={setError} selectedId={selectedContentId} onSelect={(id) => { setSelectedContentId(id); const url = new URL(window.location.href); url.searchParams.set("content", id); window.history.replaceState({}, "", url); }} />

        <ReviewPanel owner={session.workspace.role === "OWNER"} channels={channels.data ?? []} platform={selectedReviewPlatform} setPlatform={selectReviewPlatform} accounts={platformAccounts.data ?? []} content={content.data ?? []} contentItemId={selectedContentId} onSelectContent={(id) => { setSelectedContentId(id); const url = new URL(window.location.href); url.searchParams.set("content", id); window.history.replaceState({}, "", url); }} onError={setError} />
        </WorkspaceView>
        <WorkspaceView active={page} page="calendar">
        <div id="calendar"><CalendarPanel owner={session.workspace.role === "OWNER"} channels={channels.data ?? []} plans={publishPlans.data ?? []} onSelect={(id, platform) => { window.location.hash = "content"; selectReviewPlatform(platform); setSelectedContentId(id); const url = new URL(window.location.href); url.searchParams.set("content", id); window.history.replaceState({}, "", url); }} /></div>
        </WorkspaceView>
      {wizardOpen ? <ChannelWizard onClose={() => setWizardOpen(false)} onError={setError} /> : null}
    </WorkspaceShell>
  );
};

const AutomationPanel = ({ runs, isLoading }: { runs: AutomationRunResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const control = useMutation({
    mutationFn: ({ runId, action, stage, platform }: { runId: string; action: "pause" | "resume" | "retry" | "kill"; stage?: string; platform?: Platform | null }) => request(`/automation/runs/${runId}/control`, { method: "POST", body: JSON.stringify({ action, stage, platform: platform ?? undefined }) }, AutomationRunResponseSchema),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ["automation-runs"] }); void cache.invalidateQueries({ queryKey: ["content"] }); }
  });
  return <section id="automation" className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="automation-panel">
    <div><h2 className="text-lg font-semibold">자동화 운영</h2><p className="mt-1 text-sm text-muted-foreground">실행 상태, 최근 신호, 실패 단계와 운영자 보류 상태를 확인합니다.</p></div>
    {control.error ? <p role="alert" className="mt-3 text-sm text-red-700">{control.error.message}</p> : null}
    {runs.filter((run) => run.checkpoint?.skipped === true).map((run) => <p className="mt-3 text-sm" key={`empty-${run.id}`}>사용 가능한 새 소재가 없어 유료 제작을 시작하지 않았습니다. 다음 수집: {run.nextRunAt ? new Date(run.nextRunAt).toLocaleString() : "수집 설정 확인 필요"}</p>)}
    {runs.filter((run) => run.createdAt).map((run) => <p className="mt-3 text-sm" key={`elapsed-${run.id}`}>{statusLabel(run.status)} · {run.steps.filter((step) => step.status === "SUCCEEDED").length}/{run.steps.length}단계 완료 · {run.finishedAt ? "총 소요" : "경과"} {Math.max(0, Math.floor((new Date(run.finishedAt ?? Date.now()).getTime() - new Date(run.createdAt ?? Date.now()).getTime()) / 60_000))}분</p>)}
    {runs.map((run) => <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" key={`actions-${run.id}`}><span>{stageLabel(run.steps.find((step) => ["RUNNING", "QUEUED", "HELD", "FAILED"].includes(step.status))?.stage ?? "COLLECT")} · 다음 실행 {run.nextRunAt ? new Date(run.nextRunAt).toLocaleString() : "미정"}</span>{run.steps.filter((step) => ["FAILED", "HELD"].includes(step.status)).map((step) => <div className="rounded border border-border p-2" key={`${step.stage}-${step.platform}`}><p>{platformLabel(step.platform)} {stageLabel(step.stage)}: {step.errorMessage ?? step.errorCode ?? run.pausedReason ?? "확인 필요"}</p><p className="text-xs text-muted-foreground">원인을 해결한 뒤 이 단계만 다시 실행할 수 있습니다. 예산 부족은 사용량·설정, 승인 대기는 콘텐츠 검수에서 해결하세요.</p><Button disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "retry", stage: step.stage, platform: step.platform })}>이 단계 재시도</Button></div>)}{!["SUCCEEDED", "CANCELLED"].includes(run.status) ? <Button className="bg-foreground" disabled={control.isPending} onClick={() => { if (window.confirm("이 제작을 취소할까요? 이미 진행 중인 작업은 중단 요청을 받으며 완료된 결과는 유지됩니다.")) control.mutate({ runId: run.id, action: "kill" }); }}>제작 취소</Button> : null}</div>)}
    {isLoading ? <p className="mt-4 text-sm text-muted-foreground">자동화 실행을 불러오는 중입니다.</p> : runs.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">아직 자동화 실행 기록이 없습니다.</p> : <div className="mt-4 grid gap-2">{runs.slice(0, 10).map((run) => <article className="rounded-md border border-border p-3 text-sm" key={run.id}><div className="flex items-center justify-between gap-3"><span className="font-medium">{statusLabel(run.status)}</span><span className="text-xs text-muted-foreground">{run.heartbeatAt ?? "최근 신호 없음"}</span></div><p className="mt-2 text-xs text-muted-foreground">{run.status === "SUCCEEDED" ? "완료됨 (과거 오류는 작업 이력에서 확인)" : run.lastErrorCode ?? run.pausedReason ?? "오류 없음"}</p><div className="mt-2 flex flex-wrap gap-1">{run.steps.map((step) => <span className="rounded bg-muted px-2 py-1 text-xs" key={`${step.stage}-${step.platform ?? "COMMON"}`}>{platformLabel(step.platform)} · {stageLabel(step.stage)}: {statusLabel(step.status)}</span>)}</div>{run.steps.filter((step) => ["FAILED", "HELD"].includes(step.status) && step.stage !== "PUBLISH").map((step) => <div className="mt-2 rounded border p-2" key={`${step.platform}:${step.stage}`}><p>{platformLabel(step.platform)} · {stageLabel(step.stage)}: {step.errorMessage ?? step.errorCode ?? "원인을 확인해 주세요."}</p><p className="text-xs">권리·예산·Provider 차단 원인을 해소한 뒤 재시도하세요. 새로운 비용이 발생할 수 있습니다.</p><Button disabled={control.isPending} onClick={() => { if (window.confirm("원인을 해소했으며 이 단계만 재시도할까요?")) control.mutate({ runId: run.id, action: "retry", stage: step.stage, platform: step.platform }); }}>해당 단계 재시도</Button></div>)}{["RUNNING", "QUEUED"].includes(run.status) ? <Button className="mt-3 h-8" disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "pause" })}>일시 중지</Button> : run.status === "PAUSED" ? <Button className="mt-3 h-8" disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "resume" })}>다시 시작</Button> : null}</article>)}</div>}
  </section>;
};

const AnalyticsPanel = ({ report, isLoading }: { report: AnalyticsReportResponse | undefined; isLoading: boolean }): ReactElement => <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="analytics-panel">
  {report?.lastError ? <p role="alert">최근 수집 실패: {report.lastError}</p> : null}
  <div><h2 className="text-lg font-semibold">성과 분석</h2><p className="mt-1 text-sm text-muted-foreground">영상별 최신·이전 스냅샷입니다. 겹치는 기간의 값은 합산하지 않습니다. average_view_ratio는 평균 시청 비율, reach는 도달 수이며 완주율·노출 수와 다릅니다.</p></div>
  {isLoading ? <p className="mt-4 text-sm text-muted-foreground">성과 지표를 불러오는 중입니다.</p> : !report || report.metrics.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">이 기간에 동기화된 지표가 없습니다.</p> : <><div className="mt-4 grid gap-2 md:grid-cols-2">{report.metrics.map((metric) => <article className="rounded-md border border-border p-3 text-sm" key={metric.id ?? `${metric.platformPostId}-${metric.metric}-${metric.observedAt}-${metric.revision}`}><p className="font-medium">{metric.title ?? "영상"} · {metric.platform ?? ""} · {metric.metric}</p><p className="text-xs">{metric.latest === false ? "이전 스냅샷" : "최신 스냅샷"} · 게시물 {metric.externalPostId ?? "미제공"} · 조회 기간 {metric.observationKind === "LIFETIME_SNAPSHOT" ? "\uc218\uc9d1 \uc2dc\uc810 \ub204\uc801\uac12" : metric.periodStart && metric.periodEnd ? `${metric.periodStart} ~ ${metric.periodEnd}` : "\uad00\uce21 \uae30\uac04 \ubbf8\ud655\uc778"}</p><p className="mt-1 text-lg">{metric.status === "AVAILABLE" ? `${metric.value ?? 0} ${metric.unit ?? ""}` : "사용할 수 없음"}</p><p className="mt-1 text-xs text-muted-foreground">{metric.unavailableReason ?? `${metric.aggregation ?? "원본"} · ${metric.observedAt}`}</p></article>)}</div><p className="mt-3 text-xs text-muted-foreground">{report.partial ? "일부 데이터 또는 사용할 수 없는 지표가 포함되어 있습니다." : "반환된 모든 지표를 사용할 수 있습니다."} 마지막 동기화: {report.lastSyncedAt ?? "기록 없음"}</p></>}
</section>;

const OptimizationPanel = ({ channelId, suggestions, isLoading }: { channelId: string; suggestions: OptimizationSuggestionResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const readiness = useQuery({ queryKey: ["analysis-readiness", channelId], enabled: Boolean(channelId), queryFn: () => request(`/optimization/channels/${channelId}/analysis-status`, {}, z.object({ status: z.string(), requiredDistinctPosts: z.number(), maximumComparablePosts: z.number(), nextCheckAt: z.string() })) });
  const readinessMessage = readiness.data ? <p className="my-3 text-sm">{readiness.data.status === "READY" ? "새 데이터 분석 예약 대상입니다." : "새 비교 가능 데이터를 기다립니다."} 비교 가능 {readiness.data.maximumComparablePosts}편 · 필요 {readiness.data.requiredDistinctPosts}편 · 다음 확인 {new Date(readiness.data.nextCheckAt).toLocaleString()}. YouTube 원래 지표와 Postbot 편집 전략은 구분하며 정책상 제한되는 파생 분석은 보류합니다.</p> : null;
  const action = useMutation({ mutationFn: ({ id, next }: { id: string; next: "approve" | "reject" | "apply" }) => request(`/optimization/suggestions/${id}/action`, { method: "POST", body: JSON.stringify({ action: next }) }, OptimizationSuggestionResponseSchema), onSuccess: () => { void cache.invalidateQueries({ queryKey: ["optimization-suggestions"] }); void cache.invalidateQueries({ queryKey: ["strategy-versions"] }); } });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="optimization-panel">{readinessMessage}{action.error ? <p role="alert" className="text-sm text-red-700">{action.error.message}</p> : null}<div><h2 className="text-lg font-semibold">최적화 제안</h2><p className="mt-1 text-sm text-muted-foreground">상관관계 기반 가설과 근거, 승인 이력, 안전하게 되돌릴 수 있는 전략 변경을 보여줍니다.</p></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">최적화 제안을 불러오는 중입니다.</p> : suggestions.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">아직 제안이 없습니다. 먼저 분석 데이터를 동기화하고 비교 집단을 생성해 주세요.</p> : <div className="mt-4 grid gap-2">{suggestions.map((suggestion) => <article className="rounded-md border border-border p-3 text-sm" key={suggestion.id}><div className="flex items-center justify-between gap-2"><p className="font-medium">{suggestion.title}</p><span className="rounded bg-muted px-2 py-1 text-xs">{statusLabel(suggestion.status)}</span></div><p className="mt-2 text-muted-foreground">{suggestion.rationale}</p><details className="mt-2"><summary>비교 근거·변경안·위험 확인</summary><p>표본 부족 또는 허용되지 않은 변경은 적용할 수 없습니다. 효과는 가설이며 비교 실험으로 검증해야 합니다.</p><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({ evidence: suggestion.evidence, targetStrategy: suggestion.targetStrategy, expectedImpact: suggestion.expectedImpact, risk: suggestion.risk }, null, 2)}</pre></details><p className="mt-2 text-xs text-muted-foreground">표본: {suggestion.sampleSize} · 통계적 신뢰도: 미산정 · 만료: {suggestion.expiresAt ?? "없음"}</p>{suggestion.status === "PENDING" ? <div className="mt-3 flex gap-2"><Button className="h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "approve" })}>승인</Button><Button className="h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "reject" })}>거절</Button></div> : suggestion.status === "APPROVED" ? <Button className="mt-3 h-8" disabled={action.isPending || !suggestion.targetStrategy} onClick={() => { if (window.confirm("승인한 길이 전략을 이후 제작에 적용할까요? 기존 콘텐츠와 예약은 바뀌지 않습니다.")) action.mutate({ id: suggestion.id, next: "apply" }); }}>승인 전략 적용</Button> : null}</article>)}</div>}</section>;
};

const ExperimentResult = ({ result }: { result: unknown }): ReactElement => {
  const parsed = z.object({ control: z.object({ sampleSize: z.number(), mean: z.number().nullable() }), variant: z.object({ sampleSize: z.number(), mean: z.number().nullable() }), relativeChange: z.number().nullable(), winner: z.string() }).safeParse(result);
  if (!parsed.success) return <p>아직 가용 지표 비교 결과가 없습니다.</p>;
  const value = parsed.data;
  return <div className="mt-2 text-sm"><p>대조군: {value.control.sampleSize}건 · 평균 {value.control.mean ?? "없음"}</p><p>변경군: {value.variant.sampleSize}건 · 평균 {value.variant.mean ?? "없음"}</p><p>상대 변화: {value.relativeChange === null ? "산출 불가" : `${(value.relativeChange * 100).toFixed(1)}%`} · 판정: {value.winner === "variant" ? "변경군 우세 가설" : value.winner === "control" ? "대조군 우세 가설" : "결론 유보"}</p></div>;
};

const ExperimentPanel = ({ channelId }: { channelId: string }): ReactElement => {
  const cache = useQueryClient();
  const [name, setName] = useState(""); const [hypothesis, setHypothesis] = useState(""); const [platform, setPlatform] = useState<Platform>("YOUTUBE");
  const [maximum, setMaximum] = useState(100);
  const [metric, setMetric] = useState("views"); const [period, setPeriod] = useState(30); const [minimum, setMinimum] = useState(4); const [control, setControl] = useState(40); const [variant, setVariant] = useState(44); const [threshold, setThreshold] = useState(0.1); const [direction, setDirection] = useState<"higher" | "lower">("higher");
  const experiments = useQuery({ queryKey: ["experiments", channelId], enabled: Boolean(channelId), queryFn: () => request(`/optimization/experiments?channelId=${encodeURIComponent(channelId)}`, { method: "GET" }, ExperimentResponseSchema.array()), refetchInterval: 10000 });
  const refresh = () => { void cache.invalidateQueries({ queryKey: ["experiments", channelId] }); };
  const create = useMutation({ mutationFn: () => request("/optimization/experiments", { method: "POST", body: JSON.stringify(CreateExperimentRequestSchema.parse({ channelId, name, hypothesis, platform, targetMetric: metric, periodDays: period, minSampleSize: minimum, control: { durationSeconds: control }, variant: { durationSeconds: variant }, successCriteria: { direction, minRelativeImprovement: threshold }, stopCriteria: { maxAssignments: maximum } })) }, ExperimentResponseSchema), onSuccess: refresh });
  const action = useMutation({ mutationFn: ({ id, next }: { id: string; next: "start" | "pause" | "stop" | "complete" }) => request(`/optimization/experiments/${id}/action`, { method: "POST", body: JSON.stringify({ action: next }) }, ExperimentResponseSchema), onSuccess: refresh });
  const fields = [{ label: "실험 기간 일", value: period, setter: setPeriod }, { label: "최대 제작 배정 수", value: maximum, setter: setMaximum }, { label: "그룹별 최소 표본", value: minimum, setter: setMinimum }, { label: "대조군 길이 초", value: control, setter: setControl }, { label: "변경군 길이 초", value: variant, setter: setVariant }, { label: "최소 상대 개선율", value: threshold, setter: setThreshold }];
  return <section className="rounded border border-border bg-white p-5" data-testid="experiment-panel"><h2 className="text-lg font-semibold">제한형 실험</h2><p className="mt-2 text-sm">같은 채널·플랫폼의 다음 전체 제작에 대조/변경 길이를 안정적으로 배정합니다. 기간 종료 후에는 새 배정을 중단합니다. 설정된 변경 폭·길이 범위·보호 주제·권리·정책·예산은 유지합니다. 결과는 가설이며 인과 효과나 통계적 유의성을 주장하지 않습니다.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><label>실험 이름<input className="block w-full rounded border p-2" value={name} onChange={(event) => setName(event.target.value)} /></label><label>가설<input className="block w-full rounded border p-2" value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} /></label><label>실험 플랫폼<select className="block w-full rounded border p-2" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>{platforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>목표 지표<input className="block w-full rounded border p-2" value={metric} onChange={(event) => setMetric(event.target.value)} /></label>{fields.map((field) => <label key={field.label}>{field.label}<input className="block w-full rounded border p-2" type="number" step={field.label === "최소 상대 개선율" ? "0.01" : "1"} value={field.value} onChange={(event) => field.setter(Number(event.target.value))} /></label>)}<label>개선 방향<select className="block w-full rounded border p-2" value={direction} onChange={(event) => setDirection(event.target.value === "lower" ? "lower" : "higher")}><option value="higher">높을수록 좋음</option><option value="lower">낮을수록 좋음</option></select></label><Button disabled={!channelId || create.isPending} onClick={() => create.mutate()}>실험 초안 생성</Button></div>{create.error || action.error || experiments.error ? <p role="alert" className="mt-3">{(create.error ?? action.error ?? experiments.error)?.message}</p> : null}{experiments.data?.map((experiment) => <article key={experiment.id} className="mt-4 rounded border p-3"><h3>{experiment.name} · {statusLabel(experiment.status)}</h3><p className="text-sm">{experiment.hypothesis} · {experiment.targetMetric} · 그룹별 최소 {experiment.minSampleSize}건</p><div className="mt-2 flex flex-wrap gap-2">{["DRAFT", "PAUSED"].includes(experiment.status) ? <Button disabled={action.isPending} onClick={() => action.mutate({ id: experiment.id, next: "start" })}>실험 시작</Button> : null}{experiment.status === "RUNNING" ? <Button disabled={action.isPending} onClick={() => action.mutate({ id: experiment.id, next: "pause" })}>실험 일시 중지</Button> : null}{["RUNNING", "PAUSED"].includes(experiment.status) ? <><Button disabled={action.isPending} onClick={() => action.mutate({ id: experiment.id, next: "complete" })}>가용 성과로 비교 완료</Button><Button className="bg-foreground" disabled={action.isPending} onClick={() => { if (window.confirm("이 실험의 새 배정을 중단할까요?")) action.mutate({ id: experiment.id, next: "stop" }); }}>실험 중단</Button></> : null}</div><ExperimentResult result={experiment.result} /></article>)}</section>;
};

const StrategyPanel = ({ channelId }: { channelId: string }): ReactElement => {
  const cache = useQueryClient();
  const versions = useQuery({ queryKey: ["strategy-versions", channelId], enabled: Boolean(channelId), queryFn: () => request(`/optimization/channels/${channelId}/strategies`, { method: "GET" }, { parse: (value: unknown) => StrategyVersionResponseSchema.array().parse(value) }) });
  const rollback = useMutation({ mutationFn: (version: number) => request(`/optimization/channels/${channelId}/rollback/${version}`, { method: "POST", body: "{}" }, { parse: () => ({ ok: true }) }), onSuccess: () => void cache.invalidateQueries({ queryKey: ["strategy-versions", channelId] }) });
  return <section className="rounded border border-border bg-white p-5"><h2 className="text-lg font-semibold">전략 적용 이력·되돌리기</h2><p className="mt-1 text-sm text-muted-foreground">선택한 전략은 이후 제작에만 적용됩니다. 기존 예약은 그대로 유지됩니다. 제한형 실험의 배정·비교는 실험 패널에서 관리합니다.</p>{versions.isError ? <p role="alert">전략 이력을 불러오지 못했습니다.</p> : versions.data?.map((version, index) => <div key={version.version} className="mt-3 flex items-center justify-between gap-2 text-sm"><span>버전 {version.version} · {version.name} · {index === 0 ? "현재 적용" : "이전 전략"}</span>{index > 0 ? <Button disabled={rollback.isPending} onClick={() => { if (window.confirm("이 전략으로 이후 제작 설정을 되돌릴까요?")) rollback.mutate(version.version); }}>이 전략으로 되돌리기</Button> : null}</div>)}{rollback.error ? <p role="alert">{rollback.error.message}</p> : null}{rollback.isSuccess ? <p role="status">전략을 복원했습니다. 다음 제작부터 반영됩니다.</p> : null}</section>;
};

const BusinessHealthPanel = ({ channels }: { channels: ChannelResponse[] }): ReactElement => {
  const [selected, setSelected] = useState(""); const channelId = selected || channels[0]?.id || "";
  const health = useQuery({ queryKey: ["business-health", channelId], enabled: Boolean(channelId), queryFn: () => request(`/operations/channels/${channelId}/business-health`, {}, z.object({ state: z.string(), issues: z.array(z.string()), lastCollectionAt: z.string().nullable(), lastProductionAt: z.string().nullable(), lastPublicationAt: z.string().nullable(), externalNotifications: z.string(), backup: z.object({ state: z.string() }), dailySummary: z.object({ recordedCost: z.string(), currency: z.string() }) })) });
  const labels: Record<string, string> = { CHANNEL_NOT_CONFIGURED: "계정·일정 미설정", MISSED_PUBLICATION: "게시 예정 시각 누락", STALE_WORK: "오래된 작업 대기", REPEATED_FAILURES: "반복 실패", BUDGET_HOLD: "예산 보류", ACCOUNT_REAUTH_REQUIRED: "계정 재인증 필요", TEMP_STORAGE_LOW: "임시 저장 공간 부족" };
  return <section className="rounded border p-5" data-testid="business-health-panel"><h2 className="text-lg font-semibold">채널 업무 진행 상태</h2><p className="text-sm">프로세스 상태와 별도로 수집·제작·게시 진행을 확인합니다.</p><label className="block">상태를 확인할 채널<select className="my-2 w-full rounded border p-2" value={channelId} onChange={(event) => setSelected(event.target.value)}>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>{health.data ? <><p>{health.data.issues.length ? health.data.issues.map((issue) => labels[issue] ?? issue).join(" · ") : "감지된 업무 경고 없음"}</p><p className="mt-2 text-sm">마지막 수집: {health.data.lastCollectionAt ?? "기록 없음"} · 제작: {health.data.lastProductionAt ?? "기록 없음"} · 공개 게시: {health.data.lastPublicationAt ?? "기록 없음"}</p><p className="mt-2 text-sm">외부 알림: {health.data.externalNotifications === "MOCK_ONLY" ? "Mock 검증 전용" : "미설정"} · 백업: {health.data.backup.state === "NOT_CONFIGURED" ? "미설정" : health.data.backup.state === "LOCAL_TEST_ONLY" ? "로컬 검증 전용" : health.data.backup.state}</p><p className="text-sm">오늘 기록 비용: {health.data.dailySummary.recordedCost} {health.data.dailySummary.currency} (확정 청구액 또는 알려진 추정액)</p></> : <p>{health.error ? "업무 상태를 불러오지 못했습니다." : "업무 상태 확인 중"}</p>}</section>;
};

const OperationsPanel = ({ costs, notifications, isLoading }: { costs: CostReportResponse | undefined; notifications: NotificationResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const acknowledge = useMutation({ mutationFn: (id: string) => request(`/operations/notifications/${id}/acknowledge`, { method: "POST" }, NotificationResponseSchema), onSuccess: () => void cache.invalidateQueries({ queryKey: ["operations-notifications"] }) });
return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="operations-panel"><div><h2 className="text-lg font-semibold">운영 비용 및 알림</h2><p className="mt-1 text-sm text-muted-foreground">원장과 대조한 비용 합계와 앱 내 운영 알림입니다.</p></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">운영 데이터를 불러오는 중입니다.</p> : <><div className="mt-4 grid gap-2 md:grid-cols-4"><article className="rounded border border-border p-3 text-sm"><p>예상 비용</p><p className="mt-1 text-lg">{costs?.estimated ?? "조회 실패"} {costs?.currency ?? "USD"}</p></article><article className="rounded border border-border p-3 text-sm"><p>실제 비용</p><p className="mt-1 text-lg">{costs?.actual ?? "조회 실패"} {costs?.currency ?? "USD"}</p></article><article className="rounded border border-border p-3 text-sm"><p>환급</p><p className="mt-1 text-lg">{costs?.credit ?? "조회 실패"}</p></article><article className="rounded border border-border p-3 text-sm"><p>원장 대조</p><p className="mt-1 text-lg">{!costs ? "조회 실패" : costs.reconciled ? "일치" : `차이 ${costs.discrepancy}`}</p></article></div><p className="mt-3 text-xs">예상 단가와 실제 Provider 청구는 다를 수 있습니다. 단가 미확정 Provider는 제작을 보류합니다. Fake 사용량의 비용은 실 청구가 아닙니다.</p>{costs?.byProvider.map((provider) => <p className="mt-2 text-sm" key={provider.provider}>{provider.provider}: 예상 {provider.estimated} · 실제 {provider.actual} · 환급 {provider.credit} USD</p>)}<div className="mt-4 grid gap-2">{notifications.length === 0 ? <p className="text-sm text-muted-foreground">운영 알림이 없습니다.</p> : notifications.slice(0, 10).map((notification) => <article className="flex items-center justify-between gap-3 rounded border border-border p-3 text-sm" key={notification.id}><div><span>{statusLabel(notification.severity)} · {notification.eventKey}</span><p className="mt-1 text-xs">{new Date(notification.createdAt).toLocaleString()}</p><a className="mt-1 block underline" href={/budget|cost/i.test(notification.eventKey) ? "#settings" : /account|oauth|token/i.test(notification.eventKey) ? "#channels" : /policy|review|license/i.test(notification.eventKey) ? "#content" : "#automation"}>관련 운영 화면에서 원인 확인·복구</a></div>{notification.acknowledgedAt ? <span className="text-xs text-muted-foreground">확인함</span> : <Button className="h-8" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(notification.id)}>확인</Button>}</article>)}</div></>}</section>;
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
const CalendarPanel = ({ channels, plans, onSelect, owner }: { channels: ChannelResponse[]; plans: PublishCalendarItem[]; onSelect: (id: string, platform: Platform) => void; owner: boolean }): ReactElement => {
  const cache = useQueryClient();
  const change = useMutation({ mutationFn: (plan: PublishCalendarItem) => request(`/publishing/plans/${plan.id}/cancel`, { method: "POST", body: "{}" }, { parse: () => ({ ok: true }) }), onSuccess: (_, plan) => { void cache.invalidateQueries({ queryKey: ["publish-plans"] }); void cache.invalidateQueries({ queryKey: ["content"] }); onSelect(plan.contentItemId, plan.platform); document.getElementById("content")?.scrollIntoView({ block: "start" }); } });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="calendar-panel">
    <h2 className="text-lg font-semibold">게시 캘린더</h2><p className="mt-1 text-sm text-muted-foreground">반복 슬롯과 실제 예약·게시 결과를 구분합니다. 예약 변경은 기존 예약을 취소한 뒤 검수 화면에서 새 시간으로 예약합니다.</p>
    {change.error ? <p role="alert" className="mt-2 text-sm text-red-700">{change.error.message}</p> : null}
    {plans.length > 0 ? <div className="mt-4 grid gap-2">{plans.map((plan) => <article className="rounded border border-primary/30 bg-primary/5 p-3 text-sm" key={plan.id}>
      <div className="flex items-center justify-between gap-3"><button type="button" className="font-medium underline" onClick={() => { onSelect(plan.contentItemId, plan.platform); document.getElementById("content")?.scrollIntoView({ block: "start" }); }}>{plan.title} · {platformLabel(plan.platform)}</button><span>{plan.visibility === "private" && plan.status === "UPLOADED" ? "비공개 업로드 완료" : statusLabel(plan.status)}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">예약: {new Date(plan.scheduledAt).toLocaleString()} · 게시: {plan.publishedAt ? new Date(plan.publishedAt).toLocaleString() : plan.status === "PUBLISHED" ? "게시 확인 · 시각 미제공" : "공개 완료 미확인"}</p>
      {plan.failureReason ? <p role="alert">{plan.failureReason}</p> : null}
      {plan.publicationState === "LEGACY_UNCONFIRMED" ? <p>플랫폼에서 공개 상태를 다시 확인해야 합니다.</p> : null}
      {plan.postUrl ? <a className="mt-1 block text-primary" href={plan.postUrl} rel="noreferrer" target="_blank">게시물 열기</a> : null}
      {owner && (plan.publicationState || plan.reconciliationRequired) ? <PublicationReconciliation plan={plan} submit={async (input) => {
        await request(`/publishing/plans/${plan.id}/reconcile`, { method: "POST", body: JSON.stringify(input) }, { parse: (value: unknown) => z.object({ jobId: z.string(), publishPlanId: z.string() }).parse(value) });
        await cache.invalidateQueries({ queryKey: ["publish-plans"] }); await cache.invalidateQueries({ queryKey: ["content"] });
      }} /> : null}
      {["SCHEDULED", "HELD", "FAILED"].includes(plan.status) && (!plan.publicationState || plan.publicationState === "FAILED") ? <Button className="mt-2" disabled={change.isPending || plan.reconciliationRequired === true} onClick={() => { if (window.confirm("기존 예약을 취소하고 검수 화면에서 새 시간을 선택할까요? 새 예약을 저장하기 전까지 게시되지 않습니다.")) change.mutate(plan); }}>예약 변경</Button> : null}
    </article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">아직 실제 예약 게시물이 없습니다.</p>}
    <h3 className="mt-5 text-sm font-semibold">반복 게시 슬롯</h3>
    <div className="mt-4 grid gap-3 md:grid-cols-7">{weekdayLabels.map((day, index) => <article className="min-h-32 rounded-md border border-border p-3" key={day}><h3 className="text-sm font-semibold">{day}</h3><div className="mt-3 space-y-2">{channels.flatMap((channel) => channel.scheduleRules.filter((rule) => rule.dayOfWeek === index).map((rule) => ({ channel, rule }))).map(({ channel, rule }) => <div className="rounded bg-muted p-2 text-xs" key={`${channel.id}-${rule.platform}-${rule.timeOfDayLocal}`}><p className="font-medium">{rule.timeOfDayLocal} · {rule.timezone}</p><p className="mt-1">{channel.name}</p><p>{platformLabel(rule.platform)} · 최대 {rule.maxPosts}개</p></div>)}</div></article>)}</div>
  </section>;
};

const ReviewPanel = ({ owner, channels, platform, setPlatform, accounts, content, contentItemId, onSelectContent, onError }: { owner: boolean; channels: ChannelResponse[]; platform: Platform; setPlatform: (platform: Platform) => void; accounts: PlatformAccountResponse[]; content: ContentItemSummary[]; contentItemId: string | null; onSelectContent: (id: string) => void; onError: (error: string) => void }): ReactElement => {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [regenerationPart, setRegenerationPart] = useState<"full" | "hook" | "body" | "metadata" | "scene" | "voice" | "subtitle">("full");
  const [licenseAssetId, setLicenseAssetId] = useState(""); const [licenseProof, setLicenseProof] = useState(""); const [licenseName, setLicenseName] = useState(""); const [commercialAllowed, setCommercialAllowed] = useState(false); const [derivativeAllowed, setDerivativeAllowed] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => localDateTimeValue(new Date(Date.now() + 10 * 60_000)));
  const review = useQuery({ queryKey: ["content-review", contentItemId], queryFn: () => fetchReview(contentItemId ?? ""), enabled: Boolean(contentItemId), retry: false, refetchInterval: 5_000 });
  const previewOutput = review.data?.outputs.find((output) => output.platform === platform);
  const preview = useQuery({ queryKey: ["content-preview", contentItemId, platform, previewOutput?.sceneVersionId], queryFn: () => request(`/content/${contentItemId}/review/preview?platform=${platform}`, { method: "GET" }, ReviewPreviewResponseSchema), enabled: Boolean(contentItemId && previewOutput?.videoReady), retry: false, refetchInterval: 600_000 });
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
  const canRegenerate = channels.find((channel) => channel.id === data?.channelId)?.status === "ACTIVE";
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
    mutationFn: (partial: "full" | "hook" | "body" | "metadata" | "scene" | "voice" | "subtitle") => {
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
      return request("/publishing/plans", { method: "POST", body: JSON.stringify({ contentItemId, platformAccountId: account.id, scheduledAt: new Date(scheduledAt).toISOString(), idempotencyKey: `review:${contentItemId}:${platform}:${crypto.randomUUID()}` }) }, PublishPlanResponseSchema);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); void queryClient.invalidateQueries({ queryKey: ["content"] }); void queryClient.invalidateQueries({ queryKey: ["publish-plans"] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "게시 예약에 실패했습니다.")
  });
  const license = useMutation({ mutationFn: (status: "VERIFIED" | "REJECTED") => request(`/content/${contentItemId}/review/asset-license`, { method: "POST", body: JSON.stringify({ assetId: licenseAssetId, proofUrl: licenseProof, licenseName, status, commercialUseAllowed: commercialAllowed, derivativeAllowed }) }, ContentReviewResponseSchema), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); void queryClient.invalidateQueries({ queryKey: ["content"] }); void queryClient.invalidateQueries({ queryKey: ["publish-plans"] }); } });
  return <section id="content" className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="review-panel">
    <p className="text-xs text-muted-foreground">출처 링크와 정책 통과는 사실 확인 완료를 뜻하지 않습니다. 원문이 없는 경우 링크를 열어 직접 확인하세요. 역사 이미지의 인물·복식·시대 고증과 영상 품질은 사람이 별도로 확인해야 합니다.</p>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">콘텐츠 검토</h2><p className="mt-1 text-sm text-muted-foreground">목록에서 콘텐츠를 선택해 플랫폼별 결과물과 게시 준비 상태를 검토합니다.</p></div><div className="flex gap-2"><label className="sr-only" htmlFor="review-content">검토할 콘텐츠</label><select id="review-content" aria-label="검토할 콘텐츠" className="h-10 min-w-56 rounded-md border border-border px-3 text-sm" onChange={(event) => onSelectContent(event.target.value)} value={contentItemId ?? ""}><option value="">콘텐츠 선택</option>{content.map((item) => <option key={item.id} value={item.id}>{item.title} · {statusLabel(item.status)}</option>)}</select><Button disabled={!contentItemId || policyCheck.isPending || !output?.videoReady} onClick={() => policyCheck.mutate(platform)}>정책 검사</Button></div></div>
    <div className="mt-4 flex gap-2" role="tablist" aria-label="검수 플랫폼">{(["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const).map((candidate) => <Button role="tab" tabIndex={platform === candidate ? 0 : -1} onKeyDown={(event) => { const tabs = ["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const; const index = tabs.indexOf(candidate); const next = event.key === "ArrowRight" ? tabs[(index + 1) % 3] : event.key === "ArrowLeft" ? tabs[(index + 2) % 3] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : undefined; if (next) { event.preventDefault(); setPlatform(next); const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]"); buttons?.[tabs.indexOf(next)]?.focus(); } }} aria-selected={platform === candidate} className={platform === candidate ? "" : "bg-foreground"} key={candidate} onClick={() => setPlatform(candidate)} type="button">{platformLabel(candidate)}</Button>)}</div>
    {data && !canRegenerate ? <p role="status" className="mt-3 text-sm">채널이 중지되어 재생성할 수 없습니다. 채널 운영을 재개하면 재생성할 수 있으며 검수·예약은 계속 가능합니다.</p> : null}
    {generationNotice ? <p role="status" className="mt-3 text-sm text-primary">{generationNotice}</p> : null}
  {data?.assets.length ? <details className="mt-3 rounded border border-border p-3 text-sm"><summary>에셋 권리 증빙 검토 (소유자)</summary><p className="mt-2">제공자 요금제·음성 동의·상업 사용·변형 권리를 직접 확인한 뒤 증빙을 등록합니다. URL만 입력했다고 권리가 자동 확인되는 것은 아닙니다. 변경 후 해당 자산을 사용하는 플랫폼만 재검사·재승인이 필요하며 해당 예약만 보류됩니다. 이미지 준비 중 권리 승인으로 멈췄다면 기존 이미지를 재사용해 자동으로 이어갑니다.</p><label className="mt-2 block">검토할 에셋<select className="ml-2 rounded border p-2" value={licenseAssetId} onChange={(event) => setLicenseAssetId(event.target.value)}><option value="">선택</option>{[...new Map(selectedAssets.map((asset) => [asset.id, asset])).values()].map((asset) => <option key={asset.id} value={asset.id}>{asset.purpose} · {statusLabel(asset.licenseStatus)}</option>)}</select></label><label className="mt-2 block">라이선스 이름<input className="ml-2 rounded border p-2" value={licenseName} onChange={(event) => setLicenseName(event.target.value)} /></label><label className="mt-2 block">권리 증빙 URL<input className="ml-2 rounded border p-2" type="url" value={licenseProof} onChange={(event) => setLicenseProof(event.target.value)} placeholder="https://" /></label><label className="mt-2 block"><input type="checkbox" checked={commercialAllowed} onChange={(event) => setCommercialAllowed(event.target.checked)} /> 상업 사용 허용을 확인했습니다</label><label className="mt-2 block"><input type="checkbox" checked={derivativeAllowed} onChange={(event) => setDerivativeAllowed(event.target.checked)} /> 변형·편집 허용을 확인했습니다</label><div className="mt-2 flex gap-2"><Button disabled={license.isPending || !licenseAssetId || !commercialAllowed || !derivativeAllowed || !licenseProof.startsWith("https://") || licenseName.length < 3} onClick={() => { if (window.confirm("실제 권리 증빙을 확인했으며 상업 사용을 승인할까요?")) license.mutate("VERIFIED"); }}>증빙 확인 후 승인</Button><Button disabled={license.isPending || !licenseAssetId || !licenseProof.startsWith("https://") || licenseName.length < 3} onClick={() => license.mutate("REJECTED")}>권리 사용 거절</Button></div>{license.error ? <p role="alert">{license.error.message}</p> : null}{license.isSuccess ? <p role="status">권리 검토를 기록했습니다. 정책 검사를 다시 실행해 주세요.</p> : null}</details> : null}
    {output?.script ? <details className="mt-3 rounded border border-border p-3 text-sm"><summary>대본·적용 언어 확인 ({output.script.language}, {output.durationSeconds ?? "미확정"}초)</summary><p className="mt-2">{output.script.hook}</p><p>{output.script.body}</p><p>{output.script.callToAction}</p></details> : null}
    {data && output ? <ScriptEditor request={request} owner={owner} review={data} output={output} /> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><label>재생성 범위<select aria-label="재생성 범위" className="ml-2 rounded border p-2" value={regenerationPart} onChange={(event) => setRegenerationPart(event.target.value as typeof regenerationPart)}>{[["full", "전체"], ["hook", "훅"], ["body", "본문"], ["metadata", "메타데이터"], ["scene", "장면 이미지"], ["voice", "음성만"], ["subtitle", "자막 스타일만"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button disabled={regenerate.isPending || !output || !canRegenerate} onClick={() => regenerate.mutate(regenerationPart)}>선택 범위 재생성</Button><p>선택 플랫폼의 새 버전을 만듭니다. 음성만은 대본·이미지를 재사용하고, 자막 스타일만은 대본·이미지·음성을 재사용합니다. 자막 스타일은 채널 설정을 먼저 수정해 주세요. 영상·정책 검사는 다시 실행합니다. 서버가 단계별 예상 비용을 산정하며 예산·단가 미확정 시 보류합니다.</p></div>
    {review.isLoading ? <p className="mt-4 text-sm text-muted-foreground">검토 정보를 불러오는 중입니다.</p> : null}
      {data ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><article className="rounded-md border border-border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">{platformLabel(platform)} 결과물</h3><span className="rounded bg-muted px-2 py-1 text-xs">{statusLabel(output?.publishStatus ?? output?.reviewStatus ?? "REVIEW_REQUIRED")}</span></div><p className="mt-2 text-xs text-muted-foreground">대본: {statusLabel(output?.scriptStatus ?? "없음")} · 장면: {output?.sceneVersionId ? "준비됨" : "없음"} · 렌더링: {statusLabel(output?.renderStatus ?? "PENDING")}</p>{preview.data ? <video className="mt-3 aspect-[9/16] max-h-[480px] w-full rounded bg-black" controls src={preview.data.url} /> : <p className="mt-3 rounded bg-muted p-4 text-sm">이 플랫폼 결과물의 렌더링 영상 미리보기가 없습니다.</p>}<label className="mt-4 block text-sm font-medium">제목<input className="mt-1 h-10 w-full rounded border border-border px-3" onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="mt-3 block text-sm font-medium">설명<textarea aria-label="설명" className="mt-1 min-h-24 w-full rounded border border-border p-3" onChange={(event) => setDescription(event.target.value)} value={description} /></label><Button className="mt-2" disabled={!output || metadata.isPending} onClick={() => setDescription((previous) => /(?:ai|인공지능)\s*(?:생성|generated|사용)/i.test(previous) ? previous : `${previous}\nAI 생성 콘텐츠 (AI generated).`)}>AI 생성 고지 추가</Button><p className="mt-1 text-xs">고지를 추가한 뒤 메타데이터 저장 → 정책 검사 → 승인을 진행하세요. 권리·사실·민감 주제 검사를 우회하지 않습니다.</p><label className="mt-3 block text-sm font-medium">해시태그<input className="mt-1 h-10 w-full rounded border border-border px-3" onChange={(event) => setHashtags(event.target.value)} value={hashtags} /></label><div className="mt-3 flex flex-wrap gap-2"><Button disabled={metadata.isPending || !output} onClick={() => metadata.mutate()}>메타데이터 저장</Button><Button className="bg-foreground" disabled={regenerate.isPending || !output || !canRegenerate} onClick={() => regenerate.mutate("scene")}>장면만 재생성</Button><Button className="bg-foreground" disabled={regenerate.isPending || !output || !canRegenerate} onClick={() => regenerate.mutate("full")}>전체 재생성</Button></div><h4 className="mt-4 text-sm font-semibold">출처</h4><ul className="mt-2 space-y-1 text-sm">{data.sources.map((source) => <li key={source.url}><a className="text-primary" href={source.url} rel="noreferrer" target="_blank">{source.sourceName}: {source.title}</a></li>)}</ul><h4 className="mt-4 text-sm font-semibold">에셋 권리</h4><ul className="mt-2 space-y-1 text-sm">{selectedAssets.map((asset) => <li key={`${asset.id}-${asset.purpose}`}>{asset.purpose}: {statusLabel(asset.licenseStatus)}</li>)}</ul></article><article className="rounded-md border border-border p-4"><h3 className="font-medium">{platformLabel(platform)} 정책 검사 결과</h3><p className="mt-2 text-sm">{activePolicy ? statusLabel(activePolicy.status) : "검사 전"}</p><ul className="mt-3 space-y-2 text-sm">{activePolicy?.findings.map((finding) => <li key={`${finding.code}-${policyHelp(finding.code, finding.message)}`} className="rounded bg-muted p-2">{statusLabel(finding.severity)}: {policyHelp(finding.code, finding.message)}</li>)}</ul><div className="mt-5 flex flex-wrap gap-2"><Button disabled={action.isPending || activePolicy?.status !== "pass" || !output?.videoReady} onClick={() => action.mutate("approve")}>승인</Button><Button className="bg-foreground" disabled={action.isPending || output?.publishStatus === "PUBLISHED"} onClick={() => action.mutate("hold")}>보류</Button><Button className="bg-foreground" disabled={action.isPending || output?.publishStatus === "PUBLISHED"} onClick={() => { if (window.confirm("선택 플랫폼 결과물을 폐기할까요?")) action.mutate("discard"); }}>폐기</Button></div><div className="mt-5 border-t border-border pt-4"><label className="block text-sm font-medium">예약 시각<input className="mt-1 h-10 w-full rounded border border-border px-3" min={localDateTimeValue(new Date(Date.now() + 60_000))} onChange={(event) => setScheduledAt(event.target.value)} type="datetime-local" value={scheduledAt} /></label><p className="mt-1 text-xs text-muted-foreground">현재 기기 시간대로 표시되며 저장할 때 UTC로 변환합니다.</p><Button className="mt-3" disabled={schedule.isPending || output?.reviewStatus !== "APPROVED" || !output?.videoReady || activePolicy?.status !== "pass"} onClick={() => schedule.mutate()}>게시 계획 만들기</Button></div></article></div> : <p className="mt-4 rounded border border-dashed border-border p-4 text-sm text-muted-foreground">위 목록에서 검토할 콘텐츠를 선택해 주세요.</p>}
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
                <Button disabled={generateMutation.isPending || channels.find((channel) => channel.id === channelId)?.status !== "ACTIVE" || !["CANDIDATE", "SHORTLISTED"].includes(idea.status)} onClick={() => generateMutation.mutate(idea.id)}>이 소재로 영상 만들기</Button>
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
  const [operations, setOperations] = useState<UpdateChannelRequest | null>(null);
  const [maxDailyPosts, setMaxDailyPosts] = useState(1);
  const [language, setLanguage] = useState("ko-KR");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [cta, setCta] = useState("");
  const [template, setTemplate] = useState<ChannelResponse["template"] | null>(null);

  useEffect(() => {
    if (channel) {
      setOperations(channelOperations(channel));
      setName(channel.name);
      setMaxDailyPosts(channel.dailyPublishLimit);
      setLanguage(channel.language); setAudience(channel.targetAudience); setTone(channel.template.tone);
      setCta(typeof channel.template.subtitleStyle.cta === "string" ? channel.template.subtitleStyle.cta : "");
      setTemplate(channel.template);
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
            template: { ...(template ?? channel.template), tone, subtitleStyle: { ...(template ?? channel.template).subtitleStyle, cta } },
            ...UpdateChannelRequestSchema.parse(operations ?? channelOperations(channel)),
            automation: {
              mode: operations?.automation?.mode ?? channel.automationMode,
              minInventoryCount: operations?.automation?.minInventoryCount ?? channel.minInventoryCount,
              dailyPublishLimit: Number(maxDailyPosts),
              errorAction: operations?.automation?.errorAction ?? channel.errorAction
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
        {[{ label: "생성 언어", value: language, set: setLanguage }, { label: "목표 시청자", value: audience, set: setAudience }, { label: "말투", value: tone, set: setTone }, { label: "CTA 방식", value: cta, set: setCta }].map((field) => <label className="block text-sm font-medium" key={field.label}>{field.label}<input className="mt-1 h-10 w-full rounded border border-border px-3" value={field.value} onChange={(event) => field.set(event.target.value)} /></label>)}
        <ChannelOperationsEditor value={operations ?? channelOperations(channel)} onChange={setOperations} />
        <PolicyProfileNotice request={request} profiles={operations?.outputProfiles ?? channel.outputProfiles} />
        <TemplateEditor template={template ?? channel.template} onChange={setTemplate} />
        <ChannelAudioEditor request={request} channelId={channel.id} template={template ?? channel.template} onChange={setTemplate} />
        <WizardAssetUpload channelId={channel.id} onLogo={(id) => setTemplate((previous) => ({ ...(previous ?? channel.template), visualStyle: { ...(previous ?? channel.template).visualStyle, logoAssetId: id } }))} />
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

const TemplateEditor = ({ template, onChange }: { template: ChannelResponse["template"]; onChange: (value: ChannelResponse["template"]) => void }): ReactElement => {
  const updateVisual = (field: string, value: string) => onChange({ ...template, visualStyle: { ...template.visualStyle, [field]: value } });
  const updateCaption = (field: string, value: string | number) => onChange({ ...template, subtitleStyle: { ...template.subtitleStyle, [field]: value } });
  const colors = [{ label: "브랜드 색상", value: typeof template.visualStyle.brandColor === "string" ? template.visualStyle.brandColor : "#0f766e", set: (value: string) => updateVisual("brandColor", value) }, { label: "배경 색상", value: typeof template.visualStyle.backgroundColor === "string" ? template.visualStyle.backgroundColor : "#f8fafc", set: (value: string) => updateVisual("backgroundColor", value) }, { label: "자막 색상", value: typeof template.subtitleStyle.color === "string" ? template.subtitleStyle.color : "#ffffff", set: (value: string) => updateCaption("color", value) }, { label: "자막 배경", value: typeof template.subtitleStyle.backgroundColor === "string" ? template.subtitleStyle.backgroundColor : "#0f172a", set: (value: string) => updateCaption("backgroundColor", value) }];
  return <fieldset className="grid gap-3 rounded border p-3"><legend>브랜드·음성·이미지 설정</legend><label>음성 프로필<input className="block w-full rounded border p-2" value={template.voiceProfile} onChange={(event) => onChange({ ...template, voiceProfile: event.target.value })} /></label><label>AI 이미지 비율 (0~1)<input type="number" min="0" max="1" step="0.1" className="block w-full rounded border p-2" value={template.aiStockRatio} onChange={(event) => onChange({ ...template, aiStockRatio: Number(event.target.value) })} /></label>{colors.map((field) => <label key={field.label}>{field.label}<input type="color" value={field.value} onChange={(event) => field.set(event.target.value)} /></label>)}<label>워터마크<input className="block w-full rounded border p-2" value={typeof template.visualStyle.watermark === "string" ? template.visualStyle.watermark : ""} onChange={(event) => updateVisual("watermark", event.target.value)} /></label><label>글꼴<select value={typeof template.visualStyle.fontFamily === "string" ? template.visualStyle.fontFamily : "Arial"} onChange={(event) => updateVisual("fontFamily", event.target.value)}><option value="Arial">Arial</option><option value="sans-serif">Sans serif</option><option value="serif">Serif</option></select></label><label>자막 글자 크기<input type="number" min="32" max="64" value={typeof template.subtitleStyle.fontSize === "number" ? template.subtitleStyle.fontSize : 52} onChange={(event) => updateCaption("fontSize", Number(event.target.value))} /></label>{template.visualStyle.logoAssetId ? <Button type="button" onClick={() => { const visualStyle = { ...template.visualStyle }; delete visualStyle.logoAssetId; onChange({ ...template, visualStyle }); }}>로고 제거</Button> : null}</fieldset>;
};

const WizardAssetUpload = ({ channelId, onLogo }: { channelId: string; onLogo: (id: string) => void }): ReactElement => {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("stock");
  const [proof, setProof] = useState("");
  const [license, setLicense] = useState("");
  const [stockDescription, setStockDescription] = useState("");
  const [rights, setRights] = useState(false);
  const stock = useQuery({ queryKey: ["stock-assets", channelId], queryFn: () => request(`/channels/${channelId}/stock-assets`, { method: "GET" }, z.object({ assets: z.array(z.object({ id: z.string() })) })) });
  const upload = useMutation({ mutationFn: async () => {
    if (!file || file.size > 1_048_576 || !rights) throw new Error("1MB 이하 PNG/JPEG 파일과 상업 사용·변형 허용 증빙이 필요합니다.");
    const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("파일을 읽지 못했습니다.")); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result.split(",")[1] ?? "") : reject(new Error("잘못된 이미지입니다.")); reader.readAsDataURL(file); });
    return request(`/channels/${channelId}/stock-assets`, { method: "POST", body: JSON.stringify({ bodyBase64: encoded, mimeType: file.type, licenseName: license, proofUrl: proof, commercialUseAllowed: rights, derivativeAllowed: rights, assetKind: kind, description: stockDescription }) }, z.object({ id: z.string() }));
  }, onSuccess: (asset) => { if (kind === "logo") onLogo(asset.id); void stock.refetch(); } });
  return <section className="mt-5 grid grid-cols-1 gap-3 rounded border p-4"><h3 className="font-semibold">스톡 이미지·브랜드 로고 등록</h3><p className="text-sm">권리 확인된 스톡 {stock.data?.assets.length ?? 0}개. 출처·증빙을 직접 확인한 파일만 등록하세요. 로고는 이 채널 영상에만 사용됩니다.</p><label>파일 종류<select aria-label="등록 에셋 종류" value={kind} onChange={(event) => setKind(event.target.value)}><option value="stock">스톡 이미지</option><option value="logo">브랜드 로고</option></select></label><label>{"\uc7a5\uba74 \ub9e4\uce6d\uc6a9 \uc774\ubbf8\uc9c0 \uc124\uba85"}<input aria-label="Stock image description" maxLength={2000} className="w-full rounded border p-2" value={stockDescription} onChange={(event) => setStockDescription(event.target.value)} /></label><label>PNG/JPEG (최대 1MB)<input type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><label>라이선스 이름<input aria-label="스톡 라이선스 이름" className="ml-2 rounded border p-2" value={license} onChange={(event) => setLicense(event.target.value)} /></label><label>권리 증빙 HTTPS URL<input aria-label="스톡 증빙 URL" type="url" className="ml-2 rounded border p-2" value={proof} onChange={(event) => setProof(event.target.value)} /></label><label><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />상업 사용과 변형이 모두 허용됨을 확인했습니다.</label><Button type="button" disabled={upload.isPending || !rights || !file || !license || !proof} onClick={() => upload.mutate()}>에셋 등록</Button>{upload.error ? <p role="alert">{upload.error.message}</p> : upload.isSuccess ? <p role="status">등록했습니다.</p> : null}</section>;
};

const WizardSampleOutput = ({ review, output }: { review: ContentReviewResponse; output: ContentReviewResponse["outputs"][number] }): ReactElement => {
  const cache = useQueryClient();
  const preview = useQuery({ queryKey: ["content-preview", review.id, output.platform], queryFn: () => request(`/content/${review.id}/review/preview?platform=${output.platform}`, { method: "GET" }, ReviewPreviewResponseSchema), enabled: output.videoReady });
  const approve = useMutation({ mutationFn: async () => {
    const checked = await request(`/content/${review.id}/review/policy-check`, { method: "POST", body: JSON.stringify({ platform: output.platform }) }, ContentReviewResponseSchema);
    if (checked.outputs.find((item) => item.platform === output.platform)?.policy?.status !== "pass") throw new Error("정책 검사가 통과하지 않았습니다. 출처·권리 증빙을 확인해 주세요.");
    return request(`/content/${review.id}/review/action`, { method: "POST", body: JSON.stringify({ action: "approve", platform: output.platform }) }, ContentReviewResponseSchema);
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["content-review", review.id] }); } });
  return <article className="grid gap-3 rounded border p-4"><h3>{platformLabel(output.platform)} 실제 샘플</h3>{preview.data ? <video controls className="max-h-96 w-full" src={preview.data.url} /> : <p>렌더 완료 후 실제 영상을 표시합니다.</p>}<p className="text-sm">{output.script?.hook} {output.script?.body} {output.script?.callToAction}</p><p>정책: {output.policy?.status ?? "검사 대기"} · 승인: {statusLabel(output.reviewStatus)}</p>{output.policy?.findings.map((finding) => <p key={`${finding.code}:${policyHelp(finding.code, finding.message)}`} className="text-sm">{policyHelp(finding.code, finding.message)}</p>)}<Button type="button" disabled={!output.videoReady || approve.isPending} onClick={() => approve.mutate()}>정책 검사 후 샘플 승인</Button>{approve.error ? <p role="alert">{approve.error.message}</p> : null}{preview.error ? <p role="alert">{preview.error.message}</p> : null}</article>;
};

const WizardSampleReview = ({ review }: { review: ContentReviewResponse }): ReactElement => {
  const cache = useQueryClient();
  const [assetId, setAssetId] = useState(""); const [proof, setProof] = useState(""); const [license, setLicense] = useState(""); const [rights, setRights] = useState(false);
  const activeScenes = new Set(review.outputs.map((output) => output.sceneVersionId));
  const pending = review.assets.filter((asset) => asset.licenseStatus !== "VERIFIED" && (!asset.sceneVersionId || activeScenes.has(asset.sceneVersionId)));
  const evidence = useMutation({ mutationFn: () => request(`/content/${review.id}/review/asset-license`, { method: "POST", body: JSON.stringify({ assetId, proofUrl: proof, licenseName: license, status: "VERIFIED", commercialUseAllowed: rights, derivativeAllowed: rights }) }, ContentReviewResponseSchema), onSuccess: () => { void cache.invalidateQueries({ queryKey: ["content-review", review.id] }); } });
  return <section className="grid gap-4"><h3 className="font-semibold">샘플 출처·권리·플랫폼 검토</h3>{review.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title} · {source.sourceName}</a>)}{pending.length ? <div className="grid gap-2 rounded border p-3"><p>확인되지 않은 권리는 자동 승인하지 않습니다.</p><select aria-label="샘플 권리 검토 에셋" value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">에셋 선택</option>{[...new Map(pending.map((asset) => [asset.id, asset])).values()].map((asset) => <option key={asset.id} value={asset.id}>{asset.purpose} · {asset.licenseStatus}</option>)}</select><input aria-label="샘플 권리 증빙 URL" placeholder="HTTPS 권리 증빙 URL" type="url" value={proof} onChange={(event) => setProof(event.target.value)} /><input aria-label="샘플 라이선스 이름" placeholder="라이선스 이름" value={license} onChange={(event) => setLicense(event.target.value)} /><label><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />상업 사용·변형 허용 증빙을 확인했습니다.</label><Button type="button" disabled={!rights || !assetId || !proof || license.length < 3 || evidence.isPending} onClick={() => evidence.mutate()}>샘플 권리 증빙 저장</Button>{evidence.error ? <p role="alert">{evidence.error.message}</p> : null}</div> : null}{review.outputs.filter((output) => output.platform).map((output) => <WizardSampleOutput key={output.platform} review={review} output={output} />)}</section>;
};

type WizardDraft = { channelId: string; values: WizardForm; step: number; runId: string | null; sampleSnapshot: string | null; advanced: UpdateChannelRequest | null };
const readWizardDraft = (): WizardDraft | null => {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem("postbot-wizard-draft") ?? "null");
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.channelId !== "string" || !record.values || typeof record.values !== "object") return null;
    const fields = record.values as Record<string, unknown>;
    for (const [key, fallback] of Object.entries(defaultWizardValues)) {
      if (Array.isArray(fallback)) { if (!Array.isArray(fields[key]) || !(fields[key] as unknown[]).every((entry) => typeof entry === "string")) return null; }
      else if (typeof fields[key] !== typeof fallback) return null;
    }
    const values = fields as WizardForm;
    if (!CreateChannelRequestSchema.safeParse(buildChannelInput(values)).success) return null;
    return { advanced: UpdateChannelRequestSchema.safeParse(record.advanced).success ? UpdateChannelRequestSchema.parse(record.advanced) : null, channelId: record.channelId, values, step: typeof record.step === "number" ? Math.max(0, Math.min(7, record.step)) : 1, runId: typeof record.runId === "string" ? record.runId : null, sampleSnapshot: typeof record.sampleSnapshot === "string" ? record.sampleSnapshot : null };
  } catch { return null; }
};

const ChannelWizard = ({
  onClose,
  onError
}: {
  onClose: () => void;
  onError: (error: string) => void;
}): ReactElement => {
  const queryClient = useQueryClient();
  const [restored] = useState(readWizardDraft);
  const [step, setStep] = useState(restored?.step ?? 0);
  const [draftId, setDraftId] = useState<string | null>(restored?.channelId ?? null);
  const [runId, setRunId] = useState<string | null>(restored?.runId ?? null);
  const [advanced, setAdvanced] = useState<UpdateChannelRequest | null>(restored?.advanced ?? null);
  const [sampleSnapshot, setSampleSnapshot] = useState<string | null>(restored?.sampleSnapshot ?? null);
  const [dailyBudget, setDailyBudget] = useState("5");
  const [monthlyBudget, setMonthlyBudget] = useState("20");
  const [sampleConfirmed, setSampleConfirmed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const form = useForm<WizardForm>({ defaultValues: restored?.values ?? defaultWizardValues });
  const values = form.watch();
  const config = (input: WizardForm): CreateChannelRequest => {
    const base = buildChannelInput(input);
    return { ...base, ...(advanced ?? {}), template: { ...base.template, visualStyle: { ...base.template.visualStyle, ...(advanced?.template?.visualStyle.audio ? { audio: advanced.template.visualStyle.audio } : {}) } }, platforms: input.platforms, outputProfiles: input.platforms.map((platform) => advanced?.outputProfiles?.find((profile) => profile.platform === platform) ?? base.outputProfiles.find((profile) => profile.platform === platform)!), scheduleRules: (advanced?.scheduleRules ?? base.scheduleRules).filter((rule) => rule.platform === null || input.platforms.includes(rule.platform)) };
  };
  const preview = config(values);
  useEffect(() => { if (draftId) sessionStorage.setItem("postbot-wizard-draft", JSON.stringify({ channelId: draftId, values, step, runId, sampleSnapshot, advanced })); }, [draftId, values, step, runId, sampleSnapshot, advanced]);
  const accounts = useQuery({ queryKey: ["platform-accounts"], queryFn: fetchPlatformAccounts, refetchInterval: 5000 });
  const connected = accounts.data?.filter((account) => account.channelId === draftId && account.status === "CONNECTED") ?? [];
  const ensureDraft = async (): Promise<string> => {
    if (draftId) return draftId;
    const channel = await request("/channels", { method: "POST", body: JSON.stringify(CreateChannelRequestSchema.parse({ ...config(form.getValues()), startPaused: true })) }, ChannelResponseSchema);
    setDraftId(channel.id);
    void queryClient.invalidateQueries({ queryKey: ["channels"] });
    return channel.id;
  };
  const connect = useMutation({ mutationFn: async (platform: Platform) => {
    const channelId = await ensureDraft();
    sessionStorage.setItem("postbot-wizard-draft", JSON.stringify({ channelId, values: form.getValues(), step: 1, runId, sampleSnapshot, advanced }));
    const started = await request(`/platform-accounts/${platform.toLowerCase()}/connect`, { method: "POST", body: JSON.stringify({ channelId }) }, StartOAuthConnectionResponseSchema);
    if (started.provider === "fake") await requestAbsolute(started.authorizationUrl, { method: "GET" }, OAuthCallbackResultSchema);
    else { sessionStorage.setItem("postbot-oauth-channel", channelId); window.location.assign(started.authorizationUrl); }
  }, onSuccess: () => { void accounts.refetch(); void queryClient.invalidateQueries({ queryKey: ["channels"] }); } });
  const sample = useMutation({ mutationFn: async () => {
    const channelId = await ensureDraft();
    const input = CreateChannelRequestSchema.parse(config(form.getValues()));
    await request(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(input) }, ChannelResponseSchema);
    await request("/automation/budgets", { method: "POST", body: JSON.stringify({ channelId, dailyHardLimit: Number(dailyBudget), monthlyHardLimit: Number(monthlyBudget) }) }, AutomationBudgetResponseSchema);
    return request("/automation/runs", { method: "POST", body: JSON.stringify({ channelId, platforms: input.platforms, sample: true, idempotencyKey: `wizard-sample:${crypto.randomUUID()}` }) }, AutomationRunResponseSchema);
  }, onSuccess: (run) => { setRunId(run.id); setSampleConfirmed(false); setSampleSnapshot(JSON.stringify(config(form.getValues()))); } });
  const sampleRun = useQuery({ queryKey: ["wizard-sample-run", runId], queryFn: () => request(`/automation/runs/${runId}`, { method: "GET" }, AutomationRunResponseSchema), enabled: Boolean(runId), refetchInterval: 3000 });
  const sampleContent = sampleRun.data?.steps.find((item) => item.stage === "SCRIPT" && typeof item.output?.contentItemId === "string")?.output?.contentItemId;
  const sampleReview = useQuery({ queryKey: ["content-review", sampleContent], queryFn: () => fetchReview(typeof sampleContent === "string" ? sampleContent : ""), enabled: typeof sampleContent === "string", refetchInterval: 3000 });
  const sampleApproved = sampleConfirmed && values.platforms.every((platform) => sampleReview.data?.outputs.some((output) => output.platform === platform && output.videoReady && output.policy?.status === "pass" && output.reviewStatus === "APPROVED")) && sampleSnapshot === JSON.stringify(preview);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!runId || !sampleApproved || connected.length === 0) throw new Error("계정 연결과 실제 샘플 미리보기·정책 승인을 먼저 완료해 주세요.");
      return request(`/automation/runs/${runId}/complete-setup`, { method: "POST", body: "{}" }, { parse: () => ({ ok: true }) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      sessionStorage.removeItem("postbot-wizard-draft");
      onClose();
    },
    onError: (error) => onError(error instanceof Error ? error.message : "채널을 만들지 못했습니다.")
  });

  const submit = form.handleSubmit(() => {
    mutation.mutate();
  });
  const lastStep = wizardSteps.length - 1;
  const nextStep = () => {
    if (step === 1 && !connected.some((account) => values.platforms.includes(account.platform))) { form.setError("platforms", { message: "선택한 SNS 계정을 최소 1개 연결해 주세요." }); return; }
    const result = CreateChannelRequestSchema.safeParse(config(form.getValues()));
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
                onClick={() => { if (index <= step) setStep(index); }}
                type="button"
              />
            ))}
          </div>
        </header>
        <section className="flex-1 px-5 py-6">
          <WizardStep step={step} form={form} preview={preview} />
          {step === 1 ? <div className="mt-4 grid gap-2">{values.platforms.map((platform) => <div key={platform} className="flex items-center justify-between rounded border p-3"><span>{platformLabel(platform)} · {connected.some((account) => account.platform === platform) ? "연결됨" : "미연결"}</span><Button type="button" disabled={connect.isPending} onClick={() => connect.mutate(platform)}>계정 연결</Button></div>)}<p className="text-sm text-muted-foreground">초안 채널은 샘플 승인 전까지 일시 중지됩니다. 닫았다가 다시 열어도 설정을 이어갈 수 있습니다.</p>{connect.error ? <p role="alert">{connect.error.message}</p> : null}</div> : null}
          {step === 3 && draftId ? <><WizardAssetUpload channelId={draftId} onLogo={(id) => form.setValue("logoAssetId", id)} /><ChannelAudioEditor request={request} channelId={draftId} template={preview.template} onChange={(template) => setAdvanced({ ...(advanced ?? {}), template })} /></> : null}
          {step === 7 ? <details className="mt-4 rounded border p-3"><summary>플랫폼별 출력·수집 출처·세부 운영 설정</summary><ChannelOperationsEditor value={{ description: preview.description, topic: preview.topic, excludedTopics: preview.excludedTopics, collectionRule: preview.collectionRule, outputProfiles: preview.outputProfiles, scheduleRules: preview.scheduleRules, automation: preview.automation, ...(advanced?.template ? { template: advanced.template } : {}) }} onChange={setAdvanced} /></details> : null}
          {step === 4 || step === 7 ? <PolicyProfileNotice request={request} profiles={preview.outputProfiles} /> : null}
          {step === 7 ? <div className="mt-5 grid gap-4"><label>일간 중단 예산 (USD)<input aria-label="샘플 일간 예산" type="number" min="0" step="0.01" className="ml-2 rounded border p-2" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} /></label><label>월간 중단 예산 (USD)<input aria-label="샘플 월간 예산" type="number" min="0" step="0.01" className="ml-2 rounded border p-2" value={monthlyBudget} onChange={(event) => setMonthlyBudget(event.target.value)} /></label><Button type="button" disabled={sample.isPending || connected.length === 0 || (Boolean(runId) && ["QUEUED", "RUNNING"].includes(sampleRun.data?.status ?? ""))} onClick={() => sample.mutate()}>실제 샘플 제작</Button><p className="text-sm">샘플은 렌더·정책 검사까지 실행하며 SNS에 게시하거나 예약하지 않습니다. 실제 Provider는 예산 내 비용이 발생할 수 있습니다.</p>{sample.error ? <p role="alert">{sample.error.message}</p> : null}{sampleRun.data ? <p role="status">샘플: {statusLabel(sampleRun.data.status)} · {sampleRun.data.steps.filter((item) => item.stage !== "PUBLISH").map((item) => `${platformLabel(item.platform)} ${stageLabel(item.stage)} ${statusLabel(item.status)}`).join(" / ")}</p> : null}{sampleRun.data?.steps.filter((item) => item.errorCode && item.errorCode !== "SAMPLE_REVIEW_REQUIRED").map((item) => <p role="alert" key={`${item.platform}:${item.stage}`}>{platformLabel(item.platform)}: {item.errorCode === "STOCK_ASSET_REQUIRED" ? "템플릿 단계에서 권리 확인된 스톡 이미지를 등록해 주세요." : item.errorMessage ?? item.errorCode}</p>)}{sampleReview.data ? <WizardSampleReview review={sampleReview.data} /> : null}{runId && sampleSnapshot !== JSON.stringify(preview) ? <p role="alert">제작 후 설정이 변경되었습니다. 새 설정으로 샘플을 다시 제작해 주세요.</p> : null}</div> : null}
          {step === 7 ? <label className="mt-4 flex gap-2"><input type="checkbox" checked={sampleConfirmed} onChange={(event) => setSampleConfirmed(event.target.checked)} />모든 플랫폼의 실제 샘플 영상과 출처를 확인했습니다.</label> : null}
          {Object.entries(form.formState.errors).map(([field, issue]) => <p role="alert" className="mt-2 text-sm text-red-700" key={field}>{field}: {issue.message}</p>)}
        </section>
        <footer className="flex items-center justify-between border-t border-border px-5 py-4">
          <Button className="gap-2 bg-foreground" disabled={step === 0} onClick={() => setStep((current) => current - 1)} type="button">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            이전
          </Button>
          {step === lastStep ? (
            <Button className="gap-2" data-testid="wizard-create" disabled={mutation.isPending || !sampleApproved || connected.length === 0} key="create" type="submit">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              설정 완료
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
        <Field label="음성 프로필" helper="neutral-ko는 운영 환경의 기본 음성 ID를 사용합니다." registration={register("voiceProfile", { required: true })} />
        <Field label="AI 이미지 비율" helper="0은 스톡만, 1은 AI만 사용합니다. 혼합 비율은 장면 수에 맞춰 반올림합니다." type="number" registration={register("aiStockRatio", { valueAsNumber: true, min: 0, max: 1 })} />
        <Field label="브랜드 색상" type="color" registration={register("brandColor")} />
        <Field label="배경 색상" type="color" registration={register("backgroundColor")} />
        <Field label="워터마크" helper="비워 두면 채널 이름" registration={register("watermark")} />
        <label className="text-sm">글꼴<select aria-label="브랜드 글꼴" className="mt-2 w-full rounded border p-3" {...register("fontFamily")}><option value="Arial">Arial</option><option value="sans-serif">Sans serif</option><option value="serif">Serif</option></select></label>
        <Field label="자막 색상" type="color" registration={register("captionColor")} />
        <Field label="자막 배경" type="color" registration={register("captionBackground")} />
        <Field label="자막 글자 크기" type="number" registration={register("captionFontSize", { valueAsNumber: true, min: 32, max: 64 })} />
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="최소 길이 초" type="number" registration={register("durationMinSeconds", { valueAsNumber: true })} />
        <Field label="최대 길이 초" type="number" registration={register("durationMaxSeconds", { valueAsNumber: true })} />
        <p className="rounded bg-muted p-3 text-sm md:col-span-2">지원 출력: 9:16 · 1080×1920. 템플릿에서 설정한 브랜드·자막 스타일이 실제 영상에 반영됩니다.</p>
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
        <p className="text-sm">정책 검사와 권리 확인은 항상 필수입니다. 정책 실패 시 보류하며 자동 유료 재생성은 지원하지 않습니다. 채널 중지는 신규 제작을 멈추며 기존 예약은 캘린더에서 취소해야 합니다.</p>
        <label className="block text-sm">연속 실패 처리<select className="mt-1 block w-full rounded border border-border p-2" {...register("onConsecutiveFailures")}><option value="pause_channel">해당 채널 일시 중지</option><option value="notify_only">알림만 보내기</option></select></label>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle aria-hidden="true" className="mb-2 h-5 w-5" />
        실제 샘플 제작 후 각 플랫폼의 영상·출처·정책 결과를 확인하고 승인해야 설정을 완료할 수 있습니다. 샘플은 게시하지 않습니다.
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">채널</h3><p className="mt-2 text-sm">{preview.name}</p><p className="text-sm text-muted-foreground">{preview.topic} · {preview.targetAudience}</p></article>
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">플랫폼</h3><p className="mt-2 text-sm">{preview.platforms.map(platformLabel).join(", ") || "선택 필요"}</p><p className="text-sm text-muted-foreground">SNS 단계에서 연결한 계정은 그대로 유지됩니다.</p></article>
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">제작 설정</h3><p className="mt-2 text-sm">{preview.template.name} · {preview.outputProfiles[0]?.minDurationSeconds ?? "-"}~{preview.outputProfiles[0]?.maxDurationSeconds ?? "-"}초</p><p className="text-sm text-muted-foreground">{preview.template.tone} · 읽기 쉬운 자막</p></article>
        <article className="rounded-md border border-border p-4"><h3 className="font-semibold">운영</h3><p className="mt-2 text-sm">{preview.automation.mode === "FULL_AUTO" ? "완전 자동형" : "승인형"} · 최소 재고 {preview.automation.minInventoryCount}개</p><p className="text-sm text-muted-foreground">{preview.scheduleRules.length}개 반복 슬롯 · {preview.scheduleRules[0]?.timezone ?? "시간대 미설정"}</p></article>
      </div>
      <p className="text-sm text-muted-foreground">예산을 설정한 뒤 샘플 제작을 시작해 주세요. 설정을 변경하면 새 설정으로 샘플을 다시 제작해야 합니다.</p>
    </div>
  );
};

const App = (): ReactElement => {
  const [, setSessionRevision] = useState(0);
  useEffect(() => { const expired = () => setSessionRevision((revision) => revision + 1); window.addEventListener("postbot-session-expired", expired); return () => window.removeEventListener("postbot-session-expired", expired); }, []);
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
