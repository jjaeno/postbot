# Postbot v1 Acceptance Report

## 2026-10-05 최종 명세 점검 보완 — 19.2단계

최종 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING** — 19.2 지원 범위의 구현·필수 로컬 검증이 완료됐다. production 출시 승인이나 전체 로드맵 완료 판정이 아니다. 아래 19.1 결과는 과거 단계의 증거이며 최신 명세 충족 판정으로 사용하지 않는다. 최종 점검에서 발견한 다섯 항목(권리 승인 후 재개, 플랫폼 격리, 실제 voice ID, 실험 제작/성과 비교, 마법사·브랜드·스톡 반영)을 이번 단계에서 구현했다. 시작 SHA는 `b6fa975a9a84ef742f0f02496436c23bfc4c4746`이며 이 절을 포함하는 19.2 구현 커밋의 SHA는 인계 응답과 `git log -1 --format=%H`로 확인한다. push/병합은 하지 않았다.

검증된 범위와 증거:

| 검증 | 결과 |
| --- | --- |
| 변경 API/worker/web/renderer/asset-library/contracts/providers/scene-schema/optimization lint·typecheck·build | PASS. 전체 monorepo 회귀를 반복하지 않고 변경 범위를 검증 |
| API 권리 재개/플랫폼 격리 DB 회귀 | 2/2 PASS. 기존 이미지 재사용, 추가 호출/비용 없음, 미사용 플랫폼 승인·정책·예약 보존 |
| 제한 실험 unit / API DB 회귀 | 3/3 / 3/3 PASS. 멱등 배정, 기간·플랫폼·보호 항목·배정 상한, 실제 게시/AVAILABLE 성과만 비교, 부족 표본 거절 |
| API 샘플 안전장치 / 스톡 업로드 DB 회귀 | 1/1 / 2/2 PASS. 게시 재시도 차단, 계정·검수 미완료 활성화 차단, 소유권/권리/중복 증빙 검증 |
| Worker SCRIPT / ASSET DB 회귀 | 각각 2/2 PASS. 실제 실험 길이·브랜드 스냅샷, 2 AI+2 스톡, 반복 실행 비용 중복 없음 |
| ElevenLabs Provider mock | Provider 14 passed, 1 DB skipped. 기본 음성 별칭을 설정된 voice ID로 해석하고 설정 누락은 차단 |
| 장면 스타일 / 비용 unit | 각각 2/2 / 3/3 PASS. 전량 스톡은 이미지 생성 비용 0, 미확정 실 Provider 단가는 계속 차단 |
| Web Playwright (API mock) | desktop 기존 여정 10/10, 모바일 변경 wizard 3/3, 신규 실험 여정 1/1 PASS |
| API / worker / asset-library unit | 각각 72 passed·17 skipped / 3 passed·16 skipped / 3 passed·2 skipped. DB 항목은 위 별도 실행과 구분 |
| 최종 baked API/worker 및 실제 샘플 여정 | PASS. dist override 없이 PAUSED 초안부터 승인/설정 완료까지 통과. 게시 재시도 뒤에도 publishPlan 0건 |
| 최종 production worker 브랜드 still | PASS. 1080×1920, 실제 이미지/녹색 로고/노란 워터마크/serif/노란 자막·파란 배경/한글 overlay를 직접 확인 |

추가 발견: route 전용 JSON parser 등록으로 Nest 기본 parser가 생략되는 초기화 문제를 수정해 다른 API의 기본 100kb 제한을 명시적으로 유지했다. runtime에 `fonts-noto-cjk`를 포함해 한글 overlay/caption의 누락 글리프를 보완했다. 아래에 최종 baked image 실제 샘플/renderer 결과를 기록한다.

실제 샘플 검증 스크립트: `scripts/verify-wizard-sample.mjs`. 격리 Compose API/worker/MySQL/Redis/MinIO와 실제 Chromium/FFmpeg를 사용하며 외부 Provider/OAuth는 모두 Fake로 강제한다. `_test` DB와 `APP_ENV=test` 이외의 실행은 거절한다. PAUSED 초안→계정 연결→예산→샘플 제작→MP4 다운로드→정책 검사/승인→게시 재시도 차단→설정 완료를 검사한다. fixture는 증거를 보존하고 마지막에 해당 채널만 PAUSED 처리한다.

실제 성공 fixture: channel `cmuvcfujf0017p401nh90j96v`, run `cmuvcfuod001rp401lyuaig4x`, content `cmuvcfyaq000lk201euxgcv1x`. MP4 다운로드 성공, 30.016초, 1080×1920, audio true, 평균 -27.1dB, black-frame 비율 0. manifest에 실제 브랜드/자막 스타일을 확인했다. Chromium 종료 과정의 `Target closed` 경고는 있었으나 작업/QA/전체 스크립트 exit 0이다. 최초 수집 실패는 fixture 키워드 `science`가 준비된 자료 본문과 맞지 않아 `rocket`으로 수정했고, 권리/정책 gate를 우회하지 않았다.

최종 Docker image inspect IDs: API `sha256:58b24a48f4585d28fc9d81465c24254e388bb265076de6eb633caa1537e17d3c`, worker `sha256:b745f909205ded6b9f64f1ae211976386cbe9375d7e28d1feddc9268dd1b82d4`. 로컬 이미지 식별자이며 registry 승격 증거가 아니다. 이미지 빌드의 15 package/app build도 PASS. 최종 API에는 기본 JSON parser 보완, worker에는 CJK 폰트가 포함됐다. 이미지 증거는 `.artifacts/pre-release/brand-scene-smoke.png`이며 Git에는 넣지 않는다.

격리 환경 재현 명령(저장소 루트):

```powershell
docker compose -f docker-compose.acceptance.yml build api worker acceptance
docker compose -f docker-compose.acceptance.yml up -d --wait api worker
docker compose -f docker-compose.acceptance.yml run --rm --volume "${PWD}/scripts/verify-wizard-sample.mjs:/app/scripts/verify-wizard-sample.mjs:ro" -e TOPIC_SOURCE_PROVIDER=fixture acceptance node scripts/verify-wizard-sample.mjs
docker compose -f docker-compose.acceptance.yml stop
```

이 명령은 격리 Compose의 테스트용 설정만 사용한다. 운영 `.env`를 주입하지 않는다. 완료 후 격리 컨테이너만 정지하고 DB/object 증거는 삭제하지 않았다. 기존 개발용 MySQL/Redis/MinIO는 유지했다.

남은 제한: 실험은 길이 변수 하나의 제한된 가설 비교이며 인과 효과/통계적 유의성을 주장하지 않는다. 출력은 1080×1920 고정이다. 실제 Provider/SNS, production 배포, registry 승격, CI Gitleaks/Trivy는 실행하지 않았으며 아래 외부 검증 제한은 계속 유효하다. 유료 호출·실제 게시·push는 하지 않는다.

## 2026-10-05 출시 전 정합성 보완 — 19.1 과거 기록

대상: `implementation-plan.md` 19.1단계. 시작/원격 기준 SHA: `ab8758d898fe4a4c90f4ce5398b479a0d1c363ac`. 최신 원격 main도 동일함을 확인했다. 검증된 구현 commit SHA: `cb7b9fb3b1d799414de6fa8a5a367daf9b1efe40` (`fix: 출시 전 사용자 흐름과 제작 정합성 개선`, 60 files). 이후 변경은 이 SHA를 기록하는 문서 전용 커밋뿐이며 앱·설정·테스트 코드 변경은 없다. 최종 repository SHA는 인계 응답과 `git log -1 --format=%H`로 확인한다. 푸시·병합·production 배포와 실제 유료 API/SNS 호출은 하지 않았다.

최종 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING** — 19.1단계의 지원 범위에 대한 내부/Fake/local 검증 판정이며 production 출시 승인이나 전체 로드맵 완료 판정이 아니다. 자동 실험 제작 배정/성과 비교, 자유 비율·해상도·자막 테마는 내부 미지원으로 명시하며 전체 로드맵 완료나 근거 없는 blocker 0을 선언하지 않는다. 구현·제외 범위는 `feature-ux-pre-release-addendum.md`, 문제별 근거·실 Provider smoke는 `pre-release-remediation.md`를 따른다. 아래 미실행한 CI/scanner와 moderate 의존성 위험은 staging 승격 전에 확인해야 한다.

### 환경과 증거 구분

Windows 11 / Node 20.19.4 / pnpm 10.34.5, Docker Desktop을 복구해 MySQL 8.4·Redis 7.4·MinIO를 실행했다. 전용 `postbot_test`와 격리 Compose `postbot_acceptance_test`를 사용했으며 운영 DB를 초기화하지 않았다. API/worker는 production runtime, renderer는 실제 Chromium/FFmpeg, 외부 LLM/Image/TTS/OAuth/Publishing/Analytics는 Fake다.

브라우저 테스트는 API mock 기반이며 실제 DB/queue 여정과 구분한다. 승인형·완전 자동형 통합 실행은 runtime image에 최신 compiled API/worker/contracts/asset-library를 read-only mount했다. 최종 이미지 재빌드 후 수동 여정은 dist mount 없이 baked image로 통과했다. 테스트 fixture의 15초 길이는 seed 정책의 최소 30초에 정상 차단돼 fixture를 30초로 수정했다. scheduler/manual 경합으로 중복 run이 생기는 결함을 수정하고 전용 acceptance DB의 미완료 fixture 실행만 취소했으며 데이터 삭제는 하지 않았다. 마지막 수동 재검증 격리를 위해 기존 acceptance fixture 채널만 PAUSED 처리했다.

### 실행 명령과 결과

| 검증/명령 | 최신 결과 |
| --- | --- |
| `pnpm exec turbo run lint typecheck build --concurrency=2` | PASS — 42/42 tasks (각 14개 package/app) |
| `pnpm exec turbo run test --concurrency=2` | 전체 24개 성공, API의 5초 HTTP fixture가 Docker build 동시 부하로 timeout. 실패 app만 낮은 동시성으로 재검증 |
| `pnpm --filter @postbot/api test --maxWorkers=2` | PASS — 70 passed, 11 skipped. 환경 의존 DB/release 제외는 아래 별도 실행 |
| `RUN_DB_INTEGRATION=1`, 전용 DB의 worker/asset 테스트 | Worker 18/18, asset 5/5 PASS. 최신 SceneVersion 권리·fallback 이력 보존 포함 |
| API DB integration: budget isolation/branching/start race/slot race (`--maxWorkers=1`) | PASS — 4 files, 8/8. workspace/currency/orphan/동시 예산 초과 및 예약 경합 포함 |
| 최종 예약 멱등 키 소유권 보완 후 API lint/typecheck/build 및 publishing unit/slot DB | PASS — unit 4/4 (추가 workspace 격리 1건 포함), DB 1/1. 영향 없는 이전 성공 검증은 반복하지 않음 |
| `pnpm --filter @postbot/web e2e` | Chromium 10/10 PASS — wizard/OAuth/refresh/승인/완전 자동 설정/소재 제작/예산/polling 입력/잘못된 시간대·Escape/OAuth 실패·조회 실패 |
| 동일 Playwright 10개 여정의 390×844 viewport (`--config ../../.artifacts/pre-release/mobile.playwright.config.mjs`) | PASS — 10/10, 25.7초. 임시 config는 Git 제외, webServer cwd를 web app으로 제한 |
| `pnpm --filter @postbot/renderer smoke:asset` | 실제 Chromium still, 1080×1920, 이미지 합성 PASS |
| production renderer image의 `node node_modules/@postbot/renderer/scripts/smoke.mjs` | 15초/60초 MP4 PASS — 15.001/60.001초, 1080×1920, audio true, 평균 -21.1dB, black ratio 0, 이미지 픽셀 RGB [199,4,205]. 두 실행 exit 0; Chromium 종료 경고는 비치명적 |
| Compose acceptance `vitest run src/release/fake-journey.e2e.spec.ts -t 'runs the'` | 실제 APPROVAL/FULL_AUTO 2/2 PASS, 수동 1개는 이 명령에서 제외. 승인 567,997ms, 완전 자동 365,709ms. 각 3-platform 제작·게시·분석·최적화, 중복 재요청 확인 |
| 최종 baked image: Compose acceptance `vitest run src/release/fake-journey.e2e.spec.ts -t registers` | PASS — 수동 1/1, 다른 2개는 별도 실행. 전체 121,869ms; SSE 6ms, script 2,083ms, asset/TTS 각각 2,053ms, 37.5초 영상 render 96,752ms, analytics 2,013ms. 게시/비용 중복 없음 |
| `docker compose -f docker-compose.acceptance.yml build api worker acceptance` + `up -d --force-recreate --wait api worker` | PASS — 최종 API 재빌드 포함, baked image 실행(no dist override), non-root node UID 1000, readiness DB/Redis/storage 모두 ok |
| final acceptance image의 기존 DB `prisma migrate deploy` | PASS — 11 migrations, pending 0; seed 완료. schema 변경 없음 |
| `pnpm audit --prod --audit-level=high` | exit 0; moderate 2건(js-yaml, brace-expansion). 취약점 0으로 보고하지 않음 |

최종 로컬 image IDs: API `sha256:78b50265d786033ef32d6dec54f021b277fba5779dbff98ec20a9387ce356ca9`, worker `sha256:0c6f5b737ab6db8f39df41703054e1e52ae01d217a2d7df35258302b809ae3d5`. 이는 로컬 image ID이며 registry 승격 digest가 아니다. Fake release 세 여정은 분리 명령으로 총 3/3 통과했으며 동일 최종 baked image에서 세 여정을 한꺼번에 재실행한 것으로 과장하지 않는다.

최종 수동 MP4의 저장된 ffprobe QA: 38.016초 (37.5초 SceneDocument 대비 허용 1초 이내), 1080×1920, audio true, 평균 -36.3dB, black frame 비율 0. 최종 검증 후 격리 acceptance 컨테이너는 정지하고 DB/object 데이터는 보존한다. 기존 개발 인프라·사용자 DB는 정지/삭제하지 않는다.

화면 증거: `apps/web/test-results/channel-wizard-preserves-r-95435-stores-the-selected-content-chromium/review-dashboard.png`. 영상 프레임 증거: `.artifacts/pre-release/scene-asset-smoke.png`. 둘 다 실제 파일을 열어 확인했다. 브라우저 mock의 example video URL을 실제 영상 재생 증거로 사용하지 않는다.

모바일 화면 증거: `.artifacts/pre-release/mobile-results/channel-wizard-preserves-r-95435-stores-the-selected-content-chromium-mobile/review-dashboard.png` (390×7348 full-page). 초기 임시 config가 root dev script를 실행해 중단했고 cwd를 web으로 제한해 재실행했다. 현재 실제 완료 증거는 수정 config의 10/10 결과다.

### 미실행·제한과 후속 검증

* 실제 Provider/SNS/Sentry: staging 자격 증명·사업자/앱 승인 계정이 없으며 유료 호출/실 게시 금지 범위다. Fake 성공으로 실 연동을 보증하지 않는다.
* Gitleaks/Trivy CLI 및 GitHub-hosted CI 실행: 로컬 도구 없음, push 금지. workflow 정의는 유지하고 dependency audit와 권한/CSRF/rate-limit HTTP 회귀는 로컬 실행했다. 최종 SHA의 filesystem/image scan은 CI에서 필요하다.
* 이번에는 Prisma schema/migration 변경이 없다. 빈/기존 DB migration·backup/restore/rollback의 2026-09-29 결과는 아래 역사적 증거이며 이번에 다시 실행했다는 뜻은 아니다. 최종 acceptance image의 deploy/status는 별도 기록한다.
* 실제 청구 정산, 증빙 진위·voice 상업권 검토, production 부하·용량, registry digest 승격, KMS·TLS·backup/restore rehearsal은 배포 전 별도 운영 검증이다.
* 재생성 화면은 단계별 예상 비용 예약·추가 비용 발생을 안내하지만 클릭 전 정확한 총 견적 숫자를 제공하지 않는다. 서로 다른 플랫폼 정책/권리 gate는 독립적으로 유지한다.

실 Provider 최소 smoke: source 1건으로 script→이미지 1장→짧은 TTS→영상 QA, configured price/usage/실 청구 대사, 낮은 budget 허용/차단, 각 SNS OAuth 승인·거절·만료/refresh→테스트 게시 1건→URL/analytics/정리, 최종 이미지 readiness·backup/restore/rollback을 수행한다. 세부 환경/명령은 `external-verification-checklist.md`와 운영 runbook에 있다.

---

## 역사적 baseline — 2026-09-29 (최신 판정이 아님)

이하의 PASS/보안 0건/내부 blocker 0 주장은 당시 SHA와 검증일에 한정된다. 최신 구현과 보안 상태는 위 2026-10-05 절을 따른다.

검증일: 2026-09-29 (Asia/Seoul)

Validated implementation SHA: `a2b6103e93e532ef1f164e2dd98b6c9bd5061777`

Final repository SHA: 최종 빈 release marker는 자기 SHA를 이 파일에 포함할 수 없으므로 최종 인계 보고의 `final commit SHA`로 기록한다.

Post-validation changes: 이 보고서와 요구사항 추적성 문서 갱신 및 빈 release marker뿐이며, 검증 대상 구현 변경은 없다.
기준 브랜치: `main` (이번 blocker 수정 작업 시작 기준 `b4440d1c9a2bf2956472511696c5ed4ab257b68c`)

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
| `pnpm test` | PASS — 25/25 tasks; API 60 passed/9 skipped, DB 5 passed, worker 환경 의존 통합 tests는 별도 실행 |
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
| 가입→로그인→수집→대본/장면→asset→TTS→render→승인→게시→분석 | PASS | 177,112ms |
| 3-platform APPROVAL 자동화→플랫폼별 제작/검수→게시→분석→최적화 | PASS | 413,004ms |
| 3-platform FULL_AUTO 자동화→플랫폼별 정책 gate→게시→분석→최적화 | PASS | 400,874ms |

세 여정은 분리 실행했으며 모두 통과했다. 최초 성능 probe는 운영용 60회/분 rate limit과 충돌했으며, liveness/readiness를 일반 API rate limit에서 제외해 모니터링과 측정이 429를 유발하지 않도록 수정한 뒤 재실행했다.

## Migration, 데이터 및 복구

| 검증 | 결과 |
| --- | --- |
| 빈 DB `prisma migrate deploy` + status | PASS — 11 migrations, pending 0 |
| 기존 DB forward upgrade + status | PASS — 11 migrations, pending 0 |
| automation platform fan-out forward migration | PASS — 공통 `branchKey=COMMON`, 플랫폼별 branch unique/index 적용 |
| workspace 범위 platform account unique migration | PASS |
| 비동기 retention/workspace/user lifecycle 및 object 삭제 | PASS — DB integration |
| Redis/queue 복구 명령 | PASS — stale reset 0, enqueue 0인 정상 수렴 상태 |
| MySQL backup + SHA-256 verify | PASS — 155,357 bytes, `941f5d65c75bc60fc1e4267ddd12cdadd7fa1e5fdbaa1cb4c264805cc80c020e` |
| 격리 DB restore | PASS — 3,569ms; migrations 10, workspaces 24, channels 24, content items 23 |

검증 backup은 `.backups/postbot-2026-09-29T07-02-16-817Z.sql`에 생성되며 Git에서 제외된다. production에서는 runbook에 따라 암호화 원격 저장소와 KMS, 확정된 RPO/RTO를 사용해야 한다. schema rollback은 파괴적 down migration 대신 이전 image rollback과 DB forward-fix를 기본으로 한다.

## 장애·멱등성·보안 회귀

- Redis 재연결, stale job 복구, worker 재시작과 실패 단계 재개
- Provider timeout/rate limit, storage/renderer 실패, OAuth 만료·refresh
- workspace/channel authoritative relation scope, 통화 분리, orphan fail-closed, 동시 예약 직렬화
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

이번 blocker 수정의 production Compose build는 첫 시도에서 Docker BuildKit 연결 EOF가 발생했으나 Docker engine 정상 상태를 확인한 뒤 동일 명령을 재실행해 api/migrate/renderer/web/worker 5개 이미지를 모두 완성했다.

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

## 2026-09-29 P0 blocker 해소 증거

| 내부 blocker | 구현 및 검증 | 결과 |
| --- | --- | --- |
| 멀티플랫폼 자동화 fan-out | 공통 COLLECT 뒤 YOUTUBE/INSTAGRAM/TIKTOK별 SCRIPT→ASSET→TTS→RENDER→POLICY→PUBLISH branch, 플랫폼별 version/plan/post, 전체 branch terminal 집계 | PASS |
| 플랫폼 부분 실패와 재개 | Instagram publish만 실패시 YouTube/TikTok 결과 유지, Instagram만 retry, 최종 SUCCEEDED; queued duplicate와 stale claim recovery 회귀 포함 | PASS |
| 플랫폼별 policy/rights gate | block된 플랫폼만 publish 금지하고 다른 branch는 독립 진행 | PASS |
| workspace budget 격리 | 다른 workspace의 $500 비용을 제외하고 동일 workspace의 여러 channel 비용은 합산 | PASS |
| channel budget 격리 | 대상 channel 비용과 활성 reservation만 포함하고 sibling channel 비용 제외 | PASS |
| 예산 보수성 | currency별 계산, 귀속 불가 ledger fail-closed, serializable transaction과 row lock으로 동시 overspend 방지 | PASS |

직접 증거는 `automation-branching.integration.spec.ts` 1/1, `automation-budget.integration.spec.ts` 5/5, worker DB integration 16/16, 3-platform APPROVAL/FULL_AUTO release E2E 각 1/1이다. 동일 automation idempotency key 재호출 후 `PlatformPost`는 3개로 유지되고 외부 post ID도 모두 고유했다.

## 최종 blocker

내부 release blocker: **0개**.  
외부 검증 대기: 위 8개 영역.  
최종 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING**.
