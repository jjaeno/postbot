# Postbot 작업 시스템

6단계 작업 시스템은 API 요청에서 장시간 작업을 직접 실행하지 않고 `ProductionJob`을 만든 뒤 즉시 job ID를 반환한다. BullMQ와 Redis는 queue 실행에 사용하고, 업무적으로 중요한 상태는 MySQL의 `ProductionJob`과 `JobAttempt`에 저장한다.

## Queue

지원 queue는 다음 8개다.

- `collect`
- `script`
- `asset`
- `tts`
- `render`
- `policy`
- `publish`
- `analytics`

작업 type은 Prisma `ProductionJobType`의 `COLLECT`, `SCRIPT`, `ASSET`, `TTS`, `RENDER`, `POLICY`, `PUBLISH`, `ANALYTICS`와 1:1로 매핑된다.

## API

- `POST /jobs`: 외부 생성은 403. 도메인 workflow API가 내부 JobsService를 호출한다 (19.8 보완).
- `GET /jobs/:jobId`: MySQL에 저장된 현재 작업 상태와 시도 목록을 반환한다.
- `GET /jobs/:jobId/events`: Server-Sent Events로 현재 진행 상태를 반복 전송한다. 재연결 시에도 MySQL 상태에서 최신 이벤트를 재구성한다.
- `POST /jobs/:jobId/cancel`: queue에서 제거 가능한 작업은 제거하고, 영속 상태를 `CANCELLED`로 전이한다.
- `POST /jobs/:jobId/recover`: 외부 직접 복구는 403. 권리·예산·승인 gate를 확인하는 제작 workflow에서 재개한다. 불명확 호출은 일반 복구를 차단한다.

현재 DB/BullMQ 상태별 복구·취소·대사 계약은 [이미지 모션 MVP 운영 보완](image-motion-mvp-2026-10-21.md)을 따른다.

모든 API는 workspace 인증 상태를 사용한다. 작업 생성과 조회는 요청 workspace에 속한 채널의 job에만 허용된다.

## 상태 전이

- 생성: `QUEUED`
- worker 시작: `RUNNING`, 새 `JobAttempt` 생성
- 일시 실패: `RETRY_WAIT`, BullMQ backoff 후 재시도
- 성공: `SUCCEEDED`
- 영구 실패: `FAILED`
- 취소 요청: `CANCEL_REQUESTED`
- 취소 완료: `CANCELLED`
- 수동 복구: `FAILED`/`CANCELLED`/`NEEDS_REVIEW`에서 `QUEUED`

각 attempt는 `JobAttempt.attemptNumber`로 순서를 가진다. 작업 idempotency는 `ProductionJob.idempotencyKey` UNIQUE 제약으로 보장하고, 중복 생성 요청은 기존 job을 반환한다.

자동화 단계의 `productionJobId` 연결은 BullMQ enqueue 전에 DB에 저장한다. 빠른 worker가 먼저 완료해 단계 상태 갱신이 누락되는 경합을 방지하며, enqueue 이후 API가 단계 상태를 다시 `QUEUED`로 덮어쓰지 않는다. 연결 저장에 실패하면 큐 전송도 수행하지 않는다.

스케줄러는 60초 이상 갱신되지 않은 `QUEUED`/`RUNNING` 단계도 재확인한다. 작업 연결 전 중단된 claim은 갱신 시각을 비교해 회수하고, DB에 대기 중인 작업은 같은 job ID로 큐 등록을 복구한다. 이미 끝난 작업은 저장된 결과만 단계에 반영하며 재실행하지 않는다. `NEEDS_REVIEW`는 `HELD`, 실패·취소는 `FAILED`로 반영해 자동 유료 재호출이나 재게시를 막는다. 실제 실행 중인 작업은 그대로 둔다.

## Worker

`apps/worker`는 각 queue마다 BullMQ worker를 생성한다. 현재 단계의 processor는 deterministic behavior만 수행한다. 실제 수집, 대본, 에셋, TTS, 렌더, 정책, 게시, 분석 로직은 후속 단계에서 각 Provider 인터페이스 뒤에 연결한다.

테스트용 payload:

- `{ "deterministicBehavior": "success" }`
- `{ "deterministicBehavior": "retry-then-success", "failAttempts": 1 }`
- `{ "deterministicBehavior": "fail" }`
- `{ "deterministicBehavior": "timeout", "timeoutMs": 1000 }`

## 검증

6단계 필수 검증은 `apps/api/src/jobs/jobs.service.spec.ts`에서 deterministic queue와 in-memory repository로 확인한다.

- 성공
- retry 성공
- 영구 실패
- 중복 요청
- 취소
- worker 재시작 후 수동 복구
- SSE 재연결
- 권한 검사
