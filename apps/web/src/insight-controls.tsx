import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OptimizationSettingsSchema, OptimizationSuggestionResponseSchema, type OptimizationSettings, type Platform } from "@postbot/contracts";
import { z } from "zod";
import { Button } from "./components/ui/button";

export type ApiRequest = <Result>(path: string, options: RequestInit, parser: { parse(value: unknown): Result }) => Promise<Result>;
const field = "mt-1 w-full rounded border p-2";
export const InsightControls = ({ channelId, platform, days, owner, request }: { channelId: string; platform: string; days: number; owner: boolean; request: ApiRequest }): ReactElement => {
  const cache = useQueryClient();
  const [metric, setMetric] = useState("views");
  const [settings, setSettings] = useState<OptimizationSettings>(OptimizationSettingsSchema.parse({}));
  const [topics, setTopics] = useState(""); const [brands, setBrands] = useState(""); const [patterns, setPatterns] = useState("");
  const [notice, setNotice] = useState("");
  const stored = useQuery({ queryKey: ["optimization-settings", channelId], queryFn: () => request(`/optimization/settings?channelId=${encodeURIComponent(channelId)}`, { method: "GET" }, OptimizationSettingsSchema), enabled: Boolean(channelId) });
  useEffect(() => { if (stored.data) { setSettings(stored.data); setTopics(stored.data.protectedTopics.join(",")); setBrands(stored.data.protectedBrandPhrases.join(",")); setPatterns(stored.data.prohibitedPatterns.join(",")); } }, [stored.data, channelId]);
  const period = () => { const end = new Date(); return { periodStart: new Date(end.getTime() - days * 86400000).toISOString(), periodEnd: end.toISOString() }; };
  const sync = useMutation({ mutationFn: async () => {
    const range = period();
    const platforms: Platform[] = platform === "YOUTUBE" || platform === "INSTAGRAM" || platform === "TIKTOK" ? [platform] : ["YOUTUBE", "INSTAGRAM", "TIKTOK"];
    for (const selected of platforms) await request("/analytics/sync", { method: "POST", body: JSON.stringify({ channelId, platform: selected, ...range, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, idempotencyKey: `analytics-ui:${crypto.randomUUID()}` }) }, z.unknown());
  }, onSuccess: () => { setNotice("동기화를 요청했습니다. 작업 완료 후 지표가 갱신됩니다. 게시물이 없거나 권한이 부족한 플랫폼은 가용 지표가 없을 수 있습니다."); void cache.invalidateQueries({ queryKey: ["analytics"] }); } });
  const generate = useMutation({ mutationFn: () => request("/optimization/suggestions/generate", { method: "POST", body: JSON.stringify({ channelId, platform, metric, ...period(), idempotencyKey: `suggest-ui:${crypto.randomUUID()}` }) }, OptimizationSuggestionResponseSchema), onSuccess: () => { setNotice("제안을 생성했습니다. 표본 부족은 적용 가능한 패턴이 아닙니다."); void cache.invalidateQueries({ queryKey: ["optimization-suggestions"] }); } });
  const csv = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);
  const save = useMutation({ mutationFn: () => request("/optimization/settings", { method: "POST", body: JSON.stringify({ channelId, settings: OptimizationSettingsSchema.parse({ ...settings, protectedTopics: csv(topics), protectedBrandPhrases: csv(brands), prohibitedPatterns: csv(patterns) }) }) }, OptimizationSettingsSchema), onSuccess: () => { setNotice("최적화 보호 설정을 저장했습니다. 이후 제안 생성에 적용됩니다."); void cache.invalidateQueries({ queryKey: ["optimization-settings", channelId] }); } });
  return <section className="space-y-3 rounded border bg-white p-5" data-testid="insight-controls"><h3 className="font-semibold">분석 동기화·제안 생성</h3><p className="text-sm">선택한 채널·기간·플랫폼을 사용합니다. v1 제안과 비교 실험은 영상 길이만 지원하며 인과관계나 성과 개선을 보장하지 않습니다.</p><div className="flex flex-wrap gap-2"><Button disabled={!channelId || sync.isPending} onClick={() => sync.mutate()}>성과 동기화</Button><label className="text-sm">제안 기준 지표<select className={field} value={metric} onChange={(event) => setMetric(event.target.value)}>{[["views", "조회수"], ["impressions", "노출수"], ["average_watch_seconds", "평균 시청 시간"], ["completion_rate", "완주율"], ["engagement_rate", "참여율"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button disabled={!channelId || !platform || generate.isPending} onClick={() => generate.mutate()}>최적화 제안 생성</Button></div>{!platform ? <p className="text-sm">제안 생성은 분석 플랫폼을 하나 선택해 주세요.</p> : null}
    <details><summary>최적화 허용 범위·보호 설정 (소유자)</summary><div className="mt-3 space-y-2"><label className="block text-sm"><input type="checkbox" disabled={!owner} checked={settings.autoApplyFields.includes("durationSeconds")} onChange={(event) => setSettings({ ...settings, autoApplyFields: event.target.checked ? ["durationSeconds"] : [] })} /> 길이 변경 제안 허용 (제안별 승인·적용은 별도)</label><label className="block text-sm">최대 변경 비율<input className={field} type="number" min={0} max={0.5} step={0.01} disabled={!owner} value={settings.maxChangeRatio} onChange={(event) => setSettings({ ...settings, maxChangeRatio: Number(event.target.value) })} /></label>{[{ label: "보호 주제", value: topics, set: setTopics }, { label: "보호 브랜드 문구", value: brands, set: setBrands }, { label: "금지 패턴", value: patterns, set: setPatterns }].map((item) => <label className="block text-sm" key={item.label}>{item.label} (쉼표 구분)<input className={field} disabled={!owner} value={item.value} onChange={(event) => item.set(event.target.value)} /></label>)}<Button disabled={!owner || !channelId || save.isPending || stored.isLoading || stored.isError} onClick={() => save.mutate()}>최적화 설정 저장</Button></div></details>
    {[stored.error, sync.error, generate.error, save.error].map((error, index) => error ? <p role="alert" className="text-sm text-red-700" key={index}>{error.message}</p> : null)}{notice ? <p role="status" className="text-sm">{notice}</p> : null}
  </section>;
};
