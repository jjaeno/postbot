# 실제 서비스 운영 준비 현황 — 19.8

이 문서는 2026-10-13~14의 과거 기록이다. 2026-10-20의 재현·수정·검증과 미완료/외부 대기는 [최신 인수 기록](release-internal-remediation-2026-10-20.md)을 우선한다. 아래 당시 내부 완료 표현을 현재 상태의 판정으로 사용하지 않는다.

확인일: 2026-10-13~14. 토큰 취소 후 2026-10-14 동일 브랜치/변경을 이어서 검증했다. 기준 main/origin/main: `8403359cead5c61504738b50abe2926ef02804bc`. 작업 시작 시 clean tree를 확인했고 `fix/production-readiness`에서 보완했다. 최종 commit은 `git log -1 --format=%H`로 확인한다.

판정: **실제 운영 완료 아님**. 로컬 계약·Fake 성공, 실제 Provider 성공, 운영 배포 성공을 구분한다. 유료 AI 호출·실제 SNS 게시·registry push·운영 배포는 실행하지 않았다. 인프라 구매·계정 로그인·앱 심사도 수행하지 않았다.

## 보완 범위와 근거

| 영역 | 구현 근거/변경 | 상태와 담당 |
| --- | --- | --- |
| 운영 설정 | `packages/config/src/index.ts`, worker `preflight.ts`; 환경/secret/HTTPS/동일 origin/실 Provider/voice/RSS/단가/활성 플랫폼 검사. 원인·해결·담당자만 출력 | 내부 설정 계약 PASS; 실제 운영값 USER |
| Fake 격리 | production startup 거절, 명시적 staging Fake canary, 실제 게시의 Fake/출처 불명 대본·Fake 에셋 거절 | 내부 PASS; staging/production 데이터 분리 USER |
| OpenAI | REST `output[].content[].output_text`, 완료/거절/usage 검사, strict JSON Schema 유지. `_llmAttempts` journal과 호출별 비용 키로 응답 재사용·스키마 실패 사용량 보존. timeout/응답 손실·응답 후 원장 저장 실패는 reconciliation 보류, 원장 실패가 새 유료 시도로 번지지 않음 | Mock HTTP/DB PASS; 실제 키·모델 권한·청구 검증 BLOCKED/USER |
| Google 이미지 | 미디어 journal로 불확실한 호출 검수 보류·재결제 차단, 실제 실패는 fallback으로 성공 처리하지 않음. 모델 ID 유지, IMAGE 출력·지원 비율 설정, base64/MIME 검사, sharp 전체 디코딩·실제 width/height 저장. 1080×1920은 영상 canvas이며 이미지 출력 크기가 아님 | contract PASS; 실제 생성/권리/렌더 연결 BLOCKED/USER |
| ElevenLabs | 미디어 journal·완료 결과 유실 시 유료 재생성 차단. 기본 voice 별칭을 실제 ID로 해석, timestamps/한국어 word alignment, base64/audio signature/timing 검사, 실제 decode smoke 준비 | contract PASS; 실제 음성 decode/voice 권리/품질 BLOCKED/USER |
| 비용 | 실제 Provider 단가 누락은 호출 전 차단. explicit render free와 미확정 0 분리. workspace/channel 한도 동시 적용·workspace 잠금·해제 reservation 재확보·원자적 해제/정산. kill은 미시작 job만 해제하고 실행 중/결과 불명 예약 보존, 취소/worker claim 행 잠금. 렌더 사용량 기록 | DB 회귀 PASS; 실제 계약 단가/예산 USER |
| 사용량/청구 구분 | ADR-013대로 실 사용량×설정 단가는 ESTIMATED. ACTUAL은 청구 근거가 있는 확정액. OpenAI는 호출별 usage와 논리 결과 marker를 분리하여 중복 계산 방지 | 내부 PASS; invoice 대사 USER |
| YouTube | 필수 scope 재확인, HTTP timeout, 미래/private publishAt 계약, 예약 시각의 worker는 publishAt을 재전송하지 않음. 업로드 세션 이후 실패·게시 ID 반환 후 DB 실패는 HELD로 중복 게시 방지; worker 검수 보류·반환 ID 보존 | Mock/DB PASS; OAuth/비공개 upload/status/Analytics BLOCKED/USER |
| Instagram | Instagram Login 기준으로 문서 정정; insights scope 포함. 응답/permissions API로 실제 granted scope 확인, scope 추정 제거. publish 요청 후 오류·성공 뒤 DB 저장 실패는 reconciliation 보류 | contract PASS; Graph 버전·실 권한/refresh/revoke/permalink/insights·심사 BLOCKED/USER |
| TikTok | video.list 추가, username 요청 제거. 실제 Direct Post를 항상 보류. 자동 FILE_UPLOAD/privacy 선택 제거. publish ID/post ID 구분, URL 추측 제거 | 정책상 보류; 개별 동의 UX/제품 적합성 재설계는 재활성화 전 CODEX+USER |
| 자산/권리 | `(dedupScope, checksumSha256)` migration으로 채널별 독립 소유/증빙. 이미지/TTS 승인 후 재사용·TTS 권리 보류/재개. 최신 라이선스 순서·만료·변형·소유권 검사 | DB/권리 재개 PASS; 실제 증빙 확인 USER |
| 배포 | digest 기반 Compose, optional MySQL/Redis/MinIO volume, Caddy HTTPS, secret manager의 임시 env_file 계약, migration 전 기존 앱 drain·실패 시 중단 유지, 큐 분리·20분 drain·로그 회전 | config dry-run PASS; 최종 이미지/전체 여정 아래 검증 표; 서버/DNS/registry USER |
| 상태 검사 | worker/renderer `:3002/ready`의 BullMQ 실행/Redis 검사. 긴 렌더에서도 작업 완료 주기와 분리. pending probe 공유로 연결 장애 중 요청 누적 억제 | unit/Redis lifecycle PASS; 운영 모니터/경보 전달 BLOCKED/USER |

## 검증 기록

아래는 현재 변경에 대한 직접 증거다. `.artifacts/readiness-20261013`의 로그와 Git diff를 근거로 한다. 호스트 검증은 Node 20.19.4, production 이미지 검증은 Node 24/Ubuntu이며 서로 구분한다.

| 명령/검증 | 결과 | 상태 |
| --- | --- | --- |
| 변경 config/providers/publishers/jobs/asset-library/database/api/worker의 turbo build/lint/typecheck | 모두 통과; backend/DB `checks-final.log`, worker/자산 `resume-checks.log` 17 tasks, API/worker `resume-final-backend-checks.log` 18 tasks, 마지막 worker `verified-worker-final-fault-checks.log` 15 tasks 통과 | PASS |
| API unit + 격리 DB integration | 99 PASS (`resume-api-99.log`); release HTTP 3개는 별도 환경으로 실행 | PASS |
| Worker unit + 격리 DB/Redis integration | 최종 이미지에서 전체 33 PASS (`verified-worker-33.log`), LLM 원장/미디어/게시 결과 불명·취소 예산 회귀 포함 | PASS |
| Asset Library / Database | 6 / 8 PASS | PASS |
| Config / Providers / Publishers / Jobs | 10 / 20(S3 포함) / 11 / Redis lifecycle 6 PASS | PASS |
| Playwright | 18 PASS 후 초기 page.goto timeout 1개 단독 재검증 PASS; UI/API mock 기반이며 실제 SNS 증거 아님 | PASS |
| 신규 migration | 기존 테스트 DB 업그레이드 + 빈 격리 DB에 총 13개 적용 | PASS |
| preflight --network | 격리 DB SELECT·Redis PING·S3 임시 object 쓰기/읽기/삭제 | PASS |
| 배포 CLI dry-run | 외부 임시 환경 파일·digest 형식·기본/단일서버 Compose config --quiet; pull/migrate/rollout 없음 | PASS |
| 배포 실패/순서 회귀 | Node 20 및 production build 이미지 Node 24에서 mock Docker 3/3 PASS (`verified-deploy-safety.log`): dry는 config만, migration 전 기존 앱 drain, 실패 시 restart 금지, 성공 시 한 번 migration 후 rollout. 실제 운영 실행 아님 | PASS |
| backup checksum / empty isolated restore | SHA-256 검증, 12-migration 시점 snapshot 빈 DB 복원·핵심 row 확인. 이후 신규 13번째 migration의 빈/기존 DB 적용은 별도 통과 | PASS |
| pnpm audit --prod --audit-level=high | 알려진 취약점 없음 | PASS |
| production image build | API/web 선행 build + 마지막 worker/renderer/build target build 모두 통과 (`final-image-build.log`, `resume-image-*.log`; API 마지막 취소 안전장치 후 `verified-final-image-api.log`; worker/renderer 마지막 게시·원장 안전장치 후 `verified-ready-image-*.log`). Dockerfile 안의 전체 production build도 통과 | PASS |
| Fake HTTP acceptance | 최종 API/worker/renderer 이미지에서 수동·APPROVAL·FULL_AUTO 3/3 PASS, 838.87초 (`verified-final-fake-acceptance.log`); 실제 HTTP/DB/큐/S3/렌더이며 AI/SNS는 Fake | PASS |
| production renderer smoke | 15/60초 모두 실제 1080×1920, 오디오·음량·scene image pixel·black frame 검사 통과 (`resume-renderer-smoke.log`). Pebble 제거 후 최종 runtime에서도 15/60초 모두 재통과 (`verified-hardened-renderer-smoke.log`) | PASS |
| worker default CMD 종료/재시작 | 최종 이미지에서 실제 COLLECT 큐 처리·종료·재시작 2회, readiness 200, SIGTERM drain 후 exit 0 두 번 (`verified-graceful-final.log`). 이전 Redis 중단 503→복구 200과 함께 확인. Pebble 제거 후에도 readiness 200·실제 큐 처리·exit 0 (`verified-hardened-graceful.log`) | PASS |
| 최종 runtime readiness / web 종료 | Compose DB/Redis/MinIO/API/worker/renderer healthy, native exit 0 (`verified-hardened-readiness.log`). web HTTP 200; 실제 PID 1에서 수정 전 SIGTERM exit 137→종료 handler 추가 후 exit 0 (`verified-web-shutdown.log`) | PASS |
| web 종료 수정 검증 | `pnpm --filter @postbot/web lint`, `typecheck`, `test`: server 8 + vitest 2 PASS. web Docker production build PASS (`verified-web-shutdown-image.log`), 마지막 web scan HIGH/CRITICAL·secret 0 (`verified-web-shutdown-scan.json/.log`) | PASS |
| secret / filesystem scan | 제출 소스 Gitleaks no leaks, Trivy pnpm lock HIGH/CRITICAL 0 (`verified-source-secrets.log`, `resume-fs-scan.log`) | PASS |
| 로컬 runtime image scan | 최초 worker HIGH 3건은 미사용 Pebble Go stdlib (`verified-worker-image-scan.log`, exit 1). 바이너리 제거·네 이미지 재빌드 후 API/worker/renderer/web HIGH/CRITICAL 및 secrets 각 0, exit 0 (`verified-hardening-scan-*.json/.log`; web 종료 수정 뒤 `verified-web-shutdown-scan.json/.log` 재검사). Trivy 0.70, memory 1GiB/parallel 1/timeout 5m, ignore/skip/ignore-unfixed 없음 | PASS |
| 실제 AI/SNS/Sentry | 키·권한·앱 심사·유료 호출/게시 승인과 운영 계정 검증 필요. dry smoke만 실행 | BLOCKED |
| 최종 commit 원격 CI/security | 원격 push 미실행. 기준 main의 connector 조회는 workflow 목록이 비어 있고 unauthenticated API 접근도 불가하여 성공 판정 불가 | NOT_RUN |

중간 실패를 숨기지 않는다. ESLint 미사용 변수/테스트 타입 오류·mock 데이터 오류는 수정 후 재검증했다. 추가 이미지 scan은 처음 메모리 부족으로 중단됐고 순차 실행에서 Pebble의 CVE-2026-78667/78669/97031을 발견했다. 사용하지 않는 base service manager를 제거하고 네 이미지 재검사에서 HIGH/CRITICAL 0건을 확인했다. 기본 Docker CMD의 shell이 SIGTERM을 Node에 전달하지 않아 종료 코드 137이 발생했다. `exec node`와 worker의 drain 후 Prisma disconnect로 수정하고 기본 이미지의 실제 큐 처리 후 종료/재시작을 재검증해 exit 0을 두 번 확인했다. 최종 이미지에서도 동일한 큐 처리·종료·재시작 검증을 통과했다. web도 PID 1 SIGTERM에서 exit 137이 재현되어 HTTP server close handler를 추가하고 새 이미지의 HTTP 200·exit 0을 확인했다. Compose 최초 readiness wrapper가 모든 healthy 출력 뒤 exit 1을 반환하여 native exit를 명시적으로 기록하는 재확인에서 healthy·exit 0을 확인했다. 재개 중 테스트 Redis 주소 누락으로 worker 검증이 중단되어 DB/Redis/S3 격리 주소를 모두 지정하고 같은 테스트 제한에서 단일 worker로 29개를 통과했다. 첫 직접 typecheck는 의존 패키지 build 전 오래된 declaration을 읽어 실패하여 의존 순서 turbo build/typecheck로 통과했다. 새 빈 DB migration 전 실행한 게시 fixture는 환경 순서를 바로잡아 재실행했고, mock matcher의 unsafe any를 타입 검사로 제거했다. 배포 mock 검증의 생성 stub newline escape 오류는 수정 후 Node 20/24 모두 3/3 통과했다. 추가 이미지 fixture의 빈 overlay와 취소 fixture의 잘못된 시도 필드/종료 후 재요청 기대는 실제 schema/상태 계약에 맞춰 정정하고 관련 회귀를 통과했다. 초기 API 인증 hook와 Playwright 페이지 load timeout은 병렬 이미지 빌드 중 발생해 같은 timeout 기준 단독 재검증으로 확인했다. 최초 Compose `--wait`에 one-shot storage-init을 포함한 실행은 정상 exit 0도 wait 실패로 표시되어 상시 서비스 readiness와 one-shot 성공을 따로 확인했다. 잘못 지정한 검증 환경의 S3 endpoint는 전용 MinIO 주소로 정정했다. 검사를 skip하거나 보호 장치를 낮추지 않았다.

## 사용자 입력 목록

입력 위치는 secret manager가 렌더링하는 저장소 밖 환경 파일 또는 런타임 환경이다. `.env.example`은 로컬 이름/타입 참고이며 실제 운영값·단가·비밀값을 Git에 넣지 않는다.

| 입력 묶음 | 이름과 조건 |
| --- | --- |
| 운영 모드 | `APP_ENV=staging|production`, `NODE_ENV=production`, `ENABLED_PLATFORMS=youtube`부터 시작, `STAGING_FAKE_CANARY=false` |
| 인증 | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OAUTH_ENCRYPTION_KEY`: 독립적 non-placeholder 32자 이상; `OAUTH_ENCRYPTION_KEY_VERSION`, 필요할 때만 `OAUTH_ENCRYPTION_PREVIOUS_KEYS` |
| 공개 주소 | `WEB_BASE_URL=https://<app>`, `API_BASE_URL=PUBLIC_API_BASE_URL=https://<app>/api`; callback은 해당 base 아래 `/platform-accounts/<platform>/callback` 등록 |
| 인프라 | `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`(공개 HTTPS), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `STORAGE_PROVIDER=s3` |
| 소재 | `TOPIC_SOURCE_PROVIDER=rss`, `TOPIC_SOURCE_FEED_URLS` 실제 HTTPS feeds, `TOPIC_SOURCE_TIMEOUT_MS`, `TOPIC_SOURCE_MAX_RETRIES` |
| 대본 | `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` |
| 이미지 | `IMAGE_PROVIDER=google`, `GOOGLE_API_KEY`, `IMAGE_MODEL`(기본 모델 유지), `IMAGE_TIMEOUT_MS` |
| 음성 | `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `TTS_MODEL`, `TTS_TIMEOUT_MS` |
| 단가 | `LLM_INPUT_USD_PER_MILLION_TOKENS`, `LLM_OUTPUT_USD_PER_MILLION_TOKENS`, `IMAGE_USD_PER_OUTPUT`, `TTS_USD_PER_THOUSAND_CHARACTERS` 양수 계약 단가. `RENDER_COST_MODE=priced`이면 `RENDER_USD_PER_MINUTE` 양수; 의도적 내부 무료이면 `free`를 명시 |
| 예산 | 앱에서 workspace/channel USD 예산·hard limit을 설정. `AUTOMATION_EXPECTED_INPUT_TOKENS`, `AUTOMATION_EXPECTED_OUTPUT_TOKENS`는 추정량이며 invoice 보장이 아님. 사업자 프로젝트의 지출 한도도 설정 |
| YouTube | `YOUTUBE_OAUTH_PROVIDER=google`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_ANALYTICS_PROVIDER=youtube`, 초기 `YOUTUBE_UPLOAD_PRIVACY=private`; 출력 프로필 PUBLIC 설정을 PRIVATE로 변경 후 smoke |
| 선택 Instagram | enable 전 `INSTAGRAM_OAUTH_PROVIDER=meta`, `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_GRAPH_VERSION`, `INSTAGRAM_ANALYTICS_PROVIDER=instagram`; 실제 grant·심사 확인 |
| 운영 제어 | `SOCIAL_PUBLISH_TIMEOUT_MS`, `SOCIAL_PUBLISH_POLL_INTERVAL_MS`, `PROVIDER_HTTP_TIMEOUT_MS`, `WORKER_QUEUES`, `MAINTENANCE_WORKER_ENABLED`, `RENDER_TIMEOUT_MS`, 필요하면 `SENTRY_DSN`, `SENTRY_ENVIRONMENT` |
| 배포 manifest | `POSTBOT_PROJECT`, `POSTBOT_ENV_FILE`, `POSTBOT_DOMAIN`, `POSTBOT_STORAGE_DOMAIN`, `POSTBOT_STORAGE_UPSTREAM`, `POSTBOT_{API,WORKER,RENDERER,WEB,MIGRATE,PROXY}_IMAGE` digest. 단일 서버면 `POSTBOT_{MYSQL,REDIS,MINIO}_IMAGE`와 DB/MinIO admin 초기값 추가 — [runbook](deployment-runbook.md) |

## 로컬 이미지 증거

아래 ID는 registry manifest digest가 아닌 로컬 Docker image ID다. production manifest에는 registry에 push·scan한 실제 digest를 입력해야 한다. 아래는 앱 안전장치를 모두 반영한 Fake 여정의 이미지이며 이후 미사용 Pebble 제거만 추가했다. Fake 여정에서 사용한 ID는 `verified-final-flow-image-ids.log`에 기록했다.

| 역할 | 로컬 image ID (sha256) |
| --- | --- |
| API | `cfb86a9e21ab113b56a0699baca0fbc10b1531c24b08e30949b4e02812b38c6c` |
| Worker | `a207a947ce15cd270aefda1ef15345ba588c0b3beb28d0c42ca712394f5b3404` |
| Renderer | `5c08b4170acc8d56dc81f5e155bdf26ee6e018796890d1173b1d85696db8b86b` |
| Web | `5f60e8981d734a906e5a4eb1003cdcc5e00ecc01f58b6dfd32409a1326e77da6` |

미사용 Pebble 제거 후 최종 이미지도 모두 build/scan을 통과했다 (`verified-hardening-image-*.log`, `verified-hardened-image-ids.log`). API/worker/renderer 코드·Node·FFmpeg·Chromium·라이브러리는 Fake 전체 여정 때와 동일하다. web은 마지막 종료 handler를 추가했으며 브라우저 UI는 동일하다. 변경 runtime의 실제 렌더·readiness·큐 처리·종료를 따로 통과했다.

| 역할 | 최종 로컬 image ID (sha256) |
| --- | --- |
| API | `4cc684d51138bd86aeaa6f6c7ff80c976871c7917c97f12468a27d2973c895c4` |
| Worker | `f777df748909e88fc0e4e9d3efe4da5f8fd7733310dd11e50a83c4cb814c3c70` |
| Renderer | `1e8b2be36738ed1f11a638c9ad784b56d1ee49db1cda2dd8825802ca8202a77a` |
| Web | `b037acd67fd19e5c9d0d0fb3e766dda9a59da710d251814c6975a8327b819344` |

Trivy에서 Ubuntu 26.04 OS 취약점 검사를 수행했으나 EOL metadata 목록에 버전이 없다는 경고가 있었다. 결과는 현재 취약점 DB와 탐지 범위의 증거이며 OS 지원 수명 검증까지 뜻하지 않는다. registry push 전 migrate/build·proxy·선택 인프라 이미지도 운영 digest 기준으로 검사해야 한다.

테스트용 Compose/worker 컨테이너는 검증 후 중단했다. 증거·백업·DB volume은 보존하며 production 데이터는 변경하지 않았다.

## 외부 조건 준비 후 실행 순서

1. 실제 계정·결제 한도·모델/voice 권리·단가·Google OAuth/API scope·YouTube 채널·도메인/서버/registry를 운영자가 준비한다. Instagram은 별도 professional 계정/앱 역할·Advanced Access/심사가 필요하다. TikTok enable은 보류한다.
2. `pnpm --filter @postbot/worker... build` → `pnpm preflight` → `pnpm preflight -- --network`.
3. [소량 smoke 체크리스트](external-verification-checklist.md)에서 `pnpm smoke:provider -- llm`, `pnpm smoke:provider -- image`, `pnpm smoke:provider -- tts`를 먼저 dry 실행한다. 별도 유료 승인 뒤 하나씩 `--execute-paid`를 붙인다. 소량 계약 검증 뒤 DB 저장·권리 승인·실 render까지 검증한다.
4. staging APPROVAL 채널에서 private YouTube 영상 1개의 별도 게시 승인 → OAuth connect → 실제 제작/권리/정책/승인 → 예약 → 실제 upload/status/URL → Analytics 지연/backfill → refresh/revoke를 확인한다.
5. build/scan/push한 digest, DNS/TLS, bucket/CORS, backup/restore 증거를 준비한다. `node scripts/deploy-production.mjs [--local-infra]`는 dry 검증이다. 별도 운영 배포 승인 후 `--apply`로 rollout한다.
6. 실제 HTTPS 브라우저 인증/CSRF/미디어와 worker/renderer readiness, 외부 경보, shutdown/재시작 복구, rollback/forward-fix, 운영 부하·디스크/RPO/RTO를 확인한다. 모든 실제 계약·운영 증거가 있어야 실제 운영 완료로 판정한다.

## 운영 시작 판정과 남은 제약

- **YouTube APPROVAL:** 코드 경로는 준비한다. 위 실제 AI/권리/OAuth/비공개 게시/공개 HTTPS/스토리지/예산/배포 검증이 남아 있어 지금 운영 가능 확정은 아니다.
- **Instagram:** 코드 계약은 보완했다. Meta 로그인 제한으로 최신 문서 전체 확인·실 권한/Graph 응답·앱 심사를 운영자 계정에서 확인해야 하므로 BLOCKED다.
- **TikTok:** 현재 Direct Post/FULL_AUTO는 운영하지 않는다. 공식 요건과 충돌하는 내부 업로드 유틸리티를 우회하지 않는다. 수동 제작·내보내기 뒤 TikTok 앱 게시를 사용한다.
- **FULL_AUTO:** 사용자 권리 확인/민감·강제검수 gate는 남는다. 실제 AI 결과를 자동으로 권리 승인하지 않으며 승인 후 기존 결과를 재사용한다.
- **배포 호환성:** migration 전 기존 앱을 중단하므로 유지보수 시간이 필요하다. scope migration 후 19.8 이전 전역 checksum writer로 rollback하지 않는다. migration 실패 시 중단 상태에서 DB를 확인하고 호환 이미지/forward-fix로 복구한다.
- **기존 데이터:** 과거 전역 checksum 중복 제거로 다른 채널의 asset을 참조한 이력은 migration이 삭제/권리 승계하지 않는다. 배포 전 `assets.channelId`와 `asset_usages.contentItemId`의 채널이 다른 참조를 읽기 전용으로 조사하고 소유자별 독립 에셋/증빙을 재등록해야 한다. 해당 게시를 현재 gate가 차단한다.
- **불확실한 외부 호출:** invoice/Provider 결과를 대조한 뒤 재개한다. OpenAI STARTED journal·미디어 `_mediaCalls` journal이나 SNS HELD attempt를 근거 없이 삭제/재게시하지 않는다. 확인 결과가 제공되면 Codex가 복구·계약 차이를 보완한다. 네트워크 timeout에서 실제 청구 0을 가정하지 않는다.
- **비용:** 사용량 추정 예약은 실제 invoice 상한 보장이 아니다. 각 사업자 결제 제한·실 사용량·invoice 대사를 함께 운영한다.
- **잔여 Codex 작업:** 현재 내부 필수 검증은 통과했다. 외부 검증에서 계약/환경 차이가 드러나면 그 증거에 맞춰 수정한다. TikTok 재활성화는 별도 제품/동의 UX 작업이다.

## 공식 계약 확인 근거

2026-10-13 확인. 모델 ID/단가를 추측해 바꾸지 않았다. 계정별 사용 권한·요금·앱 승인 조건은 운영자 확인 대상이다.

- [Ubuntu Pebble의 service manager 역할](https://ubuntu.com/docs/pebble/tutorial/getting-started/) — Postbot runtime은 사용하지 않음
- [OpenAI REST output와 SDK 편의 필드](https://developers.openai.com/api/docs/guides/text)
- [Google 기본 이미지 모델](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image), [generateContent 이미지 계약](https://ai.google.dev/gemini-api/docs/generate-content/image-generation?hl=en)
- [ElevenLabs timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Meta Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/), [Meta 공식 API collection](https://www.postman.com/meta/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00) — 상세 최신 문서는 로그인 재확인 필요
- [TikTok 공유 가이드](https://developers.tiktok.com/docs/en/content-sharing-guidelines), [video query scope](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query), [user info scope](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info)
