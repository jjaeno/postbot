import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { PolicyProfileSummarySchema, type PlatformOutputProfileInput } from "@postbot/contracts";
import type { ApiRequest } from "./insight-controls";
export const PolicyProfileNotice = ({ request, profiles }: { request: ApiRequest; profiles: PlatformOutputProfileInput[] }): ReactElement => {
  const policies = useQuery({ queryKey: ["policy-profiles"], queryFn: () => request("/automation/policy-profiles", { method: "GET" }, PolicyProfileSummarySchema.array()), staleTime: 60000 });
  return <aside className="space-y-2 rounded border p-3 text-sm"><h4 className="font-semibold">생성 전 유효 정책 길이 확인</h4>{policies.isLoading ? <p>정책 확인 중</p> : policies.isError ? <p role="alert">정책 조회 실패. 유효 범위를 확인하기 전 제작하지 마세요. 서버도 비용 발생 전에 다시 검사합니다.</p> : profiles.map((profile) => {
    const policy = policies.data?.find((entry) => entry.platform === profile.platform);
    const invalid = !policy || profile.minDurationSeconds < policy.minDurationSeconds || profile.maxDurationSeconds > policy.maxDurationSeconds;
    return <p key={profile.platform} role={invalid ? "alert" : undefined}>{profile.platform}: {policy ? `${policy.minDurationSeconds}~${policy.maxDurationSeconds}초 · ${policy.region} v${policy.version} · 확인 ${new Date(policy.checkedAt).toLocaleDateString()}` : "유효 정책 없음"}{invalid ? " — 출력 설정을 수정해야 제작할 수 있습니다." : " — 설정 범위 일치"}</p>;
  })}<p>이는 운영자가 등록한 정책 스냅샷입니다. 실제 플랫폼 정책의 최신성 확인은 운영자가 담당하며 게시 전에도 다시 검사합니다.</p></aside>;
};
