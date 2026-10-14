# 운영 비용, 알림, 보안 운영

## 비용과 대사

Provider 사용량은 `ProviderUsage`, 금액 변화는 append-only `CostLedger`에 DECIMAL(18,6) USD로 기록한다. `ESTIMATED`, `ACTUAL`, `CREDIT`은 서로 구분되며 UI/API 집계는 원장을 합산한다. 대사는 실제 ProviderUsage 합계와 ACTUAL 원장 합계를 비교하고 불일치 금액을 노출한다. 예산 변경은 `BudgetHistory`에 변경 전후 스냅샷을 남긴다.

## 알림과 감사

v1 알림 채널은 in-app이다. 이벤트 키·채널·30분 bucket으로 dedupe key를 만들므로 같은 장애가 작업을 재실행시키거나 알림 폭주를 일으키지 않는다. acknowledgement는 최초 확인 시각과 사용자를 보존한다. `AuditLog`는 수정 API가 없는 append-only 테이블이며 workspace 범위로만 조회된다.

## 관측성과 보안

API는 `x-correlation-id`를 수락 또는 생성해 응답에 반환하고 BullMQ job payload를 통해 worker/provider 로그까지 전파한다. 로그는 access/refresh token, cookie, password, API key, 암호화된 OAuth token 및 provider 원문 응답을 redaction한다. Sentry는 DSN이 없으면 no-op이다. `/health`는 liveness, `/ready`는 MySQL·Redis·storage readiness다. production에서는 HSTS, CSP, nosniff, referrer/permissions policy를 적용하고 CORS origin은 `WEB_BASE_URL`만 허용한다.

## 보존·삭제와 복구

`POST /operations/data-lifecycle`은 retention, workspace 삭제, 현재 사용자 삭제 요청을 `DataLifecycleRequest`에 먼저 저장하고 maintenance queue에서 비동기로 수행한다. 원본/렌더 object를 먼저 지우고 workspace graph 또는 만료 데이터를 transaction으로 삭제하며 `GET /operations/data-lifecycle/:id`로 결과를 추적한다. 감사·비용 원장은 승인된 보존 정책에 따라 처리한다. MySQL은 UTC 백업을 암호화해 별도 접근 제어 저장소에 두고, 복원은 격리 DB에서 checksum과 행 수를 확인한 뒤 실행한다. Redis queue 유실 시 `pnpm recover:queues`가 MySQL `ProductionJob`의 대기/재시도/오래된 실행 상태를 기준으로 재enqueue한다.

장애 대응 순서: Provider 장애는 provider switch와 retry/dead-letter를 확인하고, DB/Redis/MinIO 장애는 `/ready`와 컨테이너 healthcheck로 범위를 식별한다. credential 노출 의심 시 해당 플랫폼 계정을 disconnect하고 credential을 회전한다. 게시 중복 의심 시 `PublishPlan` idempotency key와 `PlatformPost`를 먼저 대조한다.

## 운영 준비 보완 (2026-10-13)

ADR-013에 따라 사용량×설정 단가 계산은 `ESTIMATED`이며 `ACTUAL`은 Provider 청구 근거가 있는 확정액에만 사용한다. 실제 token/문자/이미지/렌더 사용량과 청구 확정액을 혼동하지 않는다. 예상치·사용량 계산·청구서 대사를 구분한다. workspace와 channel 예산이 모두 있으면 양쪽 hard limit을 검사하며 workspace row lock으로 동시 예약을 직렬화한다. 해제된 reservation은 재시도 전에 다시 예산을 검사한다. USD 단가를 비USD 예산으로 암묵 환산하지 않고 보류한다. `RENDER_COST_MODE=free`는 명시적인 내부 무료 처리이며 `priced`의 0은 비용 미확정이다. 렌더도 실제 QA duration 기준 ProviderUsage/CostLedger를 한 번 기록한다.

worker/renderer 내부 `:3002/ready`는 BullMQ 실행/Redis 연결을 확인한다. HTTP health에는 외부 모니터를 연결할 수 있고 job 정체·반복 실패·storage는 `/ready`, `/jobs`, `/automation/runs`, `/operations/notifications`와 DB/queue 상태를 함께 확인한다. 알림은 기존 in-app이며 별도 외부 전송/Sentry 수신 성공을 주장하지 않는다. 외부 모니터·on-call 채널은 운영자가 선택한다.

실제 AI 이미지/TTS는 권리가 PENDING이다. 이미지와 음성을 각각 권리 증빙으로 승인한 뒤 기존 asset/timing을 재사용해 재개한다. 최신 증빙 변경은 관련 현재 출력의 정책/승인/예약을 무효화한다. FULL_AUTO도 권리 확인·민감/강제검수 gate를 우회하지 않는다. TikTok 실제 Direct Post는 게시 동의 UX·심사 적합성 해결 전 보류된다.

OpenAI는 실제 REST 응답과 사용량을 job payload의 `_llmAttempts`에 먼저 journal하고, 각 완료 호출을 고유 `script-attempt-cost:<job>:<attempt>`로 기록한다. 스키마 거절 응답도 사용량 계산에 포함하며 재전달은 캐시를 재사용한다. timeout/응답 손실/저장 중단은 `AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED`로 보류하고 자동 재과금을 막는다. 이때 예약금도 유지한다. 사업자 사용량/응답 ID를 대조한 운영자 판단 없이 journal을 지우거나 새 제작 요청을 반복하지 않는다.

실제 이미지·TTS는 ProductionJob payload의 `_mediaCalls` journal로 호출 시작/완료를 기록한다. 결과·저장·비용 기록이 불확실하면 `AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED`로 검수 보류하고 reservation을 유지한다. 실제 이미지 오류는 자동 fallback 성공으로 덮지 않는다. 완료된 결과의 저장 참조가 사라져도 자동 유료 재생성을 막는다. Provider 결과/청구와 자산·사용량 원장을 대조한 운영자 증거 없이 journal을 지우거나 재시도하지 않는다.

자동화 강제 종료(kill)는 실제 호출이 시작되지 않은 취소 job의 예약만 해제하고 해제액만 `budgetReserved`에서 차감한다. 실행 중·시도 이력이 있는 job·호출 결과 불명 job의 미정산 예약은 보존한다. 취소는 이미 시작한 외부 호출의 청구를 0으로 만들지 않는다. worker의 작업 시작과 취소는 ProductionJob 행 잠금으로 직렬화한다. 시작 여부를 입증할 job/시도 기록이 없는 예약도 자동으로 삭제하지 않고 운영자가 대사한다.

플랫폼이 게시 ID를 반환한 뒤 DB 저장에 실패해도 `AMBIGUOUS_PUBLISH` attempt와 HELD 계획으로 보류하고 반환된 ID를 보존한다. worker는 `AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED` 검수 보류로 자동 업로드 재시도를 중단한다. 기존 계획이 취소되지 않은 동안 같은 콘텐츠/플랫폼의 새 요청 키도 기존 slot gate가 차단한다. 플랫폼 결과 확인 없이 재게시하지 않는다. LLM 응답 뒤 사용량/원장 저장 실패도 새 유료 schema retry로 이어지지 않으며, journal의 응답을 재사용해 비용 기록을 복구한다.
