const messages: Readonly<Record<string, string>> = {
  MISSING_SOURCE: "사실 주장에 출처가 없습니다. 출처가 있는 다른 소재를 선택하거나 대본을 재생성한 뒤 재검사하세요.",
  INSUFFICIENT_SOURCES: "독립 출처 수가 부족합니다. 충분한 출처가 있는 소재로 변경하세요. 수동 승인으로 우회할 수 없습니다.",
  LOW_RELIABILITY_SOURCE: "출처 신뢰도가 기준 미만입니다. 신뢰 가능한 소재로 변경하세요.",
  CONFLICTING_SOURCES: "출처끼리 주장 충돌이 있습니다. 충돌이 해소된 소재로 변경하세요.",
  DURATION_EXCEEDED: "플랫폼 최대 길이를 초과했습니다. 출력 길이 설정을 수정한 뒤 재생성하세요.",
  AI_DISCLOSURE_REQUIRED: "설명에 AI 생성 고지가 필요합니다. AI 생성 고지 추가 → 메타데이터 저장 → 정책 검사를 진행하세요.",
  ASSET_LICENSE_UNVERIFIED: "에셋 권리가 미확인입니다. 소유자가 실제 상업 사용·변형 권리를 확인하고 증빙을 등록한 뒤 재검사하세요.",
  COMMERCIAL_USE_NOT_VERIFIED: "상업 사용 권리가 확인되지 않았습니다. 허용되는 에셋으로 변경하거나 권리 증빙을 등록하세요.",
  DUPLICATE_RISK: "반복·독창성 위험이 있습니다. 다른 소재·구성으로 재생성한 뒤 재검사하세요.",
  SENSITIVE_TOPIC_REVIEW: "민감 주제가 감지됐습니다. 보류하고 제외 주제·소재를 검토하세요. v1은 수동 우회 승인을 제공하지 않습니다.",
  FORCED_REVIEW: "채널 또는 소재 위험 설정으로 보류됐습니다. 위험 원인을 해소한 후 재검사하세요.",
  PLATFORM_RULE_VIOLATION: "플랫폼 출력 규칙을 위반했습니다. 유효 정책 범위를 확인하고 설정 수정·재생성 후 재검사하세요.",
  RESTRICTED_TOPIC: "금지 주제가 포함되어 게시할 수 없습니다. 다른 소재를 선택하세요."
};
export const policyHelp = (code: string, fallback: string): string => messages[code] ?? fallback;
