import type { BusinessProgress } from "@postbot/contracts";
const labels: Record<string, string> = { STALLED: "기대한 실행 주기를 넘겨 중단됨", INITIAL_GRACE: "최초 운영 유예 중", AWAITING_NEXT_CYCLE: "다음 주기 대기", IN_PROGRESS: "제작 작업 진행 중", INVENTORY_SATISFIED: "필요 재고 충족", REVIEW_HOLD: "검수 대기 또는 검수 상한", ACCOUNT_HOLD: "계정 복구 대기", BUDGET_HOLD: "예산 보류", SOURCE_BUDGET_HOLD: "출처 호출 예산 소진", INTENTIONALLY_PAUSED: "운영자가 정지함", NOT_CONFIGURED: "필수 설정 미완료", NO_CANDIDATES: "외부 읽기는 있었으나 제작 후보 없음" };
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "기록 없음";
export function BusinessProgressSummary({ collection, production, lastExternalSuccessAt }: { collection?: BusinessProgress; production?: BusinessProgress; lastExternalSuccessAt?: string | null }) {
  return <div className="mt-3 space-y-2 break-words text-sm">{lastExternalSuccessAt !== undefined && <p>마지막 실제 외부 읽기: {time(lastExternalSuccessAt)}</p>}{([["수집", collection], ["제작", production]] as const).map(([name, progress]) => progress && <div key={name} data-testid={name === "수집" ? "collection-progress" : "production-progress"}><p>{name}: {labels[progress.state] ?? progress.state}</p><p>기대 실행: {time(progress.expectedAt)} · 마지막 시도: {time(progress.lastAttemptAt)} · 마지막 성과: {time(progress.lastSuccessAt)}</p><p>지연 {progress.delayMinutes}분 · 주기 {progress.cadenceMinutes}분 · 유예 {progress.graceMinutes}분</p>{progress.state === "STALLED" && <p>판정 근거: 주기와 유예를 넘겼으며 성공 결과나 진행 작업이 없습니다.</p>}</div>)}</div>;
}
export function notificationResolved(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || !("_resolution" in payload)) return false;
  const resolution = payload._resolution;
  return Boolean(resolution && typeof resolution === "object" && "state" in resolution && resolution.state === "RESOLVED");
}
