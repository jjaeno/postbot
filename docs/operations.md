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
