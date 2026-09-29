# Postbot v1 요구사항 추적성

기준일: 2026-09-29. `PASS`는 저장소 내부 구현과 Fake/local 검증의 통과를 뜻한다. 실제 사업자 계정, 앱 심사 또는 production 인프라가 필요한 항목은 내부 계약이 통과했더라도 `EXTERNAL_VERIFICATION_PENDING`으로 분리한다.

| Requirement ID | Requirement | Implementation | API | DB | Test | Status | External Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-01 | 세션, CSRF, workspace 격리 | `apps/api/src/auth`, workspace guards | `/auth/*` | User, Workspace, RefreshToken | auth/channels/release E2E | PASS | 없음 |
| CHANNEL-01 | 채널, 수집·템플릿·출력·예약 설정 | channels module/contracts | `/channels` | Channel 및 versioned rules | channels E2E, Playwright | PASS | 없음 |
| SOURCE-01 | RSS/Atom/공식 URL 수집, 정규화, dedupe, 필터 | `RssTopicSourceProvider` | `/ideas/collect` | ContentIdea, SourceReference | RSS contract, release E2E | PASS | 운영 feed 허용 조건 확인 |
| GEN-01 | 실제 stage output 기반 script/scene 생성 | generation + worker processor | `/generation/script-scene`, `/jobs` | ScriptVersion, SceneVersion, ProductionJob | worker integration, release E2E | PASS | OpenAI smoke pending |
| ASSET-01 | 이미지·TTS 자산, license/usage/cost 추적 | asset library, provider factory | `/jobs` | Asset, AssetLicense, AssetUsage, ProviderUsage, CostLedger | provider/asset integration | PASS | Google Image/ElevenLabs smoke pending |
| TTS-01 | 실제 음성 alignment와 deterministic Fake WAV | ElevenLabs/Fake TTS providers | worker job | Asset metadata | TTS unit/contract | PASS | ElevenLabs smoke pending |
| RENDER-01 | 1080x1920, audio/caption/safe-area/black-frame/ffprobe QA | renderer + RenderProcessor | `/jobs` | SceneVersion.renderManifest | renderer unit/integration/smoke | PASS | production host capacity pending |
| POLICY-01 | fact-source, 신뢰도, 충돌, 권리, 독창성, 민감 주제, AI disclosure | policy engine + PolicyProcessor | review policy check | PolicyRule/Check/Snapshot | policy unit, review/release E2E | PASS | 플랫폼 정책 운영 검토 지속 필요 |
| REVIEW-01 | 플랫폼 탭, preview, metadata/version/regenerate/approve/hold/discard/schedule | web review panel + review API | `/content/:id/review*` | ContentItem 및 versions | review E2E/unit, Playwright | PASS | 없음 |
| AUTO-01 | COLLECT→SCRIPT→ASSET→TTS→RENDER→POLICY→PUBLISH | AutomationService + processors | `/automation/*` | AutomationRun/Step/Event | automation integration, release E2E | PASS | 없음 |
| AUTO-02 | 단계·queue·run 멱등성, 실패 단계 재개, worker recovery | semantic idempotency + recovery command | `/jobs/:id/recover`, control API | unique idempotency keys | duplicate/retry/recovery tests | PASS | 없음 |
| AUTO-03 | APPROVAL/FULL_AUTO 분리 및 gate 우회 방지 | automation publish preparation | review/control APIs | immutable policy snapshot | two-path release E2E | PASS | 없음 |
| BUDGET-01 | DECIMAL 비용 예약, hard-limit fail-closed | automation safety | `/automation/budgets` | Reservation, Budget, CostLedger | automation safety tests | PASS | 실제 provider 단가 대사 pending |
| PUBLISH-01 | PublishPlan 없이는 게시 불가, ambiguous timeout 중복 방지 | publishing + PublishProcessor | `/publishing/plans` | PublishPlan/Attempt/PlatformPost | publisher/worker/release E2E | PASS | 실제 플랫폼 smoke pending |
| OAUTH-YT-01 | YouTube OAuth/refresh/scope/revoke | Google publisher provider | YouTube connect/callback/disconnect | PlatformAccount/Credential/State | OAuth/service/provider tests | EXTERNAL_VERIFICATION_PENDING | Google app와 credential 필요 |
| OAUTH-IG-01 | Instagram OAuth/profile/token lifecycle | Meta provider | Instagram connect/callback/disconnect | 동일 | provider contract | EXTERNAL_VERIFICATION_PENDING | Meta 앱 심사·계정 필요 |
| PUBLISH-IG-01 | Instagram container publish와 상태 polling | Meta provider | worker publish | PublishAttempt/Post | provider contract | EXTERNAL_VERIFICATION_PENDING | Content Publishing 권한 필요 |
| OAUTH-TT-01 | TikTok OAuth/refresh/scope lifecycle | TikTok provider | TikTok connect/callback/disconnect | 동일 | provider contract | EXTERNAL_VERIFICATION_PENDING | TikTok 앱 심사 필요 |
| PUBLISH-TT-01 | TikTok Direct Post와 상태 polling | TikTok provider | worker publish | PublishAttempt/Post | provider contract | EXTERNAL_VERIFICATION_PENDING | `video.publish` 승인 필요 |
| ANALYTICS-01 | 플랫폼 factory, pagination, raw/normalized, unavailable≠0, revision/backfill | analytics providers + processor | `/analytics/sync`, `/analytics/report` | AnalyticsSync/RawSnapshot/MetricSnapshot | provider/API/release E2E | PASS | 실제 플랫폼별 smoke pending |
| OPT-01 | 표본·근거가 있는 최적화 제안 | optimization service | `/optimization/suggestions/*` | Suggestion/Strategy/Experiment | unit + release E2E | PASS | 없음 |
| OPS-01 | correlation, redaction, Sentry no-op, audit, 알림 dedupe/ack | logger/API/operations | `/operations/*`, `/health`, `/ready` | AuditLog/Notification | API/operations tests | PASS | Sentry DSN smoke pending |
| OPS-02 | DB/Redis/storage readiness, headers, CORS, rate limit | API bootstrap/readiness | `/health`, `/ready` | 해당 없음 | API/Docker health/security tests | PASS | production ingress 확인 |
| DATA-01 | 비동기 retention/workspace/user 및 object 삭제 | maintenance queue + DataLifecycleProcessor | `/operations/data-lifecycle*` | DataLifecycleRequest | DB integration | PASS | production 보존기간 승인 |
| RECOVERY-01 | MySQL backup/checksum/restore와 Redis queue 복구 | `scripts/*mysql*`, `recover-queues.ts` | 해당 없음 | migration/job tables | local rehearsal | PASS | 암호화 원격 저장소·RPO/RTO pending |
| DEPLOY-01 | web/api/worker/renderer production image, non-root, healthcheck | Dockerfile + production Compose | health endpoints | migrate service | Docker acceptance | PASS | registry/cluster 계약 pending |
| CI-01 | lint/type/test/build/E2E/migration/Docker/security scan | CI/security workflows | 해당 없음 | CI MySQL | workflow definitions + local parity | PASS | GitHub-hosted 실제 run 확인 |
| PERF-01 | REST/scheduler/queue/SSE/analytics/worker/renderer baseline | `scripts/local-performance-baseline.mjs` + instrumented release E2E | 실제 API | 실제 local DB | `pnpm baseline:local` | PASS | production capacity test pending |

명세상 v1 제외 항목인 팀 초대, 결제/SaaS, 모바일 앱, 롱폼, 댓글 자동 응답, 자유 편집기 및 인과 추론은 `OUT_OF_SCOPE`이다.
