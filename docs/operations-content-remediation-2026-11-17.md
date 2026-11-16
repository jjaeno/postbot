# 운영 안정성·콘텐츠 개선 후속 검증

요청일 2026-11-17, 시작 HEAD `7c0e638`, 브랜치 `fix/production-readiness`. 작업 트리 변경 없음에서 시작했다. 정적 분석 기준 `1717da8`의 후보를 최신 코드에서 재검증한다. 전체 v1 완료 선언과 별개인 19.9 후속 단계다. 유료 API, 실제 SNS, 운영 DB, push/merge/배포는 수행하지 않는다.

## 1단계: 중단 작업·게시

- 확인: RUNNING 재전달은 반환하며 기존 CLI만 startedAt/큐 상태로 판단했다. 자동 복구 및 살아 있는 실행자 구분이 없었다.
- 이미 해결: JobAttempt/ProductionJob/AutomationStep의 시작은 `7c0e638`에서 하나의 트랜잭션이다. 기존 회귀를 유지한다.
- 확인: 수동 예약→job 생성과 PUBLISHING→publishAttempt 생성은 분리되어 있었다.
- 수정: executionToken, 5초 heartbeat, 큐 active와 heartbeat 양쪽 확인, row lock 아래 복구 claim. 30초마다 자동 복구하고 CLI와 판정 공유. SCRIPT/ASSET/TTS/PUBLISH의 소유자 유실은 journal 누락 가능성까지 보수적으로 대사 보류한다. 안전한 작업만 같은 ID로 전달한다. 이전 token의 완료와 COLLECT 예약/RENDER manifest 커밋은 DB row lock 아래 차단한다.
- 수정: 수동 예약·durable ProductionJob·content 상태를 함께 저장한다. DB 작업을 outbox로 사용하며 Redis 실패 뒤 CLI/자동 스캔 또는 동일 요청이 재전달한다. 동일 요청은 예약 시간이 지난 뒤에도 소유권을 검증한 다음 기존 실행 연결을 복구한다. PUBLISHING과 시도 저장을 원자화한다. 고립 SCHEDULED에는 누락 job을 만들고 시도 없는 오래된 PUBLISHING은 HELD로 보낸다. 플랫폼 게시 기록이 있으면 재업로드하지 않는다.
- migration `202611170001_job_ownership`: nullable token/heartbeat, 기존 데이터 backfill 불필요. 기존 RUNNING은 startedAt을 참고하되 큐 active이면 유지한다. rollback은 신규 worker를 중지한 뒤 컬럼 제거가 가능하지만 보류된 유료 호출을 자동 재시도 상태로 돌리면 안 된다.
- 환경: 전용 `postbot-remediation-mysql`(13307), `postbot-remediation-redis`(16379), `postbot_remediation_test`. 실제/운영 DB를 사용하지 않는다.
- 검증 진행: 빈 DB의 전체 16 migrations 적용 성공. worker 게시/재전달/복구 9건, API 게시 6건 통과. 실제 worker 강제 종료를 추가한 경쟁 테스트에서 Prisma upsert의 unique-key 경쟁을 재현하여 중복 무시 insert로 수정했다. 최종 재검증 결과는 아래에 추가한다.

운영 복구: 먼저 `recover:queues`를 실행해 누락 전달을 복원한다. `RECONCILIATION_REQUIRED` 및 HELD는 Provider 사용/게시 결과를 확인한 후 기존 대사 절차로 처리한다. legacy PUBLISHING에 시도가 없으면 결과 확정 전 예약 상태로 되돌리지 않는다. 실 Provider 중단·외부 게시 확정은 자격 증명 없이 검증하지 않았다.

최종 1단계 검증: 강제 종료/경쟁/이전 token 완료 차단 2건, 기존 worker 게시·재전달 7건, 정책 1건, API 게시 6건 통과(총 16건). worker/API/database lint·typecheck 성공. 빈 DB migration 및 데이터가 있는 복제 DB의 추가 migration 적용과 작업 상태 보존 확인. 실제 강제 종료는 tsx worker 프로세스를 SIGKILL한 후 heartbeat 시각을 테스트에서 앞당겨 검증했다.

## 2단계: 지표 수집·게시 버전

- 확인: API 응답만으로 SUCCEEDED 처리했고 snapshot이 하나라도 있으면 해당 post 전체를 건너뛰어 부분 누락을 다시 수집하지 않았다. observedAt에도 요청 periodEnd를 넣었고 누적값을 요청 기간 값으로 표시했다.
- 수정: COLLECTING 원자 claim, WAITING/PARTIAL/SUCCEEDED/UNAVAILABLE/EXPIRED 구분. 다음 수집은 Provider delay와 지수 backoff 중 큰 값(최대 backoff 24시간), 최대 6회다. 최신 metric revision으로 완료 여부를 판단하며 이전 결과는 보존한다. 페이지 단위 DB 트랜잭션으로 실제 501개 batch 회귀의 성능을 유지한다. 빈 page와 NOT_RETURNED는 일시적, NOT_PROVIDED/별도 보고서/분모 0은 영구 또는 정의 불가로 구분한다.
- 자동 스케줄러는 게시 후 수집뿐 아니라 수동 sync의 지연·부분 실패도 재수집한다. production job은 수집 시도별 새 키를 사용하고 게시 작업을 변경하지 않는다. worker 유실 시 COLLECTING도 복구한다.
- migration `202611170002_analytics_observations`: collectionAttempts/nextAttemptAt와 관측 종류, 실제 collectedAt, 표현 기간, 게시 scene/script ID를 추가한다. 이전 snapshot은 LEGACY_UNKNOWN이며 기간/버전을 추정 backfill하지 않는다. 이전 row의 collectedAt 기본값은 migration 시각이므로 정확한 과거 수집 시각으로 사용하면 안 된다. 원본 지표·revision은 유지한다. 컬럼 삭제 rollback은 신규 관측 메타데이터를 잃는다.
- 실제 Provider: YouTube는 Pacific calendar 기간 보고서이며 날짜 양 끝을 포함하는 요청을 UTC 경계(종료 exclusive)로 변환한다. 집계 가능성을 고려해 보수적 72시간을 사용한다. Instagram/TikTok은 현재 누적 스냅샷으로 표시하고 요청한 과거 24시간 값이라고 하지 않는다. actualAgeSeconds를 원본 메타데이터에 별도 보존한다. 관측 정의/기간이 없는 legacy는 비교 근거에서 제외할 대상이다.
- 기존 SUCCEEDED 재검사: 기존 analytics sync 요청에 `recheck: true`를 명시한다. 해당 workspace 권한 검증 후 같은 sync에 한 번의 durable recheck를 만들고 원본을 보존하며 새 revision을 저장한다. 추가적인 새 관측 요청은 새 idempotencyKey를 사용한다. 같은 복구 요청의 반복은 중복 수집을 만들지 않는다.
- API 보고서는 실제 관측 기간과 collectedAt, 관측 종류, 게시 버전 ID를 반환한다. UI는 누적값과 기간 미확인을 구분한다.
- 공식 문서 확인일 2026-11-17: [YouTube dimensions](https://developers.google.com/youtube/analytics/dimensions), [YouTube reports.query](https://developers.google.com/youtube/analytics/reference/reports/query), [TikTok Query Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query). Meta 공식 media insights 문서는 접근 실패했으며 누적 지표의 실제 권한/응답과 변경 정책은 실 계정으로 별도 확인해야 한다. 실 요청은 하지 않았다.
- 검증: worker 수집 5건(501개 부분 실패 포함), 복구 2건, API 수집/동시 recheck 1건, Provider 3건, web 10건 통과. 변경 worker/API/web/providers/contracts/database lint·typecheck 성공. 기존 데이터 DB migration 적용 성공. 최초 501개 테스트는 개별 트랜잭션으로 제한시간을 초과하여 batch 저장으로 수정 후 통과했다. Redis 미지정으로 발생한 재검증 연결 실패도 격리 URL을 명시한 후 통과했다.

## 3단계: 주장별 근거·생성 비용

- 확인: 정책과 소유자 검수의 두 경로 모두 sourceUrl의 존재만으로 factsHaveSources를 설정했다. 새 검증은 공통 policy-engine을 사용한다.
- 자동 통과 조건: 수집 범위 FULL_TEXT, 실제 수집 문자열에서 찾은 근거, 주장·숫자·단위·날짜 일치, 대본의 새 진술까지 근거 연결, 출처 충돌 없음. 지원 근거/정규화 위치/수집 범위/대본 fingerprint/검토 사유를 policy 결과와 ScriptVersion에 보존한다. 대소문자가 다른 SI 단위(mW/MW)를 합치지 않는다. URL만 일치, RSS SUMMARY, 원문 미수집, 추론·가정, 수치 충돌은 검토 대상이다. 이는 원문 충실성 검사이며 독립적인 현실 사실 확인이나 인과 검증이 아니다. 별도의 LLM 검증 호출과 추가 비용은 도입하지 않았다.
- 수동 확인: 기존 소유자 대본 편집·출처 확인은 유지하며 현재 hook/body/CTA의 fingerprint에만 유효하다. 새 문장을 추가하면 기존 확인을 재사용하지 않는다. 이전 legacy 확인에는 fingerprint가 없으므로 재확인이 필요하다. RSS Provider는 원문을 내려받았다고 가장하지 않고 SUMMARY를 기록한다. 정상 원문 fixture는 실제 일치하는 본문과 FULL_TEXT를 명시한다.
- 비용: `LLM_MAX_OUTPUT_TOKENS` 기본 4096(256~32768), Responses 요청에 max_output_tokens를 전달한다. 실제 입력 UTF-8 바이트와 실제 출력 JSON schema·여유분으로 보수적 토큰 예약을 계산하고 최대 스키마 재생성 횟수를 포함한다. 매 유료 호출 journal STARTED 전에 같은 플랫폼의 미해제·미정산 예약 잔액과 이전 실제 토큰 기반 추정 비용을 확인한다. 다른 job의 미확정 STARTED가 있으면 호출하지 않는다. 복구된 응답은 비용을 중복 기록하지 않는다.
- 비용 의미: 입력 바이트 기반 값은 사전 예약 추정, API usage×설정 단가는 사용량 기반 추정, actualCost는 별도 대사된 금액이다. 절대 외부 청구 상한을 보장하지 않는다. 성공/실패에도 사용량 기반 추정만 있고 청구 대사가 없거나 외부 결과가 불명확하면 예약을 유지한다. 운영자는 기존 usage/ledger 대사 절차에서 실제 비용을 확인해야 한다. 단순 실패를 환불로 간주하지 않는다.
- DB 구조 추가 없음: 기존 JSON snapshot의 증거 메타데이터를 확장했다. 이전 원문/확인을 추정 backfill하지 않는다. 롤백하면 기존 코드의 약한 URL 판정이 다시 가능하므로 자동 운영을 재개하기 전에 주의가 필요하다.
- 공식 [Responses API max_output_tokens](https://developers.openai.com/api/reference/resources/responses/methods/create) 확인일 2026-11-17. OpenAI Docs 스킬 사용. 네트워크는 Mock이며 실제 유료 호출 없음.
- 검증: 관련 worker 17건, API 15건(동시 예산 예약 포함), policy-engine 9건, OpenAI Mock 5건, config 10건 통과. 긴 원문/최대 출력 예약, 스키마 오류 뒤 예약 축소 시 재호출 차단, 발생 비용 보존, 오래된 수동 확인 무효화를 포함한다. 변경 app/package lint·typecheck 성공. 기존 media fixture의 비정상 reservation key/누락 플랫폼은 실제 운영 계약에 맞게 수정하고 기존 불명확 호출 차단 테스트를 재검증했다.
