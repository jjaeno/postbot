# 운영 비용, 알림, 보안 운영

## 비용과 대사

Provider 사용량은 `ProviderUsage`, 금액 변화는 append-only `CostLedger`에 DECIMAL(18,6) USD로 기록한다. `ESTIMATED`, `ACTUAL`, `CREDIT`은 서로 구분되며 UI/API 집계는 원장을 합산한다. 대사는 실제 ProviderUsage 합계와 ACTUAL 원장 합계를 비교하고 불일치 금액을 노출한다. 예산 변경은 `BudgetHistory`에 변경 전후 스냅샷을 남긴다.

## 알림과 감사

v1 알림 채널은 in-app이다. 이벤트 키·채널·30분 bucket으로 dedupe key를 만들므로 같은 장애가 작업을 재실행시키거나 알림 폭주를 일으키지 않는다. acknowledgement는 최초 확인 시각과 사용자를 보존한다. `AuditLog`는 수정 API가 없는 append-only 테이블이며 workspace 범위로만 조회된다.

## 관측성과 보안

API는 `x-correlation-id`를 수락 또는 생성해 응답에 반환하고 BullMQ job payload를 통해 worker/provider 로그까지 전파한다. 로그는 access/refresh token, cookie, password, API key, 암호화된 OAuth token 및 provider 원문 응답을 redaction한다. Sentry는 DSN이 없으면 no-op이다. `/health`는 liveness, `/ready`는 MySQL·Redis·storage readiness다. production에서는 HSTS, CSP, nosniff, referrer/permissions policy를 적용하고 CORS origin은 `WEB_BASE_URL`만 허용한다.

## 보존·삭제와 복구

`POST /operations/data-lifecycle`은 retention, workspace 삭제, 현재 사용자 삭제 요청을 `DataLifecycleRequest`에 먼저 저장하고 maintenance queue에서 비동기로 수행한다. 삭제 전에 준비 상태를 해제하고 파일 삭제/DB 정리를 추적하며 `GET /operations/data-lifecycle/:id`로 결과를 확인한다. 실패한 동일 요청을 같은 멱등 키로 다시 제출하면 원래 maintenance 작업을 재개한다. workspace 삭제는 채널·계정을 먼저 정지하고 진행 작업의 취소 완료를 기다린다. 공용 자산은 지우지 않고 다른 workspace의 참조가 확인되면 검토를 유지한다. 자세한 보존/복원 절차는 아래 20.10 절을 따른다. Redis queue 유실 시 `pnpm recover:queues`가 MySQL `ProductionJob`의 대기/재시도/오래된 실행 상태를 기준으로 재enqueue한다.

장애 대응 순서: Provider 장애는 provider switch와 retry/dead-letter를 확인하고, DB/Redis/MinIO 장애는 `/ready`와 컨테이너 healthcheck로 범위를 식별한다. credential 노출 의심 시 해당 플랫폼 계정을 disconnect하고 credential을 회전한다. 게시 중복 의심 시 `PublishPlan` idempotency key와 `PlatformPost`를 먼저 대조한다.

## 운영 준비 보완 (2026-10-13)

ADR-013에 따라 사용량×설정 단가 계산은 `ESTIMATED`이며 `ACTUAL`은 Provider 청구 근거가 있는 확정액에만 사용한다. 실제 token/문자/이미지/렌더 사용량과 청구 확정액을 혼동하지 않는다. 예상치·사용량 계산·청구서 대사를 구분한다. workspace와 channel 예산이 모두 있으면 양쪽 hard limit을 검사하며 workspace row lock으로 동시 예약을 직렬화한다. 해제된 reservation은 재시도 전에 다시 예산을 검사한다. USD 단가를 비USD 예산으로 암묵 환산하지 않고 보류한다. `RENDER_COST_MODE=free`는 명시적인 내부 무료 처리이며 `priced`의 0은 비용 미확정이다. 렌더도 실제 QA duration 기준 ProviderUsage/CostLedger를 한 번 기록한다.

worker/renderer 내부 `:3002/ready`는 BullMQ 실행/Redis 연결을 확인한다. HTTP health에는 외부 모니터를 연결할 수 있고 job 정체·반복 실패·storage는 `/ready`, `/jobs`, `/automation/runs`, `/operations/notifications`와 DB/queue 상태를 함께 확인한다. 외부 모니터·on-call 채널은 운영자가 선택한다.

## 채널 업무 감시와 보존 (20.10)

`GET /operations/channels/:channelId/business-health`와 설정 화면은 liveness/readiness와 별도로 마지막 수집·렌더·플랫폼 확인 게시 시각, 놓친 예약/자동 슬롯, 2시간 이상 대기, 하루 3회 이상 실패, 재인증·예산 보류, 로컬 임시 디스크 여유, UTC 일별 생성·렌더·게시·실패·비용 기록을 보여준다. S3 어댑터는 전체 저장 용량을 제공하지 않으므로 용량을 추정하지 않고 미제공으로 표시한다. 감시는 분당 채널 50개 cursor 단위로 순회하므로 전체 탐지 지연은 채널 수에 비례한다. 명시적으로 정지한 채널의 새 자동 슬롯을 누락으로 간주하지 않는다.

in-app 알림은 이벤트/채널/시간 구간별로 중복을 억제하고 지속 문제는 재알림하며 OWNER가 확인할 수 있다. `OPERATIONS_NOTIFICATION_PROVIDER=disabled`는 외부 미설정, `mock`은 Mock 검증 전용이다. DB lease로 Mock 중복 전달을 막고 실패는 재시도하며 확인한 알림은 다시 전달하지 않는다. 실제 메일·메신저·Sentry 수신 검증은 별도 운영 설정이 필요하다. 외부 전송 성공을 기록하지 않는다.

RETENTION은 오래된 FAILED 콘텐츠의 보호되지 않은 렌더와 참조·캐시·브랜드·활성 작업이 없는 자산만 대상으로 한다. 예약·승인·검토·게시·대사 및 활성 자동화의 결과는 보존한다. `storage_deletions`의 MARKED → DELETING → FILES_DELETED → DONE을 따라 파일 삭제 전 참조를 재확인하며 중단하면 같은 tombstone으로 재개한다. 삭제 예정 자산은 새 사용을 거절하고 렌더 manifest는 파일 삭제 전에 조회 준비 상태에서 제외한다. 삭제 시작 전 새 참조가 생기면 CANCELLED로 되돌려 보존한다. 생성 캐시·권리 정책·비용 영수증·원래 작업/멱등 키·후보 예약 정보/본문은 자동 보존 작업에서 일괄 삭제하지 않는다. 명시 workspace/user 삭제는 별도 경로다. 보존 기간만으로 증거가 필요 없는 것으로 추정하지 않는다.

Redis 완료 기록은 7일, 실패 기록은 30일/각 10000개 상한으로 정리하며 복구 스캔은 terminal 기록을 batch 100개씩 정리한다. DB 작업 기록은 남겨 Redis 재전달에도 이미 성공한 유료 작업을 실행하지 않는다. 임시 렌더 폴더는 소유 marker가 있고 같은 호스트의 PID가 종료되었으며 24시간이 지났고 실행 소유권이 없는 경우만 정리한다. marker가 없는 과거 폴더와 살아 있는 프로세스는 보존한다.

채널 감시는 정지한 채널도 포함해 만료 수집 캐시와 사용하지 않은 후보를 batch 100개씩 정리한다. 후보는 프로필의 보존 기간(최대 30일)을 적용하며 사용·선정·예약·생성 작업 근거가 있으면 보존한다. 채널별 cursor로 보호된 첫 페이지 이후도 순회한다. 오늘의 호출 예산 영수증은 지우지 않는다.

렌더 재사용은 저장소 존재 검사를 수행한다. 확인된 유실만 MISSING으로 바꾸고 원래 manifest/체크섬을 보존한다. 네트워크 검사 실패를 유실로 단정하지 않는다. 보존 작업은 요청 workspace의 참조만 검사하며 다음 cursor를 기록한다. 아래 운영자 CLI로 페이지를 이어 확인할 수 있다. `audit`은 확인된 유실의 준비 상태를 해제하고 전역 객체 목록도 검사하므로 저장소 운영자 권한으로 실행한다. 전역 고립 객체 검사는 사용자 보존 요청에서 실행하지 않는다. 참조가 없는 객체는 소유권이 확인되지 않은 검토 후보 해시만 보고하고 자동 삭제하지 않는다.

```sh
node scripts/storage-maintenance.mjs audit WORKSPACE_ID
node scripts/storage-maintenance.mjs audit WORKSPACE_ID ASSET_CURSOR SCENE_CURSOR OBJECT_CURSOR
node scripts/storage-maintenance.mjs verify-restore WORKSPACE_ID RENDER SCENE_ID EVIDENCE_SHA256
```

CLI 실행 전 명시 DATABASE_URL과 영속 S3 설정 및 빌드가 필요하다. 원래 백업에서 객체를 복원한 뒤 `verify-restore`가 원래 저장된 SHA-256과 일치함을 확인해야 준비 상태로 복구한다. 승인·정책·게시 상태는 자동 승인하지 않는다. 과거 렌더에 원래 체크섬이 없으면 검토를 유지하며 임의 체크섬을 새로 만들어 통과시키지 않는다.

## 암호화 백업 일정과 복원

기존 backup/verify/restore 스크립트를 `scripts/scheduled-backup.mjs`가 연결한다. 필수 설정은 명시 DATABASE_URL, `BACKUP_STATUS_FILE`, `BACKUP_ARCHIVE_DIRECTORY`, 별도 보관한 32바이트 raw 키의 `BACKUP_ENCRYPTION_KEY_FILE`이다. 실제 외부 mount를 운영자가 준비한 경우에만 `BACKUP_ARCHIVE_DESTINATION_KIND=offsite_mount`를 지정한다. 이 값은 저장소 사업자의 복제/가용성 증명이 아니다. 외부 설정이 없으면 LOCAL_TEST_ONLY이며 운영 백업 성공으로 취급하지 않는다. 키는 DB 덤프나 Git에 넣지 않는다.

덤프 metadata/체크섬 검증 → AES-256-GCM 암호화 → archive 재읽기/복호화 체크섬 검증 → 원문 임시 파일 제거 → 기본 14일 보관 순서다. 실패 상태와 마지막 성공 시각을 원자적으로 기록한다. 업무 감시는 미설정·실패·26시간 초과·외부 저장소/암호화/검증 미완료를 구분한다. stale lock은 진행 중 프로세스와 마지막 파일을 점검한 뒤 운영자가 해제한다. 배포 예시는 `ops/postbot-backup.service`/`.timer`이며 매일 UTC 02:10에 실행한다. 전용 사용자, Node/MySQL client, 외부 mount, 읽기 전용 키 파일, secret 환경 파일과 status 파일의 API 읽기 mount를 운영자가 준비해야 한다. 이 저장소 작업에서는 서비스 설치/활성화나 운영 DB 접근을 하지 않았다.

```sh
node scripts/scheduled-backup.mjs
RESTORE_DATABASE_URL='mysql://USER:PASSWORD@HOST/isolated_restore' node scripts/restore-archive.mjs ARCHIVE.sql.enc
```

복원은 빈 `_restore` DB만 허용하고 checksum·복호화 인증·migration/업무 데이터 수를 검사한다. 운영자는 주기적으로 격리 DB 복원과 중요 행을 확인하고 검증 시각/해당 archive checksum을 별도로 기록한다. 복원 리허설 전 원본 DB와 대상 DB를 반드시 대조한다. `MYSQL_BACKUP_MODE=docker`의 명시 `MYSQL_DOCKER_CONTAINER`를 사용할 경우 실제 host port mapping이 URL과 일치해야 한다. 기본 모드는 기존 로컬 Compose 범위만 허용한다.

실제 AI 이미지/TTS는 권리가 PENDING이다. 이미지와 음성을 각각 권리 증빙으로 승인한 뒤 기존 asset/timing을 재사용해 재개한다. 최신 증빙 변경은 관련 현재 출력의 정책/승인/예약을 무효화한다. FULL_AUTO도 권리 확인·민감/강제검수 gate를 우회하지 않는다. TikTok 실제 Direct Post는 게시 동의 UX·심사 적합성 해결 전 보류된다.

OpenAI는 실제 REST 응답과 사용량을 job payload의 `_llmAttempts`에 먼저 journal하고, 각 완료 호출을 고유 `script-attempt-cost:<job>:<attempt>`로 기록한다. 스키마 거절 응답도 사용량 계산에 포함하며 재전달은 캐시를 재사용한다. timeout/응답 손실/저장 중단은 `AMBIGUOUS_LLM_CALL_RECONCILIATION_REQUIRED`로 보류하고 자동 재과금을 막는다. 이때 예약금도 유지한다. 사업자 사용량/응답 ID를 대조한 운영자 판단 없이 journal을 지우거나 새 제작 요청을 반복하지 않는다.

실제 이미지·TTS는 ProductionJob payload의 `_mediaCalls` journal로 호출 시작/완료를 기록한다. 결과·저장·비용 기록이 불확실하면 `AMBIGUOUS_MEDIA_CALL_RECONCILIATION_REQUIRED`로 검수 보류하고 reservation을 유지한다. 실제 이미지 오류는 자동 fallback 성공으로 덮지 않는다. 완료된 결과의 저장 참조가 사라져도 자동 유료 재생성을 막는다. Provider 결과/청구와 자산·사용량 원장을 대조한 운영자 증거 없이 journal을 지우거나 재시도하지 않는다.

자동화 강제 종료(kill)는 실제 호출이 시작되지 않은 취소 job의 예약만 해제하고 해제액만 `budgetReserved`에서 차감한다. 실행 중·시도 이력이 있는 job·호출 결과 불명 job의 미정산 예약은 보존한다. 취소는 이미 시작한 외부 호출의 청구를 0으로 만들지 않는다. worker의 작업 시작과 취소는 ProductionJob 행 잠금으로 직렬화한다. 시작 여부를 입증할 job/시도 기록이 없는 예약도 자동으로 삭제하지 않고 운영자가 대사한다.

플랫폼이 게시 ID를 반환한 뒤 DB 저장에 실패해도 `AMBIGUOUS_PUBLISH` attempt와 HELD 계획으로 보류하고 반환된 ID를 보존한다. worker는 `AMBIGUOUS_PUBLISH_RECONCILIATION_REQUIRED` 검수 보류로 자동 업로드 재시도를 중단한다. 기존 계획이 취소되지 않은 동안 같은 콘텐츠/플랫폼의 새 요청 키도 기존 slot gate가 차단한다. 플랫폼 결과 확인 없이 재게시하지 않는다. LLM 응답 뒤 사용량/원장 저장 실패도 새 유료 schema retry로 이어지지 않으며, journal의 응답을 재사용해 비용 기록을 복구한다.
