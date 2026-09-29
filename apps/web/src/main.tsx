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
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import {
  AuthResponseSchema,
  AnalyticsReportResponseSchema,
  AutomationRunResponseSchema,
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
  ProductionJobResponseSchema,
  PublishPlanResponseSchema,
  ReviewPreviewResponseSchema,
  CostReportResponseSchema,
  NotificationResponseSchema,
  PlatformAccountListResponseSchema,
  StartOAuthConnectionResponseSchema,
  type AuthResponse,
  type AnalyticsReportResponse,
  type AutomationRunResponse,
  type AuthSession,
  type ChannelResponse,
  type ContentIdea,
  type ContentItemSummary,
  type ContentReviewResponse,
  type CreateChannelRequest,
  type IdeaStatus,
  type PlatformAccountResponse,
  type Platform
  , type OptimizationSuggestionResponse, type CostReportResponse, type NotificationResponse
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
const fetchAnalyticsReport = (channelId: string): Promise<AnalyticsReportResponse> => {
  const end = new Date(); const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return request(`/analytics/report?channelId=${encodeURIComponent(channelId)}&periodStart=${encodeURIComponent(start.toISOString())}&periodEnd=${encodeURIComponent(end.toISOString())}`, { method: "GET" }, AnalyticsReportResponseSchema);
};
const fetchSuggestions = (channelId: string): Promise<OptimizationSuggestionResponse[]> =>
  request(`/optimization/suggestions?channelId=${encodeURIComponent(channelId)}`, { method: "GET" }, { parse: (value: unknown) => OptimizationSuggestionResponseSchema.array().parse(value) });
const fetchCosts = (): Promise<CostReportResponse> => { const end = new Date(); const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); return request(`/operations/costs?periodStart=${encodeURIComponent(start.toISOString())}&periodEnd=${encodeURIComponent(end.toISOString())}`, { method: "GET" }, CostReportResponseSchema); };
const fetchNotifications = (): Promise<NotificationResponse[]> => request("/operations/notifications", { method: "GET" }, { parse: (value: unknown) => NotificationResponseSchema.array().parse(value) });

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

const buildChannelInput = (values: WizardForm): CreateChannelRequest =>
  CreateChannelRequestSchema.parse({
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
  const content = useQuery({ queryKey: ["content"], queryFn: fetchContent, enabled: Boolean(session) });
  const automationRuns = useQuery({ queryKey: ["automation-runs"], queryFn: fetchAutomationRuns, enabled: Boolean(session), refetchInterval: 30_000 });
  const analytics = useQuery({ queryKey: ["analytics", channels.data?.[0]?.id], queryFn: () => fetchAnalyticsReport(channels.data?.[0]?.id ?? ""), enabled: Boolean(channels.data?.[0]?.id) });
  const suggestions = useQuery({ queryKey: ["optimization-suggestions", channels.data?.[0]?.id], queryFn: () => fetchSuggestions(channels.data?.[0]?.id ?? ""), enabled: Boolean(channels.data?.[0]?.id) });
  const costs = useQuery({ queryKey: ["operations-costs"], queryFn: fetchCosts, enabled: Boolean(session) });
  const notifications = useQuery({ queryKey: ["operations-notifications"], queryFn: fetchNotifications, enabled: Boolean(session), refetchInterval: 30_000 });

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

        <OperationsOverview channels={channels.data ?? []} content={content.data ?? []} />
        <AutomationPanel runs={automationRuns.data ?? []} isLoading={automationRuns.isLoading} />
        <AnalyticsPanel report={analytics.data} isLoading={analytics.isLoading} />
        <OptimizationPanel suggestions={suggestions.data ?? []} isLoading={suggestions.isLoading} />
        <OperationsPanel costs={costs.data} notifications={notifications.data ?? []} isLoading={costs.isLoading || notifications.isLoading} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ChannelList
            accounts={platformAccounts.data ?? []}
            channels={channels.data ?? []}
            isLoading={channels.isLoading}
            onEdit={setEditing}
            onError={setError}
          />
          <EditPanel channel={editing} onClose={() => setEditing(null)} onError={setError} />
        </div>
        <IdeasPanel channels={channels.data ?? []} onError={setError} />
        <ContentPanel content={content.data ?? []} isLoading={content.isLoading} onError={setError} />
        <CalendarPanel channels={channels.data ?? []} />
        <ReviewPanel accounts={platformAccounts.data ?? []} onError={setError} />
      </section>
      {wizardOpen ? <ChannelWizard onClose={() => setWizardOpen(false)} onError={setError} /> : null}
    </main>
  );
};

const AutomationPanel = ({ runs, isLoading }: { runs: AutomationRunResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const control = useMutation({
    mutationFn: ({ runId, action }: { runId: string; action: "pause" | "resume" }) => request(`/automation/runs/${runId}/control`, { method: "POST", body: JSON.stringify({ action }) }, AutomationRunResponseSchema),
    onSuccess: () => void cache.invalidateQueries({ queryKey: ["automation-runs"] })
  });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="automation-panel">
    <div><h2 className="text-lg font-semibold">Automation operations</h2><p className="mt-1 text-sm text-muted-foreground">Run state, heartbeat, failed stages, and operator holds.</p></div>
    {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading automation runs.</p> : runs.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No automation runs yet.</p> : <div className="mt-4 grid gap-2">{runs.slice(0, 10).map((run) => <article className="rounded-md border border-border p-3 text-sm" key={run.id}><div className="flex items-center justify-between gap-3"><span className="font-medium">{run.status}</span><span className="text-xs text-muted-foreground">{run.heartbeatAt ?? "No heartbeat"}</span></div><p className="mt-2 text-xs text-muted-foreground">{run.lastErrorCode ?? "No error"}</p><div className="mt-2 flex flex-wrap gap-1">{run.steps.map((step) => <span className="rounded bg-muted px-2 py-1 text-xs" key={step.stage}>{step.stage}: {step.status}</span>)}</div>{["RUNNING", "QUEUED"].includes(run.status) ? <Button className="mt-3 h-8" disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "pause" })}>Pause</Button> : run.status === "PAUSED" ? <Button className="mt-3 h-8" disabled={control.isPending} onClick={() => control.mutate({ runId: run.id, action: "resume" })}>Resume</Button> : null}</article>)}</div>}
  </section>;
};

const AnalyticsPanel = ({ report, isLoading }: { report: AnalyticsReportResponse | undefined; isLoading: boolean }): ReactElement => <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="analytics-panel">
  <div><h2 className="text-lg font-semibold">Performance analytics</h2><p className="mt-1 text-sm text-muted-foreground">Recent seven-day normalized metrics with platform availability.</p></div>
  {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading analytics.</p> : !report || report.metrics.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No synced metrics for this period.</p> : <><div className="mt-4 grid gap-2 md:grid-cols-2">{report.metrics.map((metric) => <article className="rounded-md border border-border p-3 text-sm" key={`${metric.metric}-${metric.observedAt}`}><p className="font-medium">{metric.metric}</p><p className="mt-1 text-lg">{metric.status === "AVAILABLE" ? `${metric.value ?? 0} ${metric.unit ?? ""}` : "Unavailable"}</p><p className="mt-1 text-xs text-muted-foreground">{metric.unavailableReason ?? `${metric.aggregation ?? "raw"} · ${metric.observedAt}`}</p></article>)}</div><p className="mt-3 text-xs text-muted-foreground">{report.partial ? "Partial data or unavailable metrics are included." : "All returned metrics are available."} Last synced: {report.lastSyncedAt ?? "never"}</p></>}
</section>;

const OptimizationPanel = ({ suggestions, isLoading }: { suggestions: OptimizationSuggestionResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const action = useMutation({ mutationFn: ({ id, next }: { id: string; next: "approve" | "reject" | "apply" }) => request(`/optimization/suggestions/${id}/action`, { method: "POST", body: JSON.stringify({ action: next }) }, OptimizationSuggestionResponseSchema), onSuccess: () => void cache.invalidateQueries({ queryKey: ["optimization-suggestions"] }) });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="optimization-panel"><div><h2 className="text-lg font-semibold">Optimization suggestions</h2><p className="mt-1 text-sm text-muted-foreground">Correlation-based hypotheses, evidence, approval history, and rollback-safe strategy changes.</p></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading suggestions.</p> : suggestions.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No suggestions yet. Sync analytics and generate a comparison cohort first.</p> : <div className="mt-4 grid gap-2">{suggestions.map((suggestion) => <article className="rounded-md border border-border p-3 text-sm" key={suggestion.id}><div className="flex items-center justify-between gap-2"><p className="font-medium">{suggestion.title}</p><span className="rounded bg-muted px-2 py-1 text-xs">{suggestion.status}</span></div><p className="mt-2 text-muted-foreground">{suggestion.rationale}</p><p className="mt-2 text-xs text-muted-foreground">sample: {suggestion.sampleSize} · confidence: {suggestion.confidenceScore ?? "not established"} · expiry: {suggestion.expiresAt ?? "none"}</p>{suggestion.status === "PENDING" ? <div className="mt-3 flex gap-2"><Button className="h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "approve" })}>Approve</Button><Button className="h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "reject" })}>Reject</Button></div> : suggestion.status === "APPROVED" ? <Button className="mt-3 h-8" disabled={action.isPending} onClick={() => action.mutate({ id: suggestion.id, next: "apply" })}>Apply immutable strategy</Button> : null}</article>)}</div>}</section>;
};

const OperationsPanel = ({ costs, notifications, isLoading }: { costs: CostReportResponse | undefined; notifications: NotificationResponse[]; isLoading: boolean }): ReactElement => {
  const cache = useQueryClient();
  const acknowledge = useMutation({ mutationFn: (id: string) => request(`/operations/notifications/${id}/acknowledge`, { method: "POST" }, NotificationResponseSchema), onSuccess: () => void cache.invalidateQueries({ queryKey: ["operations-notifications"] }) });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="operations-panel"><div><h2 className="text-lg font-semibold">Operations cost and alerts</h2><p className="mt-1 text-sm text-muted-foreground">Ledger-reconciled cost totals and in-app operational alerts.</p></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading operations data.</p> : <><div className="mt-4 grid gap-2 md:grid-cols-4"><article className="rounded border border-border p-3 text-sm"><p>Estimated</p><p className="mt-1 text-lg">{costs?.estimated ?? 0} {costs?.currency ?? "USD"}</p></article><article className="rounded border border-border p-3 text-sm"><p>Actual</p><p className="mt-1 text-lg">{costs?.actual ?? 0} {costs?.currency ?? "USD"}</p></article><article className="rounded border border-border p-3 text-sm"><p>Credit</p><p className="mt-1 text-lg">{costs?.credit ?? 0}</p></article><article className="rounded border border-border p-3 text-sm"><p>Reconciliation</p><p className="mt-1 text-lg">{costs?.reconciled ? "Matched" : `Difference ${costs?.discrepancy ?? 0}`}</p></article></div><div className="mt-4 grid gap-2">{notifications.length === 0 ? <p className="text-sm text-muted-foreground">No operational alerts.</p> : notifications.slice(0, 10).map((notification) => <article className="flex items-center justify-between gap-3 rounded border border-border p-3 text-sm" key={notification.id}><span>{notification.severity} · {notification.eventKey}</span>{notification.acknowledgedAt ? <span className="text-xs text-muted-foreground">Acknowledged</span> : <Button className="h-8" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(notification.id)}>Acknowledge</Button>}</article>)}</div></>}</section>;
};

const OperationsOverview = ({ channels, content }: { channels: ChannelResponse[]; content: ContentItemSummary[] }): ReactElement => {
  const active = channels.filter((channel) => channel.status === "ACTIVE").length;
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Operations overview">
    {[{ label: "Active channels", value: active }, { label: "Needs review", value: content.filter((item) => item.status === "REVIEW_REQUIRED").length }, { label: "Ready to schedule", value: content.filter((item) => item.status === "APPROVED").length }, { label: "Weekly slots", value: channels.flatMap((channel) => channel.scheduleRules).reduce((total, rule) => total + rule.maxPosts, 0) }].map((metric) => <article className="rounded-md border border-border bg-white p-4 shadow-sm" key={metric.label}><p className="text-sm text-muted-foreground">{metric.label}</p><p className="mt-2 text-2xl font-semibold">{metric.value}</p></article>)}
  </section>;
};

const ContentPanel = ({ content, isLoading, onError }: { content: ContentItemSummary[]; isLoading: boolean; onError: (error: string) => void }): ReactElement => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const retry = useQueryClient();
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Content operations</h2><p className="mt-1 text-sm text-muted-foreground">Generated content, render readiness, and review state.</p></div><Button className="bg-foreground" onClick={() => { onError(""); void retry.invalidateQueries({ queryKey: ["content"] }); }}>Retry</Button></div>{isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading content.</p> : content.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No generated content yet. Select an idea and start generation.</p> : <div className="mt-4 grid gap-2">{content.map((item) => <button className={`flex items-center justify-between rounded-md border p-3 text-left text-sm ${selectedId === item.id ? "border-primary" : "border-border"}`} key={item.id} onClick={() => setSelectedId(item.id)} type="button"><span><span className="font-medium">{item.title}</span><span className="ml-2 text-muted-foreground">{item.status}</span></span><span className="text-xs text-muted-foreground">{item.renderReady ? "render ready" : "render pending"}</span></button>)}</div>}</section>;
};

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const CalendarPanel = ({ channels }: { channels: ChannelResponse[] }): ReactElement => <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="calendar-panel">
  <div><h2 className="text-lg font-semibold">Publishing calendar</h2><p className="mt-1 text-sm text-muted-foreground">Configured slots only. Publishing is enabled in stage 13.</p></div>
  {channels.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Create a channel to see its publishing schedule.</p> : <div className="mt-4 grid gap-3 md:grid-cols-7">{weekdayLabels.map((day, index) => <article className="min-h-32 rounded-md border border-border p-3" key={day}><h3 className="text-sm font-semibold">{day}</h3><div className="mt-3 space-y-2">{channels.flatMap((channel) => channel.scheduleRules.filter((rule) => rule.dayOfWeek === index).map((rule) => ({ channel, rule }))).map(({ channel, rule }) => <div className="rounded bg-muted p-2 text-xs" key={`${channel.id}-${rule.platform}-${rule.timeOfDayLocal}`}><p className="font-medium">{rule.timeOfDayLocal}</p><p className="mt-1">{channel.name}</p><p className="text-muted-foreground">{rule.platform} · max {rule.maxPosts}</p></div>)}</div></article>)}</div>}
</section>;

const ReviewPanel = ({ accounts, onError }: { accounts: PlatformAccountResponse[]; onError: (error: string) => void }): ReactElement => {
  const queryClient = useQueryClient();
  const [contentItemId, setContentItemId] = useState("");
  const [platform, setPlatform] = useState<Platform>("YOUTUBE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 16));
  const review = useQuery({ queryKey: ["content-review", contentItemId], queryFn: () => fetchReview(contentItemId), enabled: contentItemId.length > 0, retry: false });
  const preview = useQuery({ queryKey: ["content-preview", contentItemId, platform], queryFn: () => request(`/content/${contentItemId}/review/preview?platform=${platform}`, { method: "GET" }, ReviewPreviewResponseSchema), enabled: Boolean(contentItemId && review.data?.outputs.some((output) => output.platform === platform && output.videoReady)), retry: false });
  const policyCheck = useMutation({
    mutationFn: (platform: Platform) => request(`/content/${contentItemId}/review/policy-check`, { method: "POST", body: JSON.stringify({ platform }) }, ContentReviewResponseSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "Policy check failed.")
  });
  const action = useMutation({
    mutationFn: (nextAction: "approve" | "hold" | "discard") => request(`/content/${contentItemId}/review/action`, { method: "POST", body: JSON.stringify({ action: nextAction }) }, ContentReviewResponseSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "Review action failed.")
  });
  const data = review.data;
  const output = data?.outputs.find((candidate) => candidate.platform === platform) ?? data?.outputs[0];
  useEffect(() => {
    if (!data) return;
    setTitle(data.title);
    setDescription(output?.metadata.description ?? data.description);
    setHashtags(output?.metadata.hashtags.join(" ") ?? "");
  }, [data, output?.scriptVersionId]);
  const metadata = useMutation({
    mutationFn: () => request(`/content/${contentItemId}/review/metadata`, { method: "PATCH", body: JSON.stringify({ platform, title, description, hashtags: hashtags.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean) }) }, ContentReviewResponseSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "Metadata update failed.")
  });
  const regenerate = useMutation({
    mutationFn: (partial: "full" | "hook" | "body" | "metadata" | "scene") => {
      if (!data?.ideaId) throw new Error("The originating idea is not available for regeneration.");
      return request("/generation/script-scene", { method: "POST", body: JSON.stringify({ ideaId: data.ideaId, platform, partial, idempotencyKey: `review:${contentItemId}:${platform}:${partial}:${Date.now()}` }) }, ProductionJobResponseSchema);
    },
    onSuccess: () => onError("Regeneration job queued. Refresh the review after it completes."),
    onError: (error) => onError(error instanceof Error ? error.message : "Regeneration failed.")
  });
  const schedule = useMutation({
    mutationFn: () => {
      const account = accounts.find((candidate) => candidate.channelId === data?.channelId && candidate.platform === platform && candidate.status === "CONNECTED");
      if (!account) throw new Error(`Connect a ${platform} account before scheduling.`);
      return request("/publishing/plans", { method: "POST", body: JSON.stringify({ contentItemId, platformAccountId: account.id, scheduledAt: new Date(scheduledAt).toISOString(), idempotencyKey: `review:${contentItemId}:${platform}:${new Date(scheduledAt).toISOString()}` }) }, PublishPlanResponseSchema);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["content-review", contentItemId] }); void queryClient.invalidateQueries({ queryKey: ["content"] }); },
    onError: (error) => onError(error instanceof Error ? error.message : "Scheduling failed.")
  });
  return <section className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid="review-panel">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Content review</h2><p className="mt-1 text-sm text-muted-foreground">Review each platform output, render, sources, rights, metadata, and policy gate.</p></div><div className="flex gap-2"><input aria-label="Content item ID" className="h-10 rounded-md border border-border px-3 text-sm" onChange={(event) => setContentItemId(event.target.value.trim())} placeholder="Content item ID" value={contentItemId} /><Button disabled={!contentItemId || policyCheck.isPending} onClick={() => policyCheck.mutate(platform)}>Run policy check</Button></div></div>
    <div className="mt-4 flex gap-2" role="tablist">{(["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const).map((candidate) => <Button className={platform === candidate ? "" : "bg-foreground"} key={candidate} onClick={() => setPlatform(candidate)} type="button">{candidate}</Button>)}</div>
    {review.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading review.</p> : null}
    {data ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><article className="rounded-md border border-border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">{platform} output</h3><span className="rounded bg-muted px-2 py-1 text-xs">{data.status}</span></div><p className="mt-2 text-xs text-muted-foreground">Script: {output?.scriptStatus ?? "missing"} · Scene: {output?.sceneVersionId ? "ready" : "missing"} · Render: {output?.renderStatus ?? "pending"}</p>{preview.data ? <video className="mt-3 aspect-[9/16] max-h-[480px] w-full rounded bg-black" controls src={preview.data.url} /> : <p className="mt-3 rounded bg-muted p-4 text-sm">Rendered video preview is not available for this platform output.</p>}<label className="mt-4 block text-sm font-medium">Title<input className="mt-1 h-10 w-full rounded border border-border px-3" onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="mt-3 block text-sm font-medium">Description<textarea className="mt-1 min-h-24 w-full rounded border border-border p-3" onChange={(event) => setDescription(event.target.value)} value={description} /></label><label className="mt-3 block text-sm font-medium">Hashtags<input className="mt-1 h-10 w-full rounded border border-border px-3" onChange={(event) => setHashtags(event.target.value)} value={hashtags} /></label><div className="mt-3 flex flex-wrap gap-2"><Button disabled={metadata.isPending || !output} onClick={() => metadata.mutate()}>Save metadata</Button><Button className="bg-foreground" disabled={regenerate.isPending} onClick={() => regenerate.mutate("scene")}>Partial regenerate</Button><Button className="bg-foreground" disabled={regenerate.isPending} onClick={() => regenerate.mutate("full")}>Full regenerate</Button></div><h4 className="mt-4 text-sm font-semibold">Sources</h4><ul className="mt-2 space-y-1 text-sm">{data.sources.map((source) => <li key={source.url}><a className="text-primary" href={source.url} rel="noreferrer" target="_blank">{source.sourceName}: {source.title}</a></li>)}</ul><h4 className="mt-4 text-sm font-semibold">Asset rights</h4><ul className="mt-2 space-y-1 text-sm">{data.assets.map((asset) => <li key={`${asset.id}-${asset.purpose}`}>{asset.purpose}: {asset.licenseStatus}</li>)}</ul></article><article className="rounded-md border border-border p-4"><h3 className="font-medium">Policy findings</h3><p className="mt-2 text-sm">{data.policy ? data.policy.status : "Not checked"}</p><ul className="mt-3 space-y-2 text-sm">{data.policy?.findings.map((finding) => <li key={`${finding.code}-${finding.message}`} className="rounded bg-muted p-2">{finding.severity}: {finding.message}</li>)}</ul><div className="mt-5 flex flex-wrap gap-2"><Button disabled={action.isPending} onClick={() => action.mutate("approve")}>Approve</Button><Button className="bg-foreground" disabled={action.isPending} onClick={() => action.mutate("hold")}>Hold</Button><Button className="bg-foreground" disabled={action.isPending} onClick={() => action.mutate("discard")}>Discard</Button></div><div className="mt-5 border-t border-border pt-4"><label className="block text-sm font-medium">Schedule time<input className="mt-1 h-10 w-full rounded border border-border px-3" min={new Date().toISOString().slice(0, 16)} onChange={(event) => setScheduledAt(event.target.value)} type="datetime-local" value={scheduledAt} /></label><Button className="mt-3" disabled={schedule.isPending || data.status !== "APPROVED" || !output?.videoReady} onClick={() => schedule.mutate()}>Create publish plan</Button></div></article></div> : null}
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
    onError: (error) => onError(error instanceof Error ? error.message : "Idea collection failed.")
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
    onError: (error) => onError(error instanceof Error ? error.message : "Idea status update failed.")
  });

  if (channels.length === 0) {
    return <section className="rounded-md border border-border p-5 text-sm text-muted-foreground">Create a channel before collecting ideas.</section>;
  }

  return (
    <section className="rounded-md border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb aria-hidden="true" className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Ideas</h2>
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
          <select
            className="h-10 rounded-md border border-border px-3 text-sm"
            onChange={(event) => setStatus(event.target.value as IdeaStatus | "ALL")}
            value={status}
          >
            {ideaStatuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <Button className="gap-2" disabled={!channelId || collectMutation.isPending} onClick={() => collectMutation.mutate()}>
            <Search aria-hidden="true" className="h-4 w-4" />
            Collect
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {ideas.isLoading ? <p className="text-sm text-muted-foreground">Loading ideas.</p> : null}
        {!ideas.isLoading && (ideas.data ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No ideas for this filter.</p>
        ) : null}
        {(ideas.data ?? []).map((idea) => (
          <article className="rounded-md border border-border p-4" key={idea.id}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{idea.title}</h3>
                  <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{idea.status}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{idea.summary}</p>
                <a className="mt-2 block break-all text-sm text-primary" href={idea.canonicalUrl} rel="noreferrer" target="_blank">
                  {idea.sourceName}
                </a>
              </div>
              <div className="grid min-w-48 gap-2 text-sm">
                <span>Value {(idea.expectedValueScore * 100).toFixed(0)}%</span>
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
                        {item}
                      </option>
                    ))}
                </select>
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
    <article className="rounded-md border border-border bg-white p-5 shadow-sm" data-testid={`channel-card-${channel.id}`}>
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
                    : connection.status}
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

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setMaxDailyPosts(channel.dailyPublishLimit);
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
  const form = useForm<WizardForm>({ defaultValues: defaultWizardValues });
  const values = form.watch();
  const preview = useMemo(() => buildChannelInput(values), [values]);

  const mutation = useMutation({
    mutationFn: (data: WizardForm) =>
      request("/channels", { method: "POST", body: JSON.stringify(buildChannelInput(data)) }, ChannelResponseSchema),
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 px-4 py-5">
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
        </section>
        <footer className="flex items-center justify-between border-t border-border px-5 py-4">
          <Button className="gap-2 bg-foreground" disabled={step === 0} onClick={() => setStep((current) => current - 1)} type="button">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            이전
          </Button>
          {step === lastStep ? (
            <Button className="gap-2" data-testid="wizard-create" disabled={mutation.isPending} type="submit">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              생성
            </Button>
          ) : (
            <Button className="gap-2" data-testid="wizard-next" onClick={() => setStep((current) => current + 1)} type="button">
              다음
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Button>
          )}
        </footer>
      </form>
    </div>
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
        <Field label="화면 비율" registration={register("aspectRatio")} />
        <Field label="해상도" registration={register("resolution")} />
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
      <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-4 text-xs">
        {JSON.stringify(preview, null, 2)}
      </pre>
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
