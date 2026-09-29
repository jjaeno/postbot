# Postbot 자동 운영 시스템

15단계 자동화는 API 요청에서 장시간 작업을 수행하지 않는다. 운영자가 `POST /automation/runs`로 실행을 만들면 MySQL에 `AutomationRun`과 단계별 `AutomationStep`을 먼저 기록하고, 첫 BullMQ 작업만 생성한다. 모든 API는 workspace 소유 채널로 범위를 제한한다.

실제 흐름은 `COLLECT → SCRIPT → ASSET → TTS → RENDER → POLICY → PUBLISH`이다. 각 processor output을 `AutomationStep.output`에 저장하고 다음 단계가 content idea, content item, scene version, asset, render manifest, immutable policy snapshot을 다시 조회·검증한다. PUBLISH 준비 단계는 연결 계정과 다음 예약 슬롯을 결정하고 `PublishPlan`을 만든 뒤에만 `publishPlanId`를 worker에 전달한다. 성공한 게시 후 동일 실행 idempotency key로 analytics sync를 enqueue한다.

## 상태와 복구

실행 상태는 `QUEUED → RUNNING → SUCCEEDED|FAILED|CANCELLED`이며, 운영 중에는 `PAUSED`와 `DRAINING`을 사용할 수 있다. 각 단계는 `PENDING`, `QUEUED`, `RUNNING`, `SUCCEEDED`, `HELD`, `FAILED`, `CANCELLED`, `SKIPPED` 중 하나다. Worker는 시작, 성공, 실패마다 단계의 시도 횟수·오류·heartbeat를 MySQL에 저장하므로 Redis 재연결이나 worker 재시작 뒤에도 DB 기록으로 실패 단계를 `retry`할 수 있다.

동일 실행 요청은 `AutomationRun.idempotencyKey`로, 동일 단계는 `(automationRunId, stage)`로 중복을 막는다. 기존 ProductionJob과 PublishPlan의 멱등성 제약은 그대로 적용한다. 외부 게시 상태가 불명확한 경우에는 PublishProcessor의 기존 상태 확인을 거치기 전 재업로드하지 않는다.

## 재고와 게시 gate

재고는 `GENERATING`, `REVIEW_REQUIRED`, `APPROVED`, `SCHEDULED` 콘텐츠를 한 번씩만 합산하여 `minInventoryCount`와 비교한다. 부족분이 없으면 실행은 즉시 성공한다. 완전 자동 채널은 연결된 플랫폼 계정과 활성 게시 규칙이 없으면 새 생성 작업을 시작하지 않고 `PAUSED` 실행과 `NO_CONNECTED_ACCOUNT_OR_SCHEDULE` 사유를 남긴다.

정책·권리·사실 검증은 review/publishing gate를 우회하지 않는다. 특히 사실-출처 연결, 신뢰도/충돌, verified commercial license, originality, 민감 주제, 플랫폼/AI disclosure 검사와 렌더 결과가 모두 통과하지 않으면 게시 계획을 만들 수 없다. `APPROVAL`은 사용자 승인 전 PUBLISH를 `AWAITING_APPROVAL`로 보류하고, `FULL_AUTO`도 forced-review finding이 있으면 자동 승인하지 않는다.

## 운영 제어

`POST /automation/runs/:runId/control`은 다음 제어를 제공하며 모두 `AutomationEvent`에 기록한다.

* `pause`: 새 단계를 만들지 않는 graceful pause이다. 이미 실행 중인 job은 완료될 수 있다.
* `drain`: 새 단계를 만들지 않고 대기 단계는 보존한다. 실행 중 job의 결과를 저장한 후 운영자가 재개 또는 취소한다.
* `kill`: 아직 시작되지 않은 단계를 취소하고, 정산되지 않은 비용 예약을 해제한다. 진행 중 job은 기존 취소 요청 절차로 별도 취소한다.
* `resume`: pause/drain 상태에서 다음 재개 가능한 단계를 queue에 넣는다.
* `retry`, `hold`, `skip`: 실패/보류 단계를 명시적으로 복구하거나 보류·건너뛴다.

`POST /automation/switches`는 workspace 전체(`provider: null`) 또는 provider별 switch를 설정한다. worker는 LLM, image, TTS, renderer, publisher 단계 시작 전 provider switch를 확인하며, 비활성 switch의 작업은 외부 provider를 호출하지 않고 hold한다. 같은 실행의 연속 실패가 3회가 되면 해당 provider switch를 자동 비활성화한다.

## 비용 예약

비용이 드는 단계는 `AutomationCostReservation`에 실행·단계 멱등성 키로 예약하고 완료 시 정산, 실패/kill 시 해제한다. 예산 한도는 `AutomationBudget`에 workspace 또는 채널 단위의 일/월 soft·hard limit으로 저장한다. 한도 또는 원장 정합성을 확인할 수 없는 경우 생성 단계는 hold하며 fail-open하지 않는다. 금액은 모두 `DECIMAL(18,6)`, 시간은 UTC로 저장한다.

`POST /automation/budgets`는 workspace 기본 예산 또는 해당 workspace 소유 채널의 예산을 설정한다. soft limit은 운영자가 확인할 경고 기준이고, hard limit을 넘는 예약은 hold한다. soft limit은 hard limit보다 클 수 없다.

## Fake Provider 검증

`apps/api/src/automation/automation-simulator.spec.ts`는 가상 시간/입력 기반 안전장치를 검증한다. `apps/api/src/release/fake-journey.e2e.spec.ts`는 별도 API/worker/MySQL/Redis/MinIO 프로세스를 사용해 APPROVAL과 FULL_AUTO를 실제 renderer, Fake 외부 provider, PublishPlan/PlatformPost, analytics, optimization까지 연결한다. 실제 SNS 게시 검증은 별도 자격 증명 환경에서 수행한다.
