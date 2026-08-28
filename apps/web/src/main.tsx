import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, ShieldCheck, UserPlus } from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AuthResponseSchema,
  AuthSessionSchema,
  type AuthResponse,
  type AuthSession
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
const formText = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const Field = ({
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
        {mode === "register" ? <Field label="이름" name="displayName" /> : null}
        <Field label="이메일" name="email" type="email" />
        <Field
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

const Dashboard = ({ session }: { session: AuthSession }): ReactElement => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const logout = useMutation({
    mutationFn: () => request("/auth/logout", { method: "POST" }, { parse: () => ({ ok: true }) }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["auth", "me"] });
    },
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : "로그아웃할 수 없습니다.")
  });

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <ShieldCheck aria-hidden="true" className="h-5 w-5" />
              <span className="text-sm font-semibold">Postbot</span>
            </div>
            <h1 className="text-2xl font-semibold">관리 콘솔</h1>
          </div>
          <Button className="gap-2 bg-foreground" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut aria-hidden="true" className="h-4 w-4" />
            로그아웃
          </Button>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border bg-muted p-5">
            <p className="text-sm text-muted-foreground">사용자</p>
            <p className="mt-2 font-semibold">{session.user.displayName}</p>
            <p className="mt-1 text-sm text-muted-foreground">{session.user.email}</p>
          </div>
          <div className="rounded-md border border-border bg-muted p-5">
            <p className="text-sm text-muted-foreground">워크스페이스</p>
            <p className="mt-2 font-semibold">{session.workspace.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{session.workspace.role}</p>
          </div>
        </section>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      </section>
    </main>
  );
};

const App = (): ReactElement => {
  const me = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false
  });

  if (me.isLoading) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        세션을 확인하는 중입니다.
      </main>
    );
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
