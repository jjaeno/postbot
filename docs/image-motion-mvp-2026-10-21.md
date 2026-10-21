# 이미지 모션 MVP 운영 결함 보완

검증 기준일: 2026-10-21 (Asia/Seoul). 시작 HEAD `d90be9d5d42b216a69dd556c084c4700a4ca99de`; 원격 작업 브랜치도 같은 HEAD다. `origin/main`은 분석 기준인 `52407a7`에 남아 있어 이전 코드로 되돌리지 않았다.

이 문서는 이번 사용자 요청에 따른 19.8단계의 상태 전이·API·운영 변경과 검증 근거다. 이전 완료 보고가 이번 결함까지 해결했다는 의미는 아니다. 최종 검증 결과는 아래에 기록한다.

## 재검증과 수정

| 문제 | 최신 코드에서 확인한 원인과 조치 | 회귀 근거 |
| --- | --- | --- |
| 권리 승인/스톡 보충 뒤 재개 | retained completed/failed ID에 add만 호출했다. terminal 상태는 BullMQ의 원자적 retry로 이동한다. 대기·지연·실행 중인 작업을 제거하지 않는다. DB 복구는 조건부 갱신하며 결과·예약 시각을 보존한다. | 실제 Redis `mvp-recovery-integration.mjs`: 이미지/TTS/스톡/실패/동시 복구/재전달 |
| 성공·불명확 호출 재실행 | 성공 작업 재전달 차단, 실제 LLM/media 호출 journal, 자산 재사용은 이미 있었다. DB RUNNING claim도 중복 획득하지 않게 보완하고 reconciliation 작업의 일반 복구를 차단했다. | 기존 job-redelivery, real-media/LLM journal, 신규 실제 Redis 회귀 |
| 보류 예약 | HELD가 재예약을 막지만 취소는 SCHEDULED만 허용했다. 외부 시도가 없는 HELD와 확정 실패만 취소한다. 외부 시도가 RUNNING/RETRY_WAIT/SUCCEEDED이면 취소하지 않는다. 새 예약은 새 idempotency key와 최신 승인·정책·메타데이터를 사용한다. | 최신 제목 1회 게시, 취소된 지연 작업 무효화, 플랫폼별 기존 license-resume/slot 회귀, 브라우저 HELD 복구 |
| 게시 직전 변경 경쟁 | 기존 최신 버전 gate에 제목·설명·태그 비교 및 채널 잠금 안의 재확인을 추가했다. 게시 claim 후 메타데이터·대본·권리 수정은 거절한다. 다른 플랫폼 이력은 유지한다. | publish processor, metadata/title 회귀 |
| 자동 소재 | 첫 후보와 상태 무관 기존 소재 반환을 제거했다. 전체 후보를 공통 필터·URL 정규화·입력 기반 점수로 저장하고 채널 잠금에서 미사용 소재를 예약한다. USED/REJECTED/EXPIRED와 다른 run이 예약한 소재를 제외한다. 명시적 소재 재생성은 별도 사용자 요청이다. | USED 1순위 제외·동시 선정·모두 소진 회귀 |
| 작업 권한 | 일반 작업 생성/복구로 내부 지시·유료 단계·게시 gate를 우회할 수 있었다. HTTP generic 생성/복구는 403이며 도메인 workflow를 사용한다. 내부 생성과 worker는 채널·콘텐츠·장면·소재·run·게시 계정/계획·analytics sync/post 관계를 확인한다. worker는 큐 payload 대신 DB payload를 사용한다. | HTTP 음성 테스트, 실제 DB scope 음성 테스트, workspace auth 기존 회귀 |
| 음성·장면 | 생성된 독립 narration을 실제 전체 대본과 맞췄다. 렌더 전에 ffprobe 실제 음성 길이와 TTS 정렬 정보로 장면을 다시 배치한다. 겹친 자막·텍스트 불일치·중복 장면 ID·장면 빈 구간은 차단한다. | 짧은/긴 한국어 타이밍 단위 회귀, 실제 로컬 미디어·FFmpeg·Chromium |
| 검수·권리 | 실제 이미지/TTS를 PENDING으로 저장하는 동작과 소유자 증빙 감사 기록은 이미 있었다. 자산별 권리 확인 방식을 유지한다. 공통 계정/모델 권리 정책은 범위·철회·만료 관리가 없으므로 추가하지 않았다. 원문/발췌문을 보존하고 생성에 전달한다. 새 대본의 facts를 우선하며 이전 출처 목록으로 덮지 않는다. | license-resume, source-confirmed script edit, LLM/media 회귀 |
| 영상별 분석 | 식별자·제목·조회 기간·관측 시각·latest 표시를 추가했다. 평균 시청 비율과 완주율, reach와 impressions를 분리한다. v1의 잘못된 매핑은 raw 응답을 남기고 미제공으로 격리한다. 다른 조회 기간은 같은 관측 시각이어도 별도 snapshot이다. | provider mapping, report/experiment, batch recovery/동일 시각 다른 기간 회귀 |
| 정기 수집 | manual/automatic 모든 PlatformPost에서 24/72/168시간의 durable sync/job을 재구성한다. 재시작·handoff 실패 시 같은 키로 복구한다. YouTube 500개, TikTok 20개, Instagram 1개씩 처리하고 실패한 게시물만 재수집한다. 게시 성공 상태를 분석 실패로 바꾸지 않는다. | 실제 DB 501개 부분 실패/재시도, 전체 Fake 여정 |
| 운영 설정 | 성공 시 연속 실패 수를 초기화한다. notify_only는 다른 채널·workspace Provider switch를 끄지 않는다. pause_channel은 해당 채널/실행에만 적용한다. 수동 pause는 권리 승인·스톡 등록으로 해제하지 않는다. 슬롯 maxPosts는 시작 시각부터 1분 간격으로 확장하고 일일 상한도 적용한다. 자동 정책 재생성은 미지원으로 명시하고 새 저장 요청에서 거절한다. | failure-policy, schedule-time, 예산 격리/동시성, 기존 pause/kill 회귀 |

점수는 소재 정렬용 휴리스틱이다. 조회수 예측 정확도나 사실 검증 확률이 아니다. 신선도는 자료 발행일 기준이며 역사 사건의 발생일은 별도 `eventAt`로 보존한다.

## 복구 및 운영 계약

- 외부 `POST /jobs`, `POST /jobs/:id/recover`, 예산 없는 이전 `/generation/script-scene` 경로는 `DOMAIN_WORKFLOW_REQUIRED` 403. `/automation/runs`에 ideaId를 전달하는 제작 흐름과 권리 확인·게시·분석 API/UI를 사용한다. 실제 유료 SCRIPT/ASSET/TTS worker는 실행 직전에도 자동화 비용 예약을 요구한다. 조회·취소·SSE는 workspace 경계를 유지한다. SSE는 헤더 전송 전에 소유권을 검사한다.
- DB SUCCEEDED는 실행하지 않는다. QUEUED/RETRY_WAIT만 전달을 복구한다. 재시도 대상의 Redis completed/failed는 원자적 retry, waiting/delayed/paused/active는 유지, 누락은 기존 runAfter로 add한다. 예약 시각이 미래이면 worker가 DB 시각을 읽어 다시 지연한다.
- `pnpm recover:queues`는 stale RUNNING을 검사할 때 실제 Redis active를 먼저 제외한다. STARTED 유료 journal 또는 PUBLISHING/HELD 게시가 남으면 NEEDS_REVIEW/RECONCILIATION_REQUIRED로 보류한다. 성공 result와 예약 시각을 지우지 않는다.
- `reconciliationRequired` 또는 `*_RECONCILIATION_REQUIRED`는 일반 재시도 대상이 아니다. 운영자는 Provider 요청/작업 ID와 실제 청구·외부 게시물을 대조하고 증거를 보존해야 한다. 알려진 외부 게시 ID는 publish attempt responseSnapshot에 보존된다. 호출 결과를 확인하지 못하면 보류를 유지한다. journal 삭제, 임의 새 job/key 생성, 단순 취소로 우회하지 않는다. 이번 범위는 외부 대사/복구를 자동 판정하는 UI나 Provider별 결과 가져오기 도구를 추가하지 않으며, 불명확 호출의 정상화는 운영 대사 후 별도 복구 작업이 필요하다.
- 일반 HELD 예약은 캘린더의 예약 변경으로 취소한 뒤 최신 플랫폼 결과를 재검사·재승인하고 새 시각으로 예약한다. 결과 불명확 HELD는 같은 취소 API에서도 차단하며 calendar의 reconciliationRequired로 구분한다. PUBLISHING/PUBLISHED는 단순 취소하지 않는다.
- 채널 중지는 신규 자동 제작을 멈춘다. 기존 예약 취소는 캘린더에서 별도로 수행한다. 실행 pause는 이후 단계 전달을 멈추며 이미 진행 중인 외부 호출을 소급 취소하지 않는다. 제작 kill도 이미 발생한 비용과 결과를 삭제하지 않는다.
- 정책 실패의 자동 유료 재생성은 지원하지 않는다. `onPolicyFailure=regenerate` 새 설정은 거절하며 기존 설정도 실제 실행에서는 보류 gate를 유지한다. 수정·명시적 재생성에는 기존 예산과 권리·승인 검사가 적용된다.
- `ANALYTICS_COLLECTION_HOURS=24,72,168`을 변경할 수 있다. API 자동화 scheduler가 실행되어야 한다. 중복 key로 수집을 재생성하지 않으며 자동 실패 복구는 전체 시도 수 3회 이내다. 소진 후에는 분석 workflow에서 새 수집 요청을 만든다. 도착하지 않은 Provider 데이터는 0으로 대체하지 않고 미제공 상태를 유지하며 이후 수집 시점에 다시 관측한다.
- 대본과 정렬 텍스트가 다르거나 음성이 최대 길이를 넘으면 문장을 자르지 않고 오류로 멈춘다. 대본을 줄인 뒤 명시적으로 음성을 재생성한다. 최소 영상 길이를 채우기 위한 마지막 장면 유지는 가능하다. 자막 스타일만 변경하면 기존 음성을 재사용한다.

## DB 변경

1. `20261021000000_quarantine_ambiguous_analytics`: YouTube v1 completion_rate와 Instagram v1 impressions를 `UNAVAILABLE/LEGACY_MAPPING_REQUIRES_RESYNC`로 격리한다. 원본 rawSnapshot과 게시 이력은 보존한다.
2. `20261021001000_scope_analytics_snapshot_to_sync`: snapshot 고유 키에 sync를 포함해 다른 조회 기간을 분리한다. 기존 post FK index도 유지한다.

새 제안/실험에는 analytics-mapping-v2를 기록하고 격리된 snapshot은 비교에서 제외한다. 과거 v1의 혼동 지표로 만든 제안은 새 수집/제안 없이 적용할 수 없다. 이미 적용된 과거 전략은 자동으로 되돌리지 않으며 소유자가 근거와 전략 이력에서 재검토해야 한다.

## 검증 실행 방법과 환경

Windows PowerShell, pnpm 10.34.5, 호스트 Node 20.19.4 및 격리 Linux Node 24.21.0. 전용 MySQL 8.4/Redis 7.4/MinIO 컨테이너와 `_test` DB만 사용한다. 실제 키·SNS·유료 API·push·merge·배포는 사용하지 않는다. 로컬 음성 fixture는 한국어 텍스트별 타이밍을 갖는 Fake TTS의 WAV tone이며 실제 한국어 음질/발음 검증을 대신하지 않는다.

- `pnpm lint`, `pnpm typecheck`, `pnpm build`
- `_test` DATABASE_URL 지정 후 `pnpm test`; 데이터 모델 suite는 해당 전용 DB를 비우므로 운영 DB에서 실행하지 않는다.
- `RUN_DB_INTEGRATION=1`과 테스트 MySQL/Redis/MinIO 설정으로 API/worker 관련 Vitest. 자원 경합을 피하려면 `--maxWorkers=2`를 사용한다.
- 실제 Redis/DB: `node --test scripts/mvp-recovery-integration.mjs`
- 브라우저: `pnpm --filter @postbot/web exec playwright test`
- FFmpeg/Chromium과 현재 빌드가 있는 격리 worker 컨테이너에서 `scripts/mvp-media-smoke.mjs`, `scripts/mvp-journey.mjs` 실행. journey의 주석에 배치 경로가 있다. 실제 자격 증명이 아닌 명시적 Fake provider 설정을 검사한다.

## 외부 검증과 제한

확인일 2026-10-21. [YouTube 지표](https://developers.google.com/youtube/analytics/metrics), [보고서 권한·필터](https://developers.google.com/youtube/analytics/reference/reports/query), [TikTok query 제한](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query)만 공식 자료로 확인했다. Instagram 공식 insights 페이지는 도구에서 접근되지 않아 기존 요청 필드·단위를 새로 검증했다고 주장하지 않는다. 반환된 reach를 impressions로 잘못 표시하는 매핑만 제거했다.

운영자는 실제 LLM/Image/TTS 단가와 계정별 상업·변형·음성 동의 증거, OAuth client/redirect/scopes, 암호화 키, S3, MySQL/Redis, 유효 플랫폼 정책을 준비해야 한다. YouTube 업로드/Analytics 권한과 실제 데이터 지연·쿼터, Instagram 권한/지표 단위, TTS 실제 한국어 정렬과 긴 발화, 유료 이미지 품질/역사 고증, 외부 timeout 대사, 플랫폼 심사는 실제 계정으로 별도 검증해야 한다. TikTok Direct Post 차단은 유지한다.

## 최종 결과

**판정: 내부 필수 검증 통과. 실제 계정의 무인 운영 승인은 유보한다.** 실제 유료 호출·외부 게시·심사와 불명확 결과의 운영 대사는 검증하지 않았다. 일반 권리/스톡/예약 보류는 UI와 기존 자산으로 복구할 수 있으며, 결과 불명확 작업은 중복 과금·게시를 막기 위해 확인 전까지 보류한다. 대사 후 결과 가져오기를 자동 처리하는 기능은 제공하지 않는다.

| 최종 검증 | 통과 | 미해결 실패 | 생략/구분 |
| --- | ---: | ---: | --- |
| 전체 lint / typecheck / build | 27 / 27 / 15 tasks | 0 | 최종 fixture 변경 후 worker lint/typecheck도 별도 통과 |
| `pnpm test` 기본 실행 | 170 cases | 0 | 통합 플래그가 꺼진 77 cases는 아래 통합 실행과 구분 |
| API 전체 + 실제 MySQL/HTTP 음성 경계 | 111 cases | 0 | 별도 서버가 필요한 release HTTP 3 cases는 기본 suite에서 생략 |
| worker 전체 + MySQL | 37 cases | 0 | 최초 36 통과/1 실패 뒤, 비용 예약을 명시한 fixture로 real-LLM 3 cases를 재실행해 모두 통과. 같은 최종 런타임에서 미해결 실패 없음 |
| jobs / asset-library 실제 Redis·DB | 6 / 6 cases | 0 | 0 |
| providers (실제 MinIO 포함) | 23 cases | 0 | 0 |
| 실제 Redis·DB 복구 및 migration 내용 회귀 | 7 cases | 0 | 0 |
| Chromium 브라우저 | 23 cases | 0 | 0. API mock 기반 UI 조작이며 실제 HTTP 여정과 별도 |
| 짧은/긴 한국어 타이밍 로컬 미디어 | 2 렌더 | 0 | 2.7초/8.1초 WAV와 MP4 일치, 1080×1920, 오디오 있음, meanVolume -21.3dB, blackFrameRatio 0 |
| 직접 서비스/processor Fake 전체 여정 | 1 여정 | 0 | 실제 S3·MySQL·Chromium·FFmpeg 사용. 8.4초 영상, 권리 2건, 최신 제목, 게시 1회, 정기 sync 3건 |
| 별도 API/worker의 실제 HTTP 전체 여정 | 1 여정 | 0 | 166초. 나머지 기존 3플랫폼 APPROVAL/FULL_AUTO HTTP 2 cases는 이번 실행에서 선택하지 않음. 단위/DB·브라우저의 승인형/자동형·플랫폼 격리 회귀와 구분 |
| migration | 빈 DB 15개 및 기존 DB 후속 2개 | 0 | legacy 값 격리와 raw 증거 보존도 회귀로 확인 |

행 사이 중복 실행이 있으므로 통과 건수를 합산하지 않는다. 처음 발생한 환경/검증 실패도 성공으로 숨기지 않는다: Docker 엔진 비가동, MinIO 미기동, 검증 병렬 실행의 5초 timeout, HTTP 서버 readiness 경합, 구 버전 generic job API와 비용 예약 없는 journal fixture가 실패했다. 전용 서비스를 준비하고, API 여정은 도메인 workflow로 수정했으며, journal fixture에는 비용 예약을 명시해 관련 검증만 재실행했다. 로컬 렌더 초기 Chromium target-closed는 프레임 동시성을 제한한 뒤 두 길이 모두 정상 종료했다.

최종 명령 결과는 작업 폴더의 `.codex-mvp-*.log`에 남긴다(로그는 Git 제외). 재현 시 운영 환경의 `.env`를 사용하지 말고 위 전용 `_test` DB·Redis·S3와 명시적 Fake provider를 지정한다. 검증용 runtime 이미지는 기존 의존성 이미지에 현재 빌드 산출물을 복사하여 사용했으며 새 production 이미지 빌드·배포 성공을 주장하지 않는다.

변경 파일은 다음 범위다.

- API: `jobs` controller/service/Prisma repository 및 HTTP 음성 테스트, `generation`의 이전 직접 실행 경로, `automation` 선정/재개/예산 추정/실패·슬롯 처리, `ideas` 공통 점수·원문, `review` 버전·권리·pause, `publishing` 보류 취소/목록, `analytics` 보고서·정기 예약, `optimization` 지표/소유권 및 관련 회귀.
- worker: `job-processor`, `worker.module`, `recover-queues`, `collect/script-generation/asset-preparation/render/policy/publish/analytics` 관련 구현과 회귀. 자산 준비 processor 자체의 기존 자산 재사용은 보존하며 asset-library에 실제 음성 길이·텍스트 snapshot을 추가했다.
- 공통: `packages/jobs`, `database`의 scope 검사·schema·위 두 migration, `providers` 공통 소재 점수·native analytics, `contracts` 보고서/캘린더 계약, `scene-schema` 타이밍/장면 검사, `config`와 `.env.example`/`turbo.json`의 정기 수집 환경 변수.
- renderer의 음성 probe/프레임 동시성, web의 이번 요청과 관련된 검수·보류 예약·분석·운영 옵션 및 브라우저 회귀, `scripts/mvp-*.mjs` 검증 도구와 관련 운영 문서. 기존 사용자의 workspace shell·스타일·이동 메뉴 변경은 유지하고 이번 커밋에서 제외한다.
