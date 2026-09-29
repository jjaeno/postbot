# 배포·백업·복구 Runbook

## 1. Release artifact

1. 검증할 commit SHA를 고정한다.
2. `docker build --build-arg APP=<api|worker|renderer|web> -t <registry>/postbot-<app>:<sha> .`로 네 이미지를 build한다.
3. filesystem/secret/dependency scan과 네 image scan이 모두 통과해야 push한다.
4. staging과 production은 tag를 다시 build하지 않고 같은 digest를 승격한다. 배포 대상/registry가 확정되지 않은 동안에는 이 계약만 유지한다.

## 2. 배포 순서

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
