# 배포·백업·복구 Runbook

## 1. Release artifact

1. 검증할 commit SHA를 고정한다.
2. `docker build --build-arg APP=<api|worker|renderer|web> -t <registry>/postbot-<app>:<sha> .`로 네 이미지를 build한다.
3. filesystem/secret/dependency scan과 네 image scan이 모두 통과해야 push한다.
4. staging과 production은 tag를 다시 build하지 않고 같은 digest를 승격한다. 배포 대상/registry가 확정되지 않은 동안에는 이 계약만 유지한다.

Node.js 24 LTS 공식 이미지에서 빌드하고 같은 Node 바이너리를 Ubuntu 26.04 LTS runtime에서 사용한다. API·web은 미디어 실행 의존성을 포함하지 않고, worker·renderer만 FFmpeg/Chromium/CJK 폰트를 포함한다. runtime 취약점은 패치 가능 여부뿐 아니라 미패치 항목의 영향도도 별도로 확인한다. `--ignore-unfixed` 통과를 전체 CVE 0건으로 표현하지 않는다.

## 2. 배포 순서

운영 설정 계약: `APP_ENV=staging|production`에서는 JWT access/refresh 및 OAuth 암호화 비밀값이 각각 32자 이상이어야 하며 공개된 local/test/예제 placeholder는 시작 시 거절한다. JWT access/refresh 값은 서로 달라야 한다. 운영자는 secret manager에서 독립적으로 생성·주입한다.

웹 이미지는 시작 시 `PUBLIC_API_BASE_URL`을 `/runtime-config.js`에 주입하므로 같은 digest로 staging/production 주소를 바꿀 수 있다. 이 값은 브라우저에 공개되는 HTTP(S) API 주소만 허용하며 자격 증명/query/hash는 거절한다. production에서는 설정이 필수다. API의 `WEB_BASE_URL`/CORS 허용 origin을 실제 웹 주소와 맞추고 HTTPS 및 같은 site의 웹/API 도메인 또는 동일 origin reverse proxy를 사용한다(SameSite=Lax 인증 쿠키). 서로 다른 site의 배포는 이 계약에 포함되지 않는다. `GET /auth/me`의 CSRF 값은 웹 메모리에만 유지하며 API host의 쿠키를 웹에서 직접 읽을 필요가 없다. runtime 설정에는 비밀값을 넣지 않는다.

1. secret manager에서 `.env.example`과 동일한 키를 주입한다. 실제 값은 env 파일이나 image layer에 저장하지 않는다.
2. DB backup과 checksum metadata를 생성한다: `pnpm backup:mysql` 후 `pnpm backup:verify -- <dump.sql>`.
3. `docker compose -f docker-compose.production.yml run --rm migrate`를 단 한 번 성공시킨다.
4. API, worker, renderer, web 순으로 rollout한다.
5. API `/health`와 `/ready`, worker 시작 로그, renderer `ffmpeg -version`, web HTTP health를 확인한다.
6. Fake canary 또는 승인된 실제 provider smoke를 실행하고 correlation ID, job ID, artifact digest를 배포 기록에 남긴다.

## 3. App rollback과 DB forward-fix

- app 오류이고 새 schema가 이전 app과 호환되면 네 이미지를 이전 digest로 되돌린다.
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
