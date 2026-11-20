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

20.11 보완: 수집 성과는 새 외부 읽기와 적격 후보가 함께 기록된 COLLECT 결과로 판단한다. RANK/SELECT, 캐시 재사용, 후보 0개는 성공 주기를 갱신하지 않는다. `SourceFetch.completedAt`은 실제 새 읽기의 성공 시각이며 기존 행은 NULL을 유지한다. `lastExternalSuccessAt`은 마지막 읽기, `lastCollectionAt`은 후보 확보 성과로 구분한다. 결과 영수증은 `ProductionJob.result.externalCollection`에 남아 만료 캐시 정리 후에도 성과 시각을 확인할 수 있다.

`collectionProgress`/`productionProgress`는 기대 실행·마지막 시도/성과·지연·주기·유예·판정 사유를 반환한다. 최초 기대 시각은 채널 생성+주기이며 유예는 추가 1주기+15분이다. 이후 마지막 성과를 기준으로 계산한다. 제작은 승인 재고+가까운 예약 재고, 진행 작업, 검수 대기/상한을 함께 본다. 재고 충족/의도적 정지/예산/계정/설정 보류는 STALLED와 구분한다. 진행 작업 자체가 정체되면 기존 STALE_WORK가 별도로 경고한다. 실제 성과 이력이 없으면 PROGRESS_OBSERVED를 반환하지 않는다. 해소한 business 알림은 payload._resolution=RESOLVED로 보존하고 전달하지 않으며, 지속 장애는 기존 4시간 bucket의 중복 억제·확인·재알림을 따른다.

`GET /operations/channels/:channelId/business-health`와 설정 화면은 liveness/readiness와 별도로 마지막 수집·렌더·플랫폼 확인 게시 시각, 놓친 예약/자동 슬롯, 2시간 이상 대기, 하루 3회 이상 실패, 재인증·예산 보류, 로컬 임시 디스크 여유, UTC 일별 생성·렌더·게시·실패·비용 기록을 보여준다. S3 어댑터는 전체 저장 용량을 제공하지 않으므로 용량을 추정하지 않고 미제공으로 표시한다. 감시는 분당 채널 50개 cursor 단위로 순회하므로 전체 탐지 지연은 채널 수에 비례한다. 명시적으로 정지한 채널의 새 자동 슬롯을 누락으로 간주하지 않는다.

in-app 알림은 이벤트/채널/시간 구간별로 중복을 억제하고 지속 문제는 재알림하며 OWNER가 확인할 수 있다. `OPERATIONS_NOTIFICATION_PROVIDER=disabled`는 외부 미설정, `mock`은 Mock 검증 전용이다. DB lease로 Mock 중복 전달을 막고 실패는 재시도하며 확인한 알림은 다시 전달하지 않는다. 실제 메일·메신저·Sentry 수신 검증은 별도 운영 설정이 필요하다. 외부 전송 성공을 기록하지 않는다.

RETENTION은 오래된 FAILED 콘텐츠의 보호되지 않은 렌더와 참조·캐시·브랜드·활성 작업이 없는 자산만 대상으로 한다. 예약·승인·검토·게시·대사 및 활성 자동화의 결과는 보존한다. `storage_deletions`의 MARKED → DELETING → FILES_DELETED → DONE을 따라 파일 삭제 전 참조를 재확인하며 중단하면 같은 tombstone으로 재개한다. 삭제 예정 자산은 새 사용을 거절하고 렌더 manifest는 파일 삭제 전에 조회 준비 상태에서 제외한다. 삭제 시작 전 새 참조가 생기면 CANCELLED로 되돌려 보존한다. 생성 캐시·권리 정책·비용 영수증·원래 작업/멱등 키·후보 예약 정보/본문은 자동 보존 작업에서 일괄 삭제하지 않는다. 명시 workspace/user 삭제는 별도 경로다. 보존 기간만으로 증거가 필요 없는 것으로 추정하지 않는다.

Redis 완료 기록은 7일, 실패 기록은 30일/각 10000개 상한으로 정리하며 복구 스캔은 terminal 기록을 batch 100개씩 정리한다. DB 작업 기록은 남겨 Redis 재전달에도 이미 성공한 유료 작업을 실행하지 않는다. 임시 렌더 폴더는 소유 marker가 있고 같은 호스트의 PID가 종료되었으며 24시간이 지났고 실행 소유권이 없는 경우만 정리한다. marker가 없는 과거 폴더와 살아 있는 프로세스는 보존한다.

채널 감시는 정지한 채널도 포함해 만료 수집 캐시와 사용하지 않은 후보를 batch 100개씩 정리한다. 후보는 프로필의 보존 기간(최대 30일)을 적용하며 사용·선정·예약·생성 작업 근거가 있으면 보존한다. 채널별 cursor로 보호된 첫 페이지 이후도 순회한다. 오늘의 호출 예산 영수증은 지우지 않는다.

## 소재 조사 운영 계약 (20.11)

`limits.targetCandidates`는 평가 후 제작 후보 목표다. 선택적 `processingCandidates`는 20–400이며 미설정이면 min(400, max(40, target×4))이다. 기존 프로필 JSON은 그대로 읽는다. 소스/검색어별 차례를 순환하고 UTC 날짜로 시작 소스를 회전한다. 한 수집의 검색 작업은 최대 min(120, 처리 상한), 페이지는 기존 설정 1–5, 페이지당 후보는 25개로 제한한다. 공통 일별 호출 예산·캐시·안전 읽기를 재사용한다. URL 중복 제거→보강→출처/채널/시각 조건 평가→최종 목표 제한 순서이며, 보강 후 같은 원문으로 합쳐져도 남은 후보를 처리한다. `externalCollection.sources`와 후보의 collectionEvaluation/rejectionReason에서 수집·보강·통과·선정/탈락 사유를 확인한다. 모든 출처에 호출을 보장할 수 없는 작은 예산에서는 예산을 넘기지 않고 실패 사유를 기록한다.

미디어 참고 자료는 IMAGE_PREVIEW/DETAIL_PAGE/API_RESPONSE로 정규화한다. NASA href+render=image+rel=preview, LoC 이미지 URL 문자열, 기존 url 객체/이미지 확장자를 호환한다. 상세 페이지·JSON/XML/API 주소만으로 시각 조건을 통과하지 않는다. HTTPS preview는 참고 자료의 존재만 의미한다. downloadable/commercialUse=UNKNOWN, rights=ITEM_REVIEW_REQUIRED이며 기존 자산 권리·제작 승인 검사는 유지한다. 기존 저장 NASA href도 공통 판정 함수로 읽는다.

질문은 ID·본문·분류·기원·상태 및 현재 채널의 언어/시청자/제외 주제/이야기 설정과 함께 전달한다. LoC/NASA q와 키워드 검색이 설정된 YouTube q에는 전체 질문을 사용한다. 참고 채널 업로드만 설정한 경우 임의로 전역 YouTube 검색을 추가하지 않는다. RSS는 원격 질의인 것처럼 표시하지 않고 LOCAL_FEED_FILTER와 feed URL을 기록한다. 조사 상태는 INVESTIGATE→MATERIAL_FOUND/CLAIM_REVIEW_REQUIRED/CONFLICTING_EVIDENCE/INSUFFICIENT_EVIDENCE이며 API evidenceState의 ANSWER_EVIDENCE_AVAILABLE은 답변 관련 원문 인용 확보를 뜻한다. 이전 SUPPORTED는 MATERIAL_FOUND로 해석한다. claimsVerified는 false다. 질문별 요청 기록·원문 snapshot·SHA-256·정규화 텍스트 위치·최대 5회 이력을 보존하고 recheck는 다음 수집에서 재조사한다. 분류 일치/원문 확보만으로 답을 검증하지 않는다. 현재 판정은 보수적인 대상 토큰·같은 문장의 관계/반증 표현 검사이며 의미 이해/사실성 교차 검증을 대신하지 않는다. 외부 본문과 질문은 지시문으로 실행하지 않는다.

YouTube는 공개 탐색 자료다. 설명란에 적격 원문이 없으면 제목을 미검증 조사 가설로 삼아 채널에서 허용한 LoC/NASA를 조회한다. 독립 검색 결과 중 최대 3건의 허용 원문을 확인하며, 질문별 원문 인용이 없거나 다른 사건이면 DISCOVERY 상태를 유지한다. 커넥터가 없으면 INDEPENDENT_SEARCH_NOT_CONFIGURED, 허용 출처가 없으면 NO_ALLOWED_DISCOVERY_SOURCE_CONFIGURED, 키가 없으면 YOUTUBE_DISCOVERY_KEY_UNSET을 기록한다. 임의 웹 검색·영상/음성/제3자 자막 다운로드는 구현하지 않았다. 공개 통계는 원래 지표로 분리하고 자체 점수/성과 추론에 쓰지 않는다. [YouTube 공식 정책](https://developers.google.com/youtube/terms/developer-policies), [NASA 응답 문서](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf), [LoC 요청 문서](https://www.loc.gov/apis/json-and-yaml/requests/)는 2026-11-20 확인했으며 커넥터 관리자가 정책/응답 변경 시 갱신한다. 실제 API 및 운영 규모 검증은 별도다.

YouTube 정책 III.E는 2026-11-21 재확인했다. 영상 제목은 독립 검색의 입력으로 그대로 전달하며 YouTube 페이지/리다이렉트는 사실 근거에서 제외한다. 자동 질문 레코드는 독립 원문 기반으로만 만든다. 다운로드·새 파생 지표/데이터를 허용받았다고 해석하지 않으며 실제 API 프로젝트의 정책 적합성 심사는 운영자가 확인해야 한다.

## 저장소 감사

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

## 재수집과 질문 조사 재개 (20.12)

소재의 URL 식별자와 첫 수집 contentHash는 동일성/중복 확인에 쓰고, 현재 제작 근거는 `ContentIdea.rawSnapshot.sourceVersionId`로 구분한다. `sourceVersions`는 URL·원문 NFKC SHA-256·범위·근거·시각 참조 등이 다른 관측을 내용 기반 ID로 보존한다. 반복 수집 시각·랭킹·예약 정보만 바뀐 경우에는 새 버전을 만들지 않는다. 별도 URL의 동일 contentHash는 대체 출처 관측으로 남기고 기존 소재의 출처/URL을 덮어쓰지 않는다. 기존 snapshot은 처음 보강/생성할 때 LEGACY_SNAPSHOT으로 편입하며 과거 실제 수집 시각이나 사실 검증을 소급 인증하지 않는다. 스키마 변경이나 강제 backfill은 없다.

미사용·미예약 CANDIDATE/SHORTLISTED는 같은 URL의 새 정상 관측으로 보강한다. FULL_TEXT를 SUMMARY·실패·더 오래된 캐시로 바꾸지 않는다. 명시적 근거 충돌은 새 관측에 보존하고 현재 근거를 유지하며 자동 선정은 SOURCE_EVIDENCE_CONFLICT_REVIEW_REQUIRED로 보류한다. 이후 최신의 충돌 없는 적격 관측을 활성화할 수 있고 이전 기록은 삭제하지 않는다. reservationRunId, USED, usedContentItemId, 선정/사용 이력은 재수집으로 해제하지 않는다.

수집 저장·기존 선정/수동 시작·생성의 근거 고정은 같은 채널 행 잠금과 작업 실행 소유권 경계에서 직렬화한다. SCRIPT는 Provider 호출 전에 한 버전을 `_sourceEvidence`에 고정하고 `evidencePinned=true`로 재수집의 활성 버전 교체를 막는다. 재시도도 이 스냅샷을 사용한다. `ScriptVersion.qualitySnapshot.generationContext`의 sourceVersionId/sourceFingerprint와 `SourceReference.normalizedSnapshot`은 실제 생성 입력의 근거를 가리킨다. 질문 원문 인용의 sourceObservation에는 소재 ID·해당 원문 fingerprint·버전 ID를 기록한다. 같은 URL의 서로 다른 fingerprint나 과거 인용을 최신 버전으로 잘못 연결하지 않는다. 새 원문은 별도 관측으로 남고 이미 진행/완료된 제작의 근거를 바꾸지 않는다.

질문은 INVESTIGATE뿐 아니라 RESEARCH_PENDING/RESEARCH_PARTIAL도 다음 수집 대상이다. 최종 제작 목표와 별개로 실행당 최대 5개 질문, 질문당 최대 2개 원문 후보에 조사 기회를 배분한다. 질문 페이지는 질문들/출처들 사이에서 순환한 뒤 일반 검색어 페이지로 진행한다. 새 외부 읽기는 질문별 남은 예산 분배와 최대 3회 제한을 함께 적용하며 캐시와 채널 일별 원자적 예산은 그대로 사용한다. 작은 예산에서는 UTC 날짜로 질문 차례를 회전하고 일부 질문을 명시적으로 연기한다. 탐색에도 원문 조사 예산을 남기되 캐시 재사용은 허용한다.

`research-v2`의 investigation은 COMPLETE/PARTIAL/NOT_STARTED, 발견/처리/시도/보강 수, stopReason을 반환한다. COMPLETE는 설정된 조사 범위 또는 답변 관련 인용 확보까지의 완료이며 사실 검증 완료가 아니다. 예산 소진·질문 호출/시도 한도·처리 상한·미설정/실패는 확정적 근거 부족과 구분한다. 후보가 없더라도 실제 질문 검색이 실행되지 않았으면 완료로 표시하지 않는다. 최종 제작 후보 수는 보강·중복 제거·현재 채널 평가 후 별도로 제한한다.

진행 체크포인트는 질문/현재 채널 설정 signature, 중복 없는 처리 키/결과, 보존할 원문 인용, 다음 최대 2개 후보와 추가 검색 필요 여부를 저장한다. 이후 주기는 처리한 같은 자료를 건너뛰고 미완료 원문부터 재개할 수 있다. 일 예산 1회인 경우에도 첫날 검색 결과를 저장하고 다음 날 원문부터 읽을 수 있다. 캐시 실패/일별 예산은 재개로 우회하지 않는다. 수동 recheck의 INVESTIGATE는 이전 커서를 사용하지 않으며 유효한 캐시·예산을 유지한다. 저장 시 상태+updatedAt 조건을 확인해 진행 중 들어온 수동 재검사나 상태 변경을 덮어쓰지 않는다. 동일한 근거/진행 결과는 질문 이력을 중복 추가하지 않는다.

관측 버전은 후보의 기존 보존 수명과 함께 관리되고 제작에 사용한 원문은 기존 SourceReference/ScriptVersion에도 남는다. 내용이 자주 바뀌는 장기 후보의 JSON 버전/처리 키는 증가할 수 있어 운영 규모의 저장량 관측이 필요하다. 변경된 두 경로는 Mock 외부 응답과 격리 DB/Redis로 검증하며 실제 API 품질·정책 승인·운영 규모를 검증한 것은 아니다.
