# Postbot v1 Acceptance Report

## 2026-10-06 직접 UX 보완 — 19.4

최종 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING**. [직접 UX 보완 결과](ux-remediation-2026-10-06.md)를 우선 확인한다. 실제 API 브라우저 점검 21개·page error 0, Playwright 18/18, API 96/96, worker 23/23, Fake 전체 여정 3/3, 변경 app/package lint·typecheck·build 및 실제 오디오 합성 4모드·기존/빈 DB migration을 통과했다. 신규 격리 전체 여정에서 DB deadlock 1회는 기존 재시도로 복구됐고 실패 attempt를 보존했다. production 이미지 재빌드/운영 배포/원격 CI/실 Provider·SNS는 이번 검증에 포함되지 않는다.

아래 19.3의 blocker 0은 당시 지원 범위 검증 기록이며 최초 명세 전체 기능의 화면 사용성 완료를 의미하지 않는다. 19.4에서 재예약·플랫폼 격리·누락 운영 화면과 추가 재생성/음원 경로를 보완했지만 커버 직접 편집·외부 자동 스톡 구매·고급 훅/게시 시각 최적화는 지원하지 않는다. 따라서 최초 명세 전체가 API 키 설정만 남은 상태라고 판정하지 않는다.

## 2026-10-06 출시 전체 내부 회귀·운영 보완 — 19.3단계

최종 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING**. 19.3의 지원 v1 범위에서 발견한 내부 출시 차단 결함을 보완했고 필수 로컬 검증을 모두 통과했다. 알려진 내부 release blocker는 0개이며 모든 미래 버그가 없다는 보장은 아니다. 아래는 19.3의 최신 증거이며, 이후의 19.2/19.1 기록은 과거 검증이다. 대상은 `feature-ux-pre-release-addendum.md`의 지원 v1 범위다. 자유 편집기·자유 화면 비율·외부 스톡 자동 구매·인과 효과 실험 등 명시적 제외 로드맵까지 완료했다고 주장하지 않는다. 실제 Provider/SNS, 운영 배포, 사용자 설정은 내부 Fake 검증과 구분한다. 시작 SHA: `592a55e`; 최종 구현 commit은 `git log -1 --format=%H`로 확인한다. push는 수행하지 않았다.

### 이번에 보완한 결함

* 웹 서버의 malformed URI 크래시, 경로 탈출 및 외부 symlink 접근을 차단하고 회귀 테스트를 추가했다. 정적 파일 MIME/HEAD/SPA/404와 runtime 설정의 비캐시를 검증했다.
* 같은 웹 artifact에 `PUBLIC_API_BASE_URL`을 실행 시 적용한다. 다른 API host의 CSRF 쿠키를 웹에서 읽을 수 없는 경우 인증 응답의 nonce를 메모리에만 보관한다. 인증 응답은 `Cache-Control: no-store`다.
* staging/production의 공개 placeholder·짧은 인증/암호화 키와 동일 JWT access/refresh 키를 시작 시 거절한다. 실제 키 생성·주입은 운영자가 수행한다.
* CI에서 DB 회귀가 skip으로 통과하지 않도록 별도 실행하고 `_test_test` DB 이름 중복을 방지했다. worker 통합 fixture는 담당 SCRIPT queue만 사용하며 release fixture는 실행 후 자신이 만든 채널만 PAUSED 처리한다.
* 알려진 production 의존성 취약점을 패치하고 Node 20 EOL runtime을 Node 24 LTS로 변경했다. 공식 Node build와 Ubuntu 26.04 LTS runtime 조합으로 FFmpeg/Chromium을 검증한다. 미패치 취약점을 숨기지 않도록 CI image scan의 `ignore-unfixed`를 제거했다.
* 복원은 기존 테이블이 있는 대상에 덤프를 주입하지 않는다. Docker 백업은 원격 주소를 로컬 Compose 대상으로 오인하지 않으며 원격 DB는 direct mode를 요구한다.
* Redis 완료 key 유실 후 재전달에서 DB의 성공 작업이 다시 실행되는 결함을 재현하고 수정했다. worker는 DB 성공 결과·완료 시각·시도 횟수를 보존한다. 실제 SCRIPT 재전달에서도 usage/ledger 1건을 유지한다.
* 복구 CLI의 Redis 연결 누수와 worker 즉시 종료 시 초기화 경쟁을 보완했다. queue/maintenance/worker가 소유한 연결을 직접 닫고 Nest 종료 hook에서도 정리한다. 연결 생명주기 검사는 고유 BullMQ prefix로 다른 작업과 격리한다. API SIGTERM은 shutdown hook을 통해 정리하며 readiness Redis 연결은 서버 장애 중에도 끊을 수 있다.

### 검증 결과

| 항목 | 결과·증거 |
| --- | --- |
| 전체 monorepo lint/typecheck/build | PASS. Linux Node 24 전체 lint/typecheck 및 production build 15/15. Windows 검사도 통과했다. |
| 전체 unit + 테스트 전용 DB integration/장애/멱등성 | PASS. Node 24 전체 test task 27/27(의존 build 포함), 마지막 queue/worker/API 보완 후 해당 lint/typecheck/build 및 API 88/88·worker 20/20·jobs lifecycle 6/6 추가 통과. 별도 release 3개는 일반 unit에서만 skip; database 8/8; asset 5/5. Provider 장애·권한·CSRF·예산·예약 경쟁·게시 모호성·중복 비용·완료 작업 재전달 회귀 포함. 영향 없는 성공 검증은 반복하지 않았다. |
| 웹 서버 / 백업 대상 보호 | PASS. 웹 Node builtin 8/8; 백업 helper 4/4, Node 24에서도 통과. 잘못된 mode·원격/임의 port·다른 loopback DB 주소를 실행 전 거절하고 허용된 실제 Compose 대상의 migration 11행 조회도 통과. |
| Desktop / mobile Playwright | PASS. 각각 13/13. API mock 기반 UI/마법사/권한 복귀/CSRF fallback과 실제 built 웹 runtime 서버를 검증하며 실제 DB 전체 여정과 구분한다. |
| 최종 Ubuntu 웹 이미지 | PASS. malformed URL 400 후 정상 URL 200, runtime API 적용 및 no-store, HEAD body 없음. |
| 실제 MinIO S3 contract | PASS. Node 24에서 upload/download/presigned URL/delete 1/1. |
| 최종 renderer 15초/60초 MP4 | PASS. 각각 15/60초, 1080×1920, audio true, 평균 -21.1dB, black-frame ratio 0, 장면 픽셀 RGB [199,4,204]. 실제 Chromium/FFmpeg 실행, exit 0. 종료 시 `Target closed` 경고는 출력 결과/QA 실패가 아니다. 마지막 queue 변경 뒤 최종 이미지의 renderer dist·Node·FFmpeg·Chromium·CJK 폰트 SHA-256이 해당 smoke 이미지와 모두 동일함을 확인해 영향 없는 장시간 smoke를 반복하지 않았다. 최종 worker의 실제 샘플 렌더도 별도 통과했다. |
| 브랜드·이미지·한글 still | PASS. `.artifacts/pre-release/brand-scene-193.png`를 직접 확인: 녹색 로고, 노란 watermark/serif/자막·파란 자막 배경·한글 overlay·장면 이미지. |
| 새 API/worker baked 전체 Fake 여정 | 최종 이미지 3/3 PASS, exit 0: 수동 130,900ms·승인형 311,358ms·완전 자동형 361,516ms, 전체 804.52초. 실제 HTTP/MySQL/BullMQ/S3/Chromium/FFmpeg와 Fake 외부 Provider로 3-platform 제작/게시/분석/최적화·중복 요청·비용 중복 방지를 확인했다. schedulerObservedMs null은 수동 시작이 선행한 fixture의 관찰값이며 timer 지연을 측정한 결과로 해석하지 않는다. 운영 SNS에는 게시하지 않았다. |
| 새 이미지의 실제 마법사 샘플 | PASS. `scripts/verify-wizard-sample.mjs`, channel `cmuvk07pc0006mg01xiqobt5j` / run `cmuvk08gv000qmg01rcd242sr` / content `cmuvk0be90007od01igyzwiba`. PAUSED 초안→제작→MP4→정책/승인→설정 완료, publishPlan 0. 30초, 1080×1920, audio true, 평균 -27.1dB, black ratio 0 및 실제 브랜드 스타일 확인. |
| 실제 Redis/worker 재시작·queue 복구 | PASS. 최종 이미지, stale reset 1·enqueue 2, 두 fixture 모두 SUCCEEDED·attempt 1·provider usage 0. 두 fixture의 완료 queue key만 지우고 재전달해도 동일 결과. worker 재시작 후에도 동일 상태. 복구/검증 CLI 모두 exit 0. 이 두 작업은 queue 생명주기용 deterministic COLLECT fixture이며 실제 domain 제작은 별도 전체 Fake 여정으로 검증한다. |
| 실제 API/worker graceful 종료 | PASS. 최종 이미지에서 API와 작업을 처리한 worker 모두 exit 0, OOM false. queue 및 maintenance 연결의 정상/즉시 종료와 실제 작업 처리 후 종료는 6개 독립 child process에서 자연 종료를 확인했다. |
| 격리 migration 및 backup/restore | PASS. 새 `_test` DB에 migration 11개·seed 적용 및 재적용 no pending. 88,823-byte dump checksum 검증·격리 restore 2회 성공, migration/workspace/channel/content = 11/1/1/0. 기존 테이블 대상은 명시적으로 거절. 새 guard restore 77,241ms는 로컬 부하 상태의 측정이며 운영 RTO 보장이 아니다. |
| production 의존성 audit | PASS. `pnpm audit --prod --audit-level=low`: 알려진 취약점 0. |
| secret / filesystem scan | PASS. Gitleaks 최신 source에서 노출 0, 기존 41 commit history 노출 0. Trivy filesystem vulnerability+misconfiguration HIGH/CRITICAL 0. artifact·backup·운영 `.env`는 source/image build context에서 제외한다. |
| 네 최종 image 취약점 scan | PASS. Trivy 0.70.0, 미패치 포함 HIGH/CRITICAL 각각 0. LOW/MEDIUM 및 미래 취약점까지 0이라고 주장하지 않는다. `.artifacts/pre-release/trivy-verified-{api,worker,renderer}-all-high-193.json` 및 `trivy-ubuntu-web-all-high-193.json`. |
| API 로컬 health baseline | PASS. 최종 이미지에서 100 requests, concurrency 10, p50 3.895ms / p95 15.888ms / max 59.576ms. 전체 여정 종료 후 로컬 측정이며 운영 용량·SLO 증거가 아니다. |

Backup SHA-256: `eefb06d7903474b6a66f577a9ea354858f9e40432a5206cb93f96ab73fb7ab94`. DB/덤프/fixture/object 증거는 보존하며 운영 데이터는 삭제하지 않았다.

최종 로컬 image inspect IDs(배포 registry digest가 아님):

* API: `sha256:807f1dc5af23a47556e504197107a52d06c592d793a999e8a38f12e7d6ce5c25`
* worker: `sha256:baad448171df23702dae84cde70f710a8ddd382ae9a51dbfb75c8027eb48d89d`
* web: `sha256:e14baa55583d54a5f1955aee380f7b0d0b3046568ac71ff8d2b3014ab20f221d`
* renderer: `sha256:79dadf665e8c9758ec2484884ef14b3b6d87e287c806e27afb48b301b8ed6e73`

### 실패한 시도와 외부 검증 한계

처음의 Node 20/Debian 12 및 Node 24/Debian 13 후보는 미패치 HIGH/CRITICAL이 남아 최종 release 후보에서 제외했다. 동시에 여러 image build를 실행할 때 개발 MySQL OOM과 cold browser timeout이 발생했다. 동일 DB를 재시작하고 부하를 분리해 해당 검증을 다시 수행했다. 초기 전체 Fake 여정의 FULL_AUTO에서는 host/VM 시간 약 30분 도약과 BullMQ lock 만료로 timeout이 발생했다. 해당 실패 fixture만 취소·PAUSED 처리하고 데이터/오류 증거를 보존했으며, 이 실패를 성공으로 계산하지 않는다. 이후 새 이미지 전체 여정이 두 번 3/3 통과했고 마지막 판정은 최종 이미지의 결과다. 완료 작업 재전달·연결 누수·즉시 worker 종료 경쟁은 회귀 실패로 재현한 뒤 수정했으며 마지막 관련 검사는 모두 통과했다. 일시적인 수동 명령의 src/dist 중복 수집 결과는 정식 source test 20/20으로 대체했고 성공 수에 포함하지 않았다.

재현 시에는 현재 commit에서 `docker compose -f docker-compose.acceptance.yml build api worker migrate acceptance`, `up -d --wait api worker`, `run --rm acceptance`를 순서대로 실행한다. 실제 샘플의 script mount 명령은 아래 과거 기록의 동일 `scripts/verify-wizard-sample.mjs` 절차를 사용한다. 검증에서는 최종 태그를 고정한 `.artifacts/pre-release/acceptance-final-193.yml` override를 사용했고 운영 `.env`는 주입하지 않았다. 검증 완료 후 acceptance 및 별도 integration Redis만 정지하고 개발 MySQL/Redis/MinIO와 DB/object/backup 증거는 보존한다.

운영자가 정해야 하거나 실제 자격 증명이 필요한 항목: 배포 대상/registry/도메인/HTTPS/같은-site 웹·API 구성, 운영 DB·Redis·S3 및 secret manager/모니터링/용량·RPO/RTO, 실제 Provider 키·voice ID·청구 단가·상업 권리, SNS 앱 심사·계정 권한·게시/analytics API 접근. 실제 유료 호출/SNS 게시/registry push/운영 배포와 원격 GitHub workflow 실행은 하지 않았다. 원격 CI 통과 또는 실제 외부 연동 완료를 주장하지 않는다. 배포/복구 절차는 `deployment-runbook.md`를 따른다.

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
