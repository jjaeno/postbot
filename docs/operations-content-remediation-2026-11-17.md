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
