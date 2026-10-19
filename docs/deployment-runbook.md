# 배포·백업·복구 Runbook

## 1. Release artifact

2026-10-20 필수 gate: 동일 SHA의 CI `validate`(배포 안전 테스트·실 DB 회귀 포함), `proxy-rate-limit`, `renderer-smoke`, `browser-e2e`, `acceptance`, `docker-smoke`와 security가 모두 성공해야 한다. renderer는 PR/main/manual마다 항상 실행한다. 로컬 단독 확인은 `node --test scripts/deploy-production.test.mjs`, 최종 renderer image에서 `node node_modules/@postbot/renderer/scripts/smoke.mjs`, `PROXY_SMOKE_API_IMAGE=<로컬 최종 API image> node scripts/proxy-rate-limit-smoke.mjs`다. 실패·skip은 통과가 아니다. test fixture 로그와 QA 보고서는 CI artifact로 14일 보관하며 secret/env 원본을 업로드하지 않는다. 최신 상태는 [인수 기록](release-internal-remediation-2026-10-20.md)에 있다.

1. 검증할 commit SHA를 고정한다.
2. `docker build --build-arg APP=<api|worker|renderer|web> -t <registry>/postbot-<app>:<sha> .`로 네 이미지를 build한다.
3. filesystem/secret/dependency scan과 네 image scan이 모두 통과해야 push한다.
4. staging과 production은 tag를 다시 build하지 않고 같은 digest를 승격한다. 배포 대상/registry가 확정되지 않은 동안에는 이 계약만 유지한다.

Node.js 24 LTS 공식 이미지에서 빌드하고 같은 Node 바이너리를 Ubuntu 26.04 LTS runtime에서 사용한다. API·web은 미디어 실행 의존성을 포함하지 않고, worker·renderer만 FFmpeg/Chromium/CJK 폰트를 포함한다. Postbot은 `exec node`를 PID 1로 사용한다. worker는 작업을 drain하고 web은 SIGTERM/SIGINT에서 HTTP server를 닫아 정상 종료한다. Ubuntu base에 포함된 사용하지 않는 `/usr/bin/pebble`은 Go stdlib 취약점 때문에 runtime에서 제거한다. runtime 취약점은 패치 가능 여부뿐 아니라 미패치 항목의 영향도도 별도로 확인한다. `--ignore-unfixed` 통과를 전체 CVE 0건으로 표현하지 않는다.

## 2. 배포 순서 (2026-10-13 갱신)

운영 기본안은 단일 서버 Docker Compose와 Caddy HTTPS다. 인프라 구매·registry push·운영 rollout은 수행하지 않았다. managed DB/Redis/S3도 같은 앱 Compose를 사용할 수 있다. 동일 origin(`/api`)을 기본안으로 검증한다. 기존 같은-site 서브도메인 배포 계약은 코드에 남아 있으나 새 preflight는 public-suffix 판정을 추측하지 않고 동일 origin만 인증한다.

API는 공개 port 없이 단일 replica로 운영한다. 전용 `api-ingress` network에서 Caddy의 고정 IPv4(`POSTBOT_PROXY_IP`, 기본 `172.30.250.2`) 하나만 `API_TRUSTED_PROXY`로 신뢰한다. API 주소도 `POSTBOT_API_INGRESS_IP=172.30.250.3`으로 고정해 자동 할당과 Caddy 주소가 충돌하지 않게 한다. subnet 기본값은 `POSTBOT_PROXY_SUBNET=172.30.250.0/29`이며 주소 충돌이 있으면 세 값을 함께 바꾸고 실제 proxy smoke를 다시 실행한다. Caddy는 `api-ingress:3000`으로 접속하고 X-Forwarded-For를 실제 TCP peer로 덮어쓴다. 미설정 API는 전달 헤더를 신뢰하지 않으며 CIDR/전체 private range/hop count 허용 설정은 받지 않는다. 인터넷→Caddy→API 구조이고 CDN/LB 앞단을 신뢰하지 않는다. 앞단 추가나 API 수평 확장은 별도 신뢰 경계/공유 rate-limit 저장소 검증이 필요하다. 현행 한도는 IP·endpoint별 프로세스 메모리의 60회/분이며 재시작 시 초기화된다.

secret manager가 저장소 밖 `/run/postbot/<environment>/app.env` 같은 tmpfs 경로에 0600 환경 파일을 렌더링하고 `POSTBOT_ENV_FILE`로 지정한다. 이것은 Compose `env_file`의 실제 입력이다. 값은 image layer·Git·shell history·배포 로그에 남기지 않는다. `docker compose config` 전체 출력은 secret을 포함하므로 **`config --quiet`만 사용한다**. 기존 문서의 “환경 파일에 저장하지 않는다”는 실제 Compose 계약과 충돌했으므로, 영속 파일 대신 secret manager가 만드는 일시적인 제한 접근 파일로 정정한다. 컨테이너 환경을 조회할 수 있는 Docker 관리자 권한도 secret 접근 권한으로 취급한다.

배포 manifest에는 비밀이 아닌 `POSTBOT_PROJECT`, `POSTBOT_DOMAIN`, `POSTBOT_STORAGE_DOMAIN`, `POSTBOT_STORAGE_UPSTREAM`, `POSTBOT_{API,WORKER,RENDERER,WEB,MIGRATE,PROXY}_IMAGE`를 둔다. 이미지 값은 모두 `registry/repository@sha256:<digest>`다. staging과 production은 별도 project 이름·secret 파일·DB·Redis·bucket을 사용한다. `migrate` 이미지는 Dockerfile의 `build` target으로 별도 build/scan/push한다. 앱 이미지는 동일 검증 digest를 승격한다.

1. [사용자 설정 목록](production-readiness-2026-10-13.md)의 HTTPS 주소, 단가, 활성 플랫폼, 독립 secret을 입력한다. 최초 운영은 `ENABLED_PLATFORMS=youtube`, `STAGING_FAKE_CANARY=false`, 실제 Provider로 준비한다.
2. single-server 인프라를 선택하면 `docker-compose.production-infra.yml`을 추가한다. `POSTBOT_{MYSQL,REDIS,MINIO}_IMAGE` digest와 `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`를 secret manager에 입력한다. MySQL/Redis/MinIO는 public 포트를 열지 않으며 volume을 유지한다. Redis는 AOF와 noeviction을 사용한다.
3. DNS/TLS와 S3 bucket을 준비하고, CORS는 실제 `WEB_BASE_URL` origin의 GET/HEAD만 허용한다. MinIO 단일 서버이면 storage upstream은 `minio:9000`, `S3_ENDPOINT`는 public HTTPS storage DNS다. Caddy는 서명 Host/path를 보존한다. renderer에서도 public DNS에 접근할 수 있어야 한다. bucket 생성·CORS·backup/versioning은 관리자 작업이며 preflight가 임의 생성하지 않는다.
4. `pnpm --filter @postbot/worker... build` 후 `pnpm preflight`를 수행한다. dotenv는 명령을 실행한 루트의 `.env`를 읽는다. 실제 배포에서는 secret manager가 프로세스 환경을 주입하거나 `node --env-file=<외부 환경 파일> apps/worker/dist/preflight.js`를 사용한다. 기본 검사는 네트워크/유료 호출/게시를 하지 않는다.
5. `pnpm preflight -- --network`는 DB SELECT, Redis PING, 임의 `_preflight/<UUID>` object의 upload/download/delete를 검사한다. 유료 AI/SNS를 호출하지 않지만 object storage 요청 요금은 사업자 계약에 따른다. 실패 뒤 해당 prefix의 잔여 object를 확인한다. migration DDL 권한과 browser CORS는 별도 검증한다.
6. DB backup과 checksum을 확인한다. 빈 격리 DB restore를 먼저 검증한다.
7. `node scripts/deploy-production.mjs`는 digest/env/project/Compose만 검사한다. single-server 선택 시 `--local-infra`를 붙인다. 실제 승인 후 `--apply`를 붙이면 pull→선택한 인프라→storage TLS proxy→이미지 안의 network preflight→기존 API/worker/renderer/web stop 및 drain→migration→새 API/worker/renderer/web readiness→proxy 순서로 진행한다. 실패하면 즉시 중단한다. migration 전에는 유지보수 중단 시간이 발생한다. migration 실패 뒤에는 기존 앱을 자동 재시작하지 않고 중단 상태에서 원인과 DB 상태를 확인한다. 기존 bucket·DNS/TLS는 준비되어 있어야 한다. 운영 startup에서도 preflight 설정 계약을 강제한다.
8. API `/api/health`, `/api/ready`, worker/renderer 내부 `:3002/ready`, web 및 브라우저 인증/미디어를 확인한다. worker readiness는 BullMQ 실행/일시정지 여부와 Redis PING을 검사한다. 렌더 작업이 오래 걸린다는 이유만으로 실패하지 않는다. 큐 정체·DB/storage 장애는 별도 운영 상태·알림/외부 모니터로 확인한다.
9. Fake canary는 **별도 staging**, `STAGING_FAKE_CANARY=true`, Fake AI/OAuth/analytics와 fixture로만 실행한다. 결과는 `STAGING_FAKE_CANARY`이며 production 검증 증거가 아니다. 실제 Provider smoke·비공개 YouTube 업로드는 별도 승인을 받아 체크리스트 순서로 수행한다.

렌더는 프로세스당 concurrency 1이며 일반 worker와 큐를 분리한다. 기본 renderer 메모리 상한 4GiB는 검토용 초기값이고 측정된 운영 용량이 아니다. peak RSS, 영상당 시간/임시 디스크, 동시 큐 깊이, 업로드 object 크기, 로그·DB·Redis 증가량을 staging에서 측정한다. 로그는 파일당 10MiB×5로 회전한다. 정상 임시 파일은 작업 종료 시 정리하며 프로세스 crash 뒤 render-temp의 잔여 폴더를 실행 중 작업과 대조한다. 20분 drain window 안에 완료되지 않는 작업과 서버 강제 종료는 DB job/queue 복구 절차로 다룬다. volume/백업 보존·디스크 임계 알림은 운영자 책임이다.

## 3. App rollback과 DB forward-fix

- app 오류이고 새 schema가 이전 app과 호환되면 네 이미지를 이전 digest로 되돌린다.
- `20261013010000_scope_asset_checksum` 적용 후에는 전역 checksum unique 계약을 사용하는 19.8 이전 writer로 rollback하지 않는다. channel scope를 지원하는 호환 이미지 또는 forward-fix를 사용한다.
- 적용된 migration을 파일 삭제나 수동 down SQL로 되돌리지 않는다. 데이터/호환성 문제가 있으면 쓰기를 중지하고 forward-fix migration을 검토·배포한다.
- 새 schema가 이전 app과 호환되지 않으면 app rollback을 강행하지 말고 traffic 차단 후 forward-fix한다.
- 게시 timeout이 모호하면 `PublishAttempt`, `PlatformPost`, provider status를 대조하기 전 재게시하지 않는다.

## 4. MySQL backup/restore rehearsal

복구 스크립트는 대상 DB에 테이블이 있으면 덤프를 주입하기 전에 거절한다. `ALLOW_PRODUCTION_RESTORE`는 이름 제한만 해제하며 기존 테이블 덮어쓰기를 허용하지 않는다. 새 격리 대상에서 먼저 검증한다.

기본 `MYSQL_BACKUP_MODE=docker`는 개발용 Compose MySQL만 사용하며 loopback의 명시적 3307 port 또는 Compose `mysql:3306`만 허용한다. loopback 3306/port 생략·원격 host/임의 port와 잘못된 mode 값은 실행 전에 거절한다. 다른 로컬 DB·운영·원격 DB는 MySQL client가 있는 환경에서 `MYSQL_BACKUP_MODE=direct`를 명시해야 URL의 host/port를 실제로 사용한다. 백업 metadata의 source와 실제 접속 대상을 대조한다.

```bash
pnpm backup:mysql
pnpm backup:verify -- .backups/<timestamp>.sql
RESTORE_DATABASE_URL=mysql://.../isolated_restore pnpm backup:restore -- .backups/<timestamp>.sql
```

backup은 UTC timestamp, SHA-256, byte size, source database와 tool version metadata를 포함한다. Production에서는 dump와 metadata를 KMS로 암호화해 별도 계정/버킷에 보관한다. Restore는 반드시 빈 격리 DB에서 먼저 수행하고 `_prisma_migrations`, 핵심 row count, FK, application readiness를 확인한다. 실제 마지막 성공 backup 시각을 RPO로, restore 시작부터 readiness까지를 RTO로 기록한다.

## 5. Redis/queue recovery

Redis는 source of truth가 아니다. MySQL `ProductionJob`을 기준으로 실행한다.

```bash
pnpm recover:queues
```

명령은 `QUEUED`, `RETRY_WAIT`, `QUEUE_RECOVERY_STALE_AFTER_MS`보다 오래된 `RUNNING` job만 원래 idempotency key로 재enqueue한다. 실행 전 worker를 drain하고, 실행 후 queue/job count와 중복 ProviderUsage/CostLedger/PlatformPost가 없는지 확인한다.

Redis에서 완료 작업의 키가 사라져도 MySQL에서 `SUCCEEDED`인 작업은 worker가 다시 실행하지 않는다. 재전달은 기존 결과·완료 시각·시도 횟수·비용을 유지해야 한다. Redis 재시작 검사와 완료 queue key 유실 후 재전달 검사를 별도로 수행한다.

queue/maintenance adapter와 worker의 `close`는 소유한 Redis 연결도 닫는다. 복구 CLI는 결과 출력만이 아니라 정상 exit까지 확인한다. API SIGTERM은 Nest shutdown hook으로 처리하며 worker는 진행 작업을 drain한 뒤 종료한다. 연결 생명주기 회귀는 고유 BullMQ prefix를 사용해 다른 작업과 격리한다(운영 기본 prefix는 기존 `bull` 유지).

## 6. Object storage recovery

1. `/ready`와 bucket 접근 권한을 확인한다.
2. DB의 Asset/SceneVersion render manifest key와 object inventory를 비교한다.
3. 원본/렌더 object versioning 또는 backup에서 격리 prefix로 복원한다.
4. checksum/ffprobe QA 뒤 원래 key로 승격한다.
5. 누락 파일은 기존 idempotency key로 해당 ASSET/TTS/RENDER 단계만 재실행한다.

## 7. 운영 장애

- Provider timeout/rate limit: provider switch, retry/dead-letter, CostLedger를 확인한다.
- OAuth 만료/노출: 계정을 disconnect하고 key rotation 후 재연결한다. 이전 암호화 키는 재암호화가 끝날 때까지만 `OAUTH_ENCRYPTION_PREVIOUS_KEYS`에 둔다.
- 저장소/DB/Redis: `/ready`의 dependency별 결과와 correlation ID로 범위를 좁힌다.
- 알림: 중복 억제/cooldown 상태를 확인하고 담당자가 acknowledgement를 남긴다.
- 데이터 삭제: `/operations/data-lifecycle` 요청 상태가 `SUCCEEDED`가 될 때까지 추적하고 실패 시 maintenance queue에서 재개한다.
