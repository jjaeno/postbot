# Postbot v1 Acceptance Report

검증일: 2026-09-29 (Asia/Seoul)  
검증 코드 SHA: `a45b552046cd3e2fedb2179120d97fe134557f23`  
기준 브랜치: `main` (작업 시작 기준 `98f296db40610a595f78c579b8266780a8d9ae35`)

## 판정

`PASS_WITH_EXTERNAL_VERIFICATION_PENDING`

저장소 내부 구현, Fake Provider 계약, 실제 로컬 MySQL/Redis/MinIO/HTTP/worker/renderer를 연결한 종단간 검증, migration, 복구 rehearsal, production image 및 보안 기준을 통과했다. 치명적·높음 위험과 내부 release blocker는 0개다.

실제 OpenAI, Google Image, ElevenLabs, YouTube, Instagram, TikTok, Sentry는 자격 증명·사업자 계정·앱 심사가 제공되지 않아 실행하지 않았다. image registry, production cluster, secret/KMS, 원격 암호화 backup 저장소와 운영 담당자 역시 배포 환경 계약 대상이다. 이 항목들은 Fake 성공으로 대체하거나 실제 연동 성공으로 선언하지 않는다.

## 검증 환경

- Windows 11, Docker Desktop, Node.js 20.19.4, pnpm 10.34.5
- Docker Compose: MySQL 8.4, Redis 7.4, MinIO, 분리된 API/worker
- production image: Node.js 20.20.2 기반 `postbot-api`, `postbot-worker`, `postbot-renderer`, `postbot-web`, `postbot-migrate`
- Provider: Fake LLM/Image/TTS/OAuth/Publishing/Analytics; 실제 S3 호환 storage와 실제 Remotion/FFmpeg 렌더링

## 정적 검증과 테스트

| 명령 또는 절차 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS — 25/25 tasks |
| `pnpm typecheck` | PASS — 25/25 tasks |
| `pnpm test` | PASS — 25/25 tasks; API 54 passed/3 release tests skipped, DB 5 passed, worker 기본 실행 2 passed/14 환경 통합 tests skipped |
| Provider S3 통합 테스트 | PASS — 13/13 |
| Asset repository DB 통합 테스트 | PASS — 3/3 |
| worker DB 통합 테스트 | PASS — 16/16 |
| `pnpm build` | PASS — 14/14 tasks |
| `pnpm --filter @postbot/web e2e` | PASS — Chromium 5/5 |
| `pnpm baseline:local` | PASS — 실제 HTTP/DB/Redis/MinIO/worker/renderer 3/3 journeys |

기본 test 명령에서 환경 변수로 제외되는 storage/worker 통합 테스트는 별도로 실제 로컬 인프라에 연결해 모두 실행했다. 최종 전체 test 직전 기본 MySQL 컨테이너가 중지되어 한 차례 연결 실패했으며, 인프라를 healthy 상태로 복구한 동일 명령의 재실행은 25/25 tasks로 통과했다.

## 종단간 사용자 여정

`apps/api/src/release/fake-journey.e2e.spec.ts`는 API와 worker를 별도 production runtime image로 실행하고 실제 MySQL, Redis, MinIO, BullMQ, SSE 및 Remotion renderer를 사용한다.

| 여정 | 결과 | 로컬 측정 |
| --- | --- | ---: |
| 가입→로그인→수집→대본/장면→asset→TTS→render→승인→게시→분석 | PASS | 136,137ms |
| APPROVAL 자동화→검수 승인→게시→분석→최적화 | PASS | 141,533ms |
| FULL_AUTO 자동화→정책 gate→게시→분석→최적화 | PASS | 179,715ms |

총 Vitest E2E 실행은 458.12초였다. 최초 성능 probe는 운영용 60회/분 rate limit과 충돌했으며, liveness/readiness를 일반 API rate limit에서 제외해 모니터링과 측정이 429를 유발하지 않도록 수정한 뒤 재실행했다.

## Migration, 데이터 및 복구

| 검증 | 결과 |
| --- | --- |
| 빈 DB `prisma migrate deploy` + seed + status | PASS — 10 migrations, pending 0 |
| 기존 DB forward upgrade + status | PASS — 10 migrations, pending 0 |
| workspace 범위 platform account unique migration | PASS |
| 비동기 retention/workspace/user lifecycle 및 object 삭제 | PASS — DB integration |
| Redis/queue 복구 명령 | PASS — stale reset 0, enqueue 0인 정상 수렴 상태 |
| MySQL backup + SHA-256 verify | PASS — 155,357 bytes, `941f5d65c75bc60fc1e4267ddd12cdadd7fa1e5fdbaa1cb4c264805cc80c020e` |
| 격리 DB restore | PASS — 3,569ms; migrations 10, workspaces 24, channels 24, content items 23 |

검증 backup은 `.backups/postbot-2026-09-29T07-02-16-817Z.sql`에 생성되며 Git에서 제외된다. production에서는 runbook에 따라 암호화 원격 저장소와 KMS, 확정된 RPO/RTO를 사용해야 한다. schema rollback은 파괴적 down migration 대신 이전 image rollback과 DB forward-fix를 기본으로 한다.

## 장애·멱등성·보안 회귀

- Redis 재연결, stale job 복구, worker 재시작과 실패 단계 재개
- Provider timeout/rate limit, storage/renderer 실패, OAuth 만료·refresh
- 예산 초과 fail-closed, 예약 비용 확정/해제
- semantic idempotency key, 동시 요청 race, 중복 비용·asset·게시 방지
- ambiguous publish timeout 이후 상태 조회와 재게시 방지
- workspace 격리, 권한, CSRF, 60회/분 API rate limit, 보안 header/CORS
- correlation 전파, Pino redaction, 비밀정보 로그 비노출

위 항목은 unit/integration/contract/release E2E에서 통과했다. 고신뢰 secret 패턴 로컬 검색은 검출 0건이다.

## Renderer QA

| 입력 | ffprobe/QA 결과 |
| --- | --- |
| 15초 smoke | PASS — 1080×1920, duration 15초, black-frame ratio 0 |
| 60초 smoke | PASS — 1080×1920, duration 60초, black-frame ratio 0 |
| Fake TTS 포함 release E2E | PASS — 재생 가능한 WAV, caption timing, audio stream |

smoke fixture는 의도적으로 무음이어서 `hasAudio=false`이며, 음성 경로는 release E2E에서 별도로 검증했다. corrupt output, duration/해상도/audio/caption safe-area/black-frame 및 임시 파일 정리 검사를 포함한다.

## Production image와 CI/CD

- production Compose 문법 PASS, migration→API→worker/renderer/web 순서와 healthcheck 확인
- 최종 source와 patched production dependency로 5개 image build PASS
- api/worker/renderer/web는 UID/GID 1000(`node`) 실행; migrate service도 Compose에서 `user: node`로 고정
- production web HTTP 200, API `/ready`는 database/redis/storage 모두 `ok`
- worker/renderer image에는 Chrome Headless Shell과 FFmpeg runtime이 포함되어 실행 중 다운로드가 필요하지 않음
- CI는 frozen install, lint, typecheck, unit/integration/contract, build, migration, Playwright, release E2E, renderer smoke, Docker smoke를 분리 실행
- security workflow는 pnpm audit, Gitleaks, Trivy filesystem 및 api/worker/renderer/web image scan을 실행

GitHub-hosted workflow와 registry push/digest 승격은 원격 저장소 push 및 production 배포 계약 후 실행한다. 동일 commit SHA의 image digest를 staging에서 production으로 승격하고, 재빌드는 하지 않는다.

## 의존성 보안

`pnpm audit --prod --audit-level=moderate` 결과는 알려진 취약점 0건이다. 검증 중 2026-09-28 공개된 Multer orphaned upload DoS 권고가 2.3.0에서 발견되어 override를 patched 2.4.0으로 올린 후 frozen install, 전체 test, audit와 production image build를 재실행했다. 로컬 환경에는 Gitleaks/Trivy CLI가 없어 해당 두 scanner의 실제 실행은 GitHub security workflow에서 수행한다.

## 로컬 성능 기준선

`.artifacts/local-performance-baseline.json`은 Git에서 제외되며 production SLO가 아닌 단일 Docker Desktop 기준선이다.

| 항목 | 결과 |
| --- | ---: |
| `GET /health` 요청/동시성 | 100 / 10 |
| 처리량 | 209.54 req/s |
| latency p50 / p95 / max | 15.64 / 61.03 / 190.85ms |
| API memory / CPU snapshot | 170MiB / 28.17% |
| worker memory / CPU snapshot | 527.2MiB / 42.90% |
| 전체 Fake E2E wall time | 469,481ms |

병목은 영상 렌더링이다. manual 흐름의 15초 렌더가 약 110.96초였고 다른 queue stage는 대체로 약 2초였다. production 동시 사용자·채널 수·일일 콘텐츠 수·대용량 파일 한도는 확정된 runtime CPU/GPU, queue concurrency, 임시 디스크와 provider quota를 기준으로 재측정한다.

## 남은 외부 검증

| 영역 | 상태 | 필요 조건 |
| --- | --- | --- |
| OpenAI | EXTERNAL_VERIFICATION_PENDING | API project/key, 결제 한도 |
| Google Image | EXTERNAL_VERIFICATION_PENDING | API key와 모델 권한 |
| ElevenLabs | EXTERNAL_VERIFICATION_PENDING | API key와 상업 사용 voice |
| YouTube | EXTERNAL_VERIFICATION_PENDING | OAuth client, 검증/채널/API quota |
| Instagram | EXTERNAL_VERIFICATION_PENDING | Meta app review와 professional account |
| TikTok | EXTERNAL_VERIFICATION_PENDING | Login Kit/Content Posting 및 `video.publish` 승인 |
| Sentry | EXTERNAL_VERIFICATION_PENDING | DSN과 staging project |
| Production deployment | EXTERNAL_VERIFICATION_PENDING | registry/cluster/managed DB·Redis·storage/secret·KMS/DNS·TLS/on-call |

구체적인 환경 변수, callback, smoke 순서와 성공 기준은 `docs/external-verification-checklist.md`에 있다.

## 알려진 비차단 위험

- Node.js 20은 현재 지원되지만 AWS SDK가 2027년 1월 이후 발행 버전부터 Node.js 22를 요구한다고 경고한다. Node 22 승격을 별도 운영 업그레이드로 계획한다.
- production 성능·RPO/RTO 수치는 배포 대상이 확정되기 전이므로 임의 목표를 선언하지 않았다.
- 플랫폼 정책·scope·quota는 사업자 변경 가능성이 있어 실제 smoke 시점에 다시 확인해야 한다.

## 최종 blocker

내부 release blocker: **0개**.  
외부 검증 대기: 위 8개 영역.  
최종 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING**.
