import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus
} from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import {
  AuthResponseSchema,
  AuthSessionSchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  CreateChannelRequestSchema,
  type AuthResponse,
  type AuthSession,
  type ChannelResponse,
  type CreateChannelRequest,
  type Platform
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
            <Button className="gap-2" onClick={() => setWizardOpen(true)}>
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

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ChannelList
            channels={channels.data ?? []}
            isLoading={channels.isLoading}
            onEdit={setEditing}
            onError={setError}
          />
          <EditPanel channel={editing} onClose={() => setEditing(null)} onError={setError} />
        </div>
      </section>
      {wizardOpen ? <ChannelWizard onClose={() => setWizardOpen(false)} onError={setError} /> : null}
    </main>
  );
};

const ChannelList = ({
  channels,
  isLoading,
  onEdit,
  onError
}: {
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
        <ChannelCard key={channel.id} channel={channel} onEdit={onEdit} onError={onError} />
      ))}
    </section>
  );
};

const ChannelCard = ({
  channel,
  onEdit,
  onError
}: {
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

  return (
    <article className="rounded-md border border-border bg-white p-5 shadow-sm">
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
          <Button className="gap-2 bg-foreground" onClick={() => onEdit(channel)}>
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
        {channel.platformConnections.map((connection) => (
          <div key={connection.platform} className="rounded-md border border-border bg-muted px-3 py-2">
            <p className="text-sm font-medium">{platforms.find((item) => item.value === connection.platform)?.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {connection.status === "PLANNED" ? "연결 예정" : connection.status}
            </p>
          </div>
        ))}
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
          <Button className="gap-2" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
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
            <Button className="gap-2" disabled={mutation.isPending} type="submit">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              생성
            </Button>
          ) : (
            <Button className="gap-2" onClick={() => setStep((current) => current + 1)} type="button">
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
