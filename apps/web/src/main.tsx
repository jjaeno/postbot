import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HealthResponseSchema, type HealthResponse } from "@postbot/contracts";
import { Button } from "./components/ui/button";
import "./styles.css";

const queryClient = new QueryClient();

const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
const configuredApiBaseUrl = viteEnv["VITE_API_BASE_URL"];
const apiBaseUrl: string =
  typeof configuredApiBaseUrl === "string" && configuredApiBaseUrl.length > 0
    ? configuredApiBaseUrl
    : "http://localhost:3000";

const fetchHealth = async (): Promise<HealthResponse> => {
  const response = await fetch(`${apiBaseUrl}/health`);

  if (!response.ok) {
    throw new Error(`Health check failed with ${response.status}`);
  }

  return HealthResponseSchema.parse(await response.json());
};

const HealthPanel = (): ReactElement => {
  const healthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: fetchHealth,
    retry: 1
  });

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-border pb-6">
          <div className="flex items-center gap-3 text-primary">
            <Activity aria-hidden="true" className="h-6 w-6" />
            <span className="text-sm font-semibold uppercase tracking-wide">Postbot</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">개발 환경 상태</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              1단계 모노레포 기반 검증 화면입니다. API `/health` 연결 상태만 확인합니다.
            </p>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-muted p-5">
            <p className="text-sm text-muted-foreground">API endpoint</p>
            <p className="mt-2 break-all font-mono text-sm">{apiBaseUrl}/health</p>
          </div>
          <div className="rounded-md border border-border bg-muted p-5">
            <p className="text-sm text-muted-foreground">Status</p>
            <p className="mt-2 text-lg font-semibold">
              {healthQuery.isLoading
                ? "확인 중"
                : healthQuery.isError
                  ? "연결 실패"
                  : healthQuery.data?.status}
            </p>
          </div>
        </section>

        {healthQuery.data ? (
          <pre className="overflow-auto rounded-md border border-border bg-muted p-5 text-sm">
            {JSON.stringify(healthQuery.data, null, 2)}
          </pre>
        ) : null}

        {healthQuery.isError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            API 서버를 시작한 뒤 다시 확인하세요.
          </p>
        ) : null}

        <Button onClick={() => void healthQuery.refetch()} disabled={healthQuery.isFetching}>
          <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
          다시 확인
        </Button>
      </section>
    </main>
  );
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HealthPanel />
    </QueryClientProvider>
  </StrictMode>
);
