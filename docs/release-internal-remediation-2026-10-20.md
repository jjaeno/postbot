# 출시 전 내부 보완 인수 기록 — 2026-10-20

## PR #2 proxy-rate-limit CI 후속 보완

초기 head `338faa56d188a171674e31009c6f2e7e447afd25`의 [CI 실패 job](https://github.com/jjaeno/postbot/actions/runs/39299447590/job/118223477245)은 프록시 assertion 실패가 아니다. `actions/setup-node@v5`가 루트 `package.json`의 `packageManager: pnpm@10.34.5`를 감지해 자동 캐시를 준비하다가 호스트의 pnpm 실행 파일을 찾지 못했다. 따라서 API image build와 실제 proxy 검사는 실행되지 않았다. 같은 실행의 validate/acceptance/renderer-smoke/docker-smoke/browser-e2e는 모두 성공했고 [security](https://github.com/jjaeno/postbot/actions/runs/39299447321)도 성공했다.

수정: 해당 job의 setup-node에 `package-manager-cache: false`만 명시한다. 호스트는 의존성 없는 Node smoke harness만 실행하고 pnpm 설치/앱 build는 Dockerfile 안에서 수행한다. 다른 job의 pnpm 캐시, 테스트 assertion, 요청 제한, CI 필수 실행 조건 및 security workflow는 변경하지 않는다. [setup-node 공식 설명](https://github.com/actions/setup-node/blob/v5/README.md#caching-global-packages-data)의 자동 캐시 제어를 확인했다(2026-10-20).

검증: 원격에서 사용한 setup-node SHA `a0853c24544627f65ddf259abe73b1d18a591444`의 실제 배포 bundle을 pnpm 없는 격리 Node 24.21.0 환경에서 실행했다. 저장소 package.json을 읽기 전용으로 제공하고 이미 설치된 Node를 사용해 캐시 분기를 검사했다. 입력 `INPUT_PACKAGE-MANAGER-CACHE=true`는 동일 pnpm 오류/exit 1, `false`는 exit 0으로 확인했다. Docker shell entrypoint가 하이픈 포함 입력 환경 변수를 제거하지 않도록 `--entrypoint node`로 직접 실행했다. 초기 shell-entrypoint 진단 로그도 보존했다. actionlint 1.7.7과 `git diff --check` PASS. 앱/package 코드는 바꾸지 않아 이전의 동일 앱 코드 lint/typecheck/build/DB/renderer/브라우저 검증은 반복하지 않았다.

증거는 Git 제외 `.artifacts/proxy-ci-repair-20261020/`의 `remote-failure.txt`, `setup-before.log`(exit 1), `setup-after.log`(exit 0), `actionlint.log`다. 수정 커밋을 같은 PR에 push한 후 **새 원격 실행에서 setup-node와 실제 proxy 검사 성공을 확인해야 한다**. 아래 미푸시/원격 NOT_RUN 표시는 최초 로컬 인수 시점의 과거 기록이다.

## 판정과 버전

현재 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING — 요청 범위 로컬 필수 검증 완료**. 새 커밋의 원격 CI/security와 실제 운영 환경 검증은 별도 대기다. 내부 blocker 0 또는 운영 준비 완료를 선언하지 않는다. 과거 원격 CI 성공은 이번 수정의 원격 검증 결과가 아니다.

- 기준 main: `be12ad6341d3f125b329e796efbfc8f25adf0235` (2026-10-20 fetch 후 fast-forward).
- 브랜치: `fix/production-readiness`. 시작 시 사용자 변경 없음. push·PR 생성 없음.
- 수정 버전: 이 문서를 포함한 로컬 커밋. 최종 SHA 조회: `git log -1 --format=%H -- docs/release-internal-remediation-2026-10-20.md`. 미커밋 상태에서는 기준 SHA + working diff이며 커밋 완료로 간주하지 않는다.
- 환경: Windows/PowerShell, Node 20.19.4 / pnpm 10.34.5; Docker Desktop Linux, 빌드·DB 회귀는 Node 24.21.0, MySQL 8.4.11·Redis 7.4.11·Caddy 2.11.7·격리 MinIO S3.
- 로컬 증거: Git 제외 `.artifacts/internal-20261020/`. 합성 이메일·비밀번호·가짜 Provider만 사용하며 운영 키·쿠키·토큰·개인정보를 출력하지 않는다.
- 최종 commit SHA·변경 파일 SHA-256·로컬 image 식별자·검증 exit code는 같은 디렉터리의 `verification-manifest.json`에 보존한다. image 식별자는 로컬 build 증거이며 registry push/승격 증거가 아니다.

## 발견별 재현과 수정

변경 파일:

- 인증: `apps/api/src/auth/`의 `auth.service.ts`, `auth.repository.ts`, `prisma-auth.repository.ts`, `auth.e2e.spec.ts`, 신규 `auth.integration.spec.ts`.
- 프록시: `apps/api/src/main.ts`, 신규 `trusted-proxy.ts`·`trusted-proxy.spec.ts`, `infra/Caddyfile`, `docker-compose.production.yml`, `.env.example`, 신규 `scripts/proxy-rate-limit-smoke.mjs`.
- CI/검증: `.github/workflows/ci.yml`, `apps/renderer/scripts/smoke.mjs`, `eslint.config.js`, `.gitignore`.
- 문서: 이 인수 기록, `v1-acceptance-report.md`, `production-readiness-2026-10-13.md`, `implementation-plan.md`, `deployment-runbook.md`.

| 항목 | 수정 전 실측 | 수정 |
| --- | --- | --- |
| refresh 동시 요청 | 실제 Prisma/MySQL HTTP 병렬 요청 모두 201 | 사용자 행 `SELECT ... FOR UPDATE`를 먼저 획득한 transaction 안에서 원본 검증→소비→후속 INSERT→연결. 재사용 탐지와 logout도 같은 행 잠금 |
| logout 경합 | 원본으로 logout 후 회전된 후속 세션이 살아 있음 | logout은 해당 family 전체 폐기. 회전된 원본으로 logout하거나 refresh와 경합해도 후속 세션이 남지 않음 |
| workspace slug | 동일 앞부분/다른 도메인 두 가입 모두 500; 같은 이메일 동시 가입 201/500 | 신규 slug에 길이 제한한 접두부+UUID. UNIQUE 유지, 충돌 시 가입 transaction rollback 후 재시도. 동일 이메일은 409. 기존 주소 변경 없음 |
| Caddy 제한 | 실제 IP가 다른 A가 60회 사용하면 B 첫 요청도 429 | 전용 ingress의 Caddy IPv4 하나/직접 연결 hop만 신뢰. Caddy가 XFF를 접속 IP로 덮어씀. API 직접 접속의 위조 헤더 무시 |
| CI | 배포 안전 테스트 미연결, 성공한 PR CI에서도 renderer skipped | 배포 테스트를 validate에 추가. renderer를 PR/main/manual 항상 실행. 실제 Caddy 회귀 job 추가. 로그·보고서 14일 보존 |

DB 구조 변경이 없어 migration은 추가하지 않는다. refresh 중 DB 실패는 전체 rollback하며 새 쿠키를 발급하지 않는다. 실제 PK 충돌로 원본 소비 후 INSERT 실패를 주입한다.

### 여러 탭과 재사용 정책

같은 토큰의 새 후속은 최대 하나다. 정상 다중 탭 동시 요청도 탈취 토큰 재사용과 확실히 구분할 수 없어 **엄격한 재사용 탐지**를 적용한다. 한 요청만 회전에 성공하고, 같은 원본을 다시 제출하면 401 및 family 전부 폐기(성공한 후속 포함) 후 재로그인을 요구한다. grace window·후속 토큰 재전송·IP/UA 일치만으로 재사용을 허용하지 않는다. 별도 로그인 family는 유지한다. 여러 탭의 끊김 없는 동시 갱신은 지원 보장이 아니며 원본을 반복 자동 재시도하면 안 된다.

logout은 refresh family 취소와 브라우저 쿠키 삭제다. 기존 stateless access JWT의 만료 전 서버측 즉시 취소는 이번 계약이 아니다(기존 15분 TTL 유지).

갱신 응답이 유실된 뒤 원본을 재제출하는 경우도 같은 정책으로 재로그인이 필요하다. 서버는 유효한 후속 refresh token의 원문을 저장하거나 재전송하지 않는다. 이것이 다중 탭/네트워크 유실에서의 명시적인 사용성 한계다.

## 최종 검증

실행하지 못한 검증을 PASS로 처리하지 않는다. 아래는 이번 코드에서 직접 실행한 결과이며 과거 검증과 구분한다.

| 검증 | 결과·증거 |
| --- | --- |
| 수정 전 auth 재현 | 7개 중 5 실패·2 통과. `auth-before.log` |
| 수정 후 auth·DB 회귀 | 신규 실제 DB auth 7/7, proxy 단위 2/2. API 107 PASS+아래 환경 보완 후 audio 1 PASS=108, worker 33, Redis lifecycle 6 및 나머지 package 회귀 통과. `db-regression.log`, `audio-db-s3.log` |
| API/renderer lint·typecheck, 신규 script lint | PASS. `api-lint.log`, `api-typecheck.log`, `renderer-lint.log`, `renderer-typecheck.log`, `proxy-script-lint.log`. Fake repository 계약 보완 후 auth 4/4를 Linux에서 재검증 (`auth-unit-linux-final.log`) |
| build·production 이미지·readiness | 전체 15 build task PASS. 새 API/worker/renderer production image build PASS. 격리 acceptance API/worker readiness PASS. `build-final.log`, `api-image.log`, `worker-image.log`, `renderer-image.log`, `acceptance-start.log` |
| 실제 Caddy IP별 한도·위조 방어 | PASS. 고정된 서로 다른 source IP A/B 각각 60×400 이후 61번째 429. 매 요청 XFF 위조해도 proxy/direct 모두 우회 차단. `proxy-before-distinct.log`, `proxy/report.json`, `proxy-after.log` |
| 배포/backup script 테스트·workflow·Compose | 배포 3+backup 4=7/7 PASS (`script-tests.log`). actionlint 1.7.7 PASS (`actionlint.log`), production Compose `config --quiet` PASS (`production-compose.log`) |
| renderer 15/60초 실제 미디어 QA | PASS. 두 영상 각각 정확히 15/60초, 1080×1920, audio true, 평균 -21.1dB, black ratio 0. 첫/둘째 scene 픽셀 `[199,4,204]`/`[3,200,8]`로 실제 합성 확인. `renderer-smoke.log`, exit 0 |
| Playwright·backup/restore | Playwright 19/19 PASS (`playwright.log`). 실제 dump checksum 확인/빈 DB 복원 PASS (`backup-restore.log`): migration 13/13, users 65/65, sessions 16/16, assets 27/27, tables 48/48 |
| 독립 S3 lifecycle | 격리 MinIO upload/download/presign/delete 1/1 PASS (`storage-integration.log`) |
| 변경분 비밀정보 | Gitleaks 8.24.3, 기존 `.gitleaks.toml`과 default rules 유지, staged patch scan PASS·노출 0 (`gitleaks.log`, `gitleaks.json`) |
| Fake acceptance | 최종 API/worker image에서 HTTP+MySQL+BullMQ+S3+실 renderer 3/3 PASS (`acceptance.log`, exit 0). 수동/APPROVAL/FULL_AUTO 각각 166.4/424.6/359.9초. 외부 AI/OAuth/SNS는 모두 Fake이며 실제 SNS 게시가 아님 |

자동 흐름 중 MySQL write conflict/deadlock 로그가 발생했으나 기존 복구 경로로 진행해 최종 3/3이 성공했다. `acceptance-worker.log`에 실패 로그를 보존한다. scheduler 관측 30초 창의 `schedulerObservedMs`는 두 자동 흐름 모두 null이므로 스케줄러 30초 응답 보장이나 운영 용량 증거로 사용하지 않는다.

원래 전체 DB 회귀 명령은 26/27 task, Vitest 218 PASS·1 FAIL·4 gate skip으로 종료했다(exit 1 기록 유지). 실패는 S3가 없는 `127.0.0.1:9000` 접속이었다. MinIO를 연결한 뒤 **실패한 audio 권리 검사만** 실제 MySQL/S3로 통과시켰다. skip 중 S3 lifecycle 1건도 별도 실행해 PASS, release 3건은 아래 acceptance에서 분리 실행한다. 이미 통과한 패키지 전체를 반복하지 않았으며 assertion·권리/정책 gate·보안 workflow를 완화하지 않았다.

초기 검증 이력도 성공으로 덮어쓰지 않는다. Windows auth 단독 재검증의 10초 beforeEach timeout은 `auth-unit-final.log`에 남고, 같은 최종 테스트/기본 timeout을 Linux에서 실행한 4/4 성공으로 해소했다. 최초 backup shell 인수 오류는 `backup-first-invocation.log`, image 완성 전 proxy 시작 실패는 `proxy-before-image-ready.log`에 보존했다. proxy의 동적 API 주소가 Caddy 고정 주소를 먼저 차지한 기동 실패(`proxy-address-conflict.log`)는 API도 `.3`으로 고정한 Compose/회귀 수정으로 해결했다.

실행 명령(격리 환경 변수를 주입한 Linux build image 또는 해당 앱 작업 경로):

```bash
pnpm --filter @postbot/api lint
pnpm --filter @postbot/api typecheck
pnpm --filter @postbot/renderer lint
pnpm --filter @postbot/renderer typecheck
pnpm exec eslint scripts/proxy-rate-limit-smoke.mjs
# RUN_DB_INTEGRATION=1, _test MySQL, 격리 Redis/S3를 사용
pnpm exec turbo run test --concurrency=1 -- --maxWorkers=1 --testTimeout=20000
pnpm --filter @postbot/api exec vitest run src/channels/audio-assets.integration.spec.ts --maxWorkers=1 --testTimeout=20000
pnpm --filter @postbot/api exec vitest run src/auth/auth.e2e.spec.ts --maxWorkers=1
# RUN_STORAGE_INTEGRATION=1, 격리 MinIO
pnpm --filter @postbot/providers exec vitest run src/s3-storage.integration.spec.ts --maxWorkers=1
node --test scripts/deploy-production.test.mjs scripts/mysql-backup-lib.spec.mjs
pnpm --filter @postbot/web e2e
docker build --target build -t postbot-internal-build:20261020 .
docker build --build-arg APP=api -t postbot-internal-api:20261020 .
docker build --build-arg APP=worker -t postbot-internal-worker:20261020 .
docker build --build-arg APP=renderer -t postbot-internal-renderer:20261020 .
docker run --rm --shm-size=512m --entrypoint node postbot-internal-renderer:20261020 node_modules/@postbot/renderer/scripts/smoke.mjs
# PROXY_SMOKE_API_IMAGE=postbot-internal-api:20261020
node scripts/proxy-rate-limit-smoke.mjs
docker compose -f docker-compose.production.yml config --quiet
docker compose -p postbot-internal-acceptance -f docker-compose.acceptance.yml -f .artifacts/internal-20261020/acceptance.override.yml up -d --wait api worker
docker compose -p postbot-internal-acceptance -f docker-compose.acceptance.yml -f .artifacts/internal-20261020/acceptance.override.yml run --rm acceptance
```

DB 회귀는 `_test` 스키마에 migration 13개를 적용한 후 실행했다. backup/restore의 정확한 fixture 명령은 같은 artifact 디렉터리의 `backup-restore.sh`다. 백업 자체는 격리 DB container 안에만 생성했으며 운영 데이터는 포함하지 않는다. web production 코드/보안 workflow/lockfile은 변경하지 않아 해당 image 재빌드·전체 보안 scan 반복은 제외했다. 새 커밋의 원격 보안 결과는 아래 별도 gate로 남긴다.

## 원격 CI와 과거 증거

2026-10-20 GitHub 연결의 인증된 REST 조회로 최신 main `be12ad6341d3f125b329e796efbfc8f25adf0235`의 [CI 39281682357](https://github.com/jjaeno/postbot/actions/runs/39281682357), [security 39281682547](https://github.com/jjaeno/postbot/actions/runs/39281682547) SUCCESS를 확인했다. CI는 2026-10-20 01:36 KST에 완료됐다. validate(전체 lint/typecheck/test/DB/build/audit), browser, acceptance, docker-smoke 성공과 **renderer-smoke SKIPPED**를 job별 확인했다. 이전 PR head `f919c35`의 [CI 39121806238](https://github.com/jjaeno/postbot/actions/runs/39121806238), [security 39121806236](https://github.com/jjaeno/postbot/actions/runs/39121806236)도 성공했다. 이 결과들은 이번 수정을 포함하지 않는다.

새 수정은 push하지 않으므로 최종 커밋 원격 CI/security는 **NOT_RUN**이다. 다음 승인된 push/릴리스에서 같은 SHA의 validate·DB 회귀·proxy-rate-limit·renderer-smoke·browser-e2e·acceptance·docker-smoke와 security를 모두 확인한다. skipped/cancelled/실패는 릴리스 통과가 아니다. CI 실패 시 fixture 전용 로그·미디어 QA·브라우저 trace artifact를 확인한다. 원본 secret/env/cookie는 업로드하지 않는다.

[이전 운영 준비 기록](production-readiness-2026-10-13.md), [이전 CI 보완](ci-remediation-2026-10-18.md)의 완료·blocker 0은 당시 코드/검증 범위에만 적용한다. 이번 재현으로 과거의 포괄적인 내부 완료 표현을 현재 상태의 근거로 사용할 수 없음을 확인했다.

## 지원·보류·외부 검증·담당

| 구분 | 현재 지원 / 남은 조건 | 담당 |
| --- | --- | --- |
| YouTube APPROVAL | 내부 Fake 제작·정책·승인·예약/게시 계약 지원. 실 AI/OAuth/비공개 게시·Analytics/HTTPS 검증 대기 | 사용자: 계정·키·권한·실 호출 승인. Codex: 승인된 환경 검증/결함 수정 |
| Instagram | 내부 어댑터/Fake 지원. professional 계정·앱 권한/심사·실 Graph 응답 대기 | 사용자: 계정·심사. Codex: 승인 후 계약 검증 |
| TikTok Direct Post/FULL_AUTO | **제품·정책상 보류**. 자격 증명만 넣으면 켜지는 기능이 아님. 개별 동의 UX·제품 적합성 재설계/검토가 먼저 필요. 수동 제작·내보내기 후 앱 게시 유지 | 사용자+Codex: 별도 범위/정책 결정 후 재설계. 이번 범위에서 재활성화하지 않음 |
| 권리·예산·중복 방지 | 사용자 권리 확인, 민감/강제 검수, 비용 예약/원장, ambiguous publish 보류 유지. 실 청구·권리 증거는 Fake와 분리 | 사용자: 증빙·결제 상한·invoice 대사. Codex: 안전장치 회귀·증거 기반 복구 |
| 인프라·운영 | 단일 API+Caddy Compose 계약. 서버/DNS/TLS/S3/registry·외부 경보·운영 용량/RPO/RTO 대기 | 사용자: 선택·계정·접근·배포 승인. Codex: 승인 후 검증·내부 수정 |
| 지원 제외/후속 | 자유 타임라인/비율 편집기·외부 스톡 자동 구매·고급 인과 효과/훅/게시시각 최적화는 추가하지 않음 | 별도 제품 로드맵 |
| 내부 검증 | 요청 범위 로컬 필수 검증 완료. 최종 SHA의 원격 CI/security 확인과 실패 대응, 실제 HTTPS/실 계정 계약 차이는 승인된 환경에서 후속 확인 | Codex |
| 최종 원격 CI | push/PR 생성은 이번 범위 밖. 승인된 push 후 모든 필수 job 확인 | 사용자: push 범위 승인. Codex: 결과 확인·필요시 수정 |

유료 Provider 호출·SNS 게시·registry push·운영 배포·운영 데이터 변경은 수행하지 않았다.
