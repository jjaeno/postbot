import type { ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AutomationSwitchResponseSchema } from "@postbot/contracts";
import type { ApiRequest } from "./insight-controls";
import { Button } from "./components/ui/button";

export const ProviderControls = ({ request, owner }: { request: ApiRequest; owner: boolean }): ReactElement => {
  const cache = useQueryClient();
  const switches = useQuery({ queryKey: ["automation-switches"], queryFn: () => request("/automation/switches", { method: "GET" }, AutomationSwitchResponseSchema.array()), refetchInterval: 5000 });
  const action = useMutation({ mutationFn: ({ provider, isEnabled }: { provider: string | null; isEnabled: boolean }) => request("/automation/switches", { method: "POST", body: JSON.stringify({ provider, isEnabled, reason: isEnabled ? "운영자가 복구 확인 후 활성화" : "운영자가 안전을 위해 중지" }) }, AutomationSwitchResponseSchema), onSuccess: () => { void cache.invalidateQueries({ queryKey: ["automation-switches"] }); void cache.invalidateQueries({ queryKey: ["automation-runs"] }); } });
  return <section className="space-y-3 rounded border bg-white p-5" data-testid="provider-controls"><h3 className="font-semibold">자동화·Provider 안전 스위치</h3><p className="text-sm">자동 차단 원인을 확인한 뒤 활성화하세요. 활성화만으로 보류 작업을 재시도하지 않습니다. 제작 진행에서 해당 실패 단계를 재시도해야 합니다. 전체 중지는 신규 자동화 실행을 차단합니다.</p>{switches.isError ? <p role="alert">상태를 확인하지 못했습니다. 활성 상태로 가정하지 않습니다.</p> : switches.isLoading ? <p>스위치 확인 중</p> : [null, "llm", "image", "tts", "renderer", "publisher"].map((provider) => {
    const current = switches.data?.find((entry) => entry.provider === provider);
    const enabled = current?.isEnabled ?? true;
    return <article className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm" key={provider ?? "workspace"}><div><p>{provider ?? "전체 자동화"}: {enabled ? "활성" : "차단"}</p>{current?.reason ? <p className="mt-1 text-xs">{current.reason}</p> : null}</div><Button disabled={!owner || action.isPending} onClick={() => { if (window.confirm(`${provider ?? "전체 자동화"} ${enabled ? "중지" : "복구 후 활성화"}를 확인할까요?`)) action.mutate({ provider, isEnabled: !enabled }); }}>{enabled ? "중지" : "복구 후 활성화"}</Button></article>;
  })}{action.error ? <p role="alert">{action.error.message}</p> : null}</section>;
};
