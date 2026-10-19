# Postbot 데이터 모델

이 문서는 2단계 MySQL 핵심 데이터 모델과 Prisma 기반의 구현 기준을 요약한다. 실제 스키마의 기준 파일은 `packages/database/prisma/schema.prisma`이고, 마이그레이션 기준은 `packages/database/prisma/migrations`이다.

## 모델 범위

2단계 핵심 모델은 다음 도메인으로 나뉜다.

| 도메인 | 모델 |
| --- | --- |
| 사용자와 워크스페이스 | `User`, `Workspace`, `Membership`, `AuthSession` |
| 채널과 운영 설정 | `Channel`, `ChannelTemplate`, `PlatformOutputProfile`, `ScheduleRule`, `CollectionRule` |
| 플랫폼 계정과 OAuth | `PlatformAccount`, `OAuthCredential`, `OAuthConnectionState` |
| 콘텐츠와 소스 | `ContentItem`, `SourceReference`, `ScriptVersion`, `SceneVersion` |
| 에셋과 라이선스 | `Asset`, `AssetSource`, `AssetLicense`, `AssetUsage` |
| 작업 오케스트레이션 | `ProductionJob`, `JobAttempt` |
| 정책 검사 | `PolicyRule`, `PolicyCheck`, `PolicySnapshot` |
| 게시 | `PublishPlan`, `PublishAttempt`, `PlatformPost` |
| 비용과 사용량 | `ProviderUsage`, `CostLedger` |
| 최적화 | `StrategyVersion`, `OptimizationSuggestion`, `Experiment` |

## 제약과 인덱스

- 모든 핵심 관계는 Prisma relation과 MySQL FK로 연결한다.
- 워크스페이스 멤버십은 `Membership(workspaceId, userId)`로 중복 가입을 막는다.
- 채널 slug는 `Channel(workspaceId, slug)`로 워크스페이스 안에서 유일하다.
- 콘텐츠 중복 수집은 `ContentItem(channelId, topicKey)`로 차단한다.
- 플랫폼 계정은 `PlatformAccount(platform, externalAccountId)`로 전역 중복 연결을 막는다.
- 채널별 플랫폼 계정은 `PlatformAccount(channelId, platform)`으로 중복 귀속을 막는다.
- 계정이 같은 워크스페이스의 채널에만 귀속되는 조건은 `PrismaPlatformAccountsRepository`와 `PrismaChannelsRepository`의 트랜잭션 조회로 보장한다.
- 작업 멱등성은 `ProductionJob.idempotencyKey`로 보장한다.
- 게시 멱등성은 `PublishPlan.idempotencyKey`, `PublishAttempt.idempotencyKey`, `PlatformPost(platform, externalPostId)`로 보장한다.

## 타입 기준

- 금액, 단가, 비율, 점수, 기간처럼 정밀도가 필요한 값은 `Decimal`과 MySQL `DECIMAL`을 사용한다.
- DB 시간 컬럼은 `DateTime @db.DateTime(3)`를 사용하며 애플리케이션에서는 UTC `Date` 값을 저장한다.
- JSON 컬럼은 provider 응답, 정책 snapshot, scene document, 스타일 설정처럼 구조가 단계별로 확장될 수 있는 값에 제한적으로 사용한다.

## 운영 스크립트

- `pnpm --filter @postbot/database exec prisma migrate dev --schema prisma/schema.prisma`
- `pnpm --filter @postbot/database db:seed`
- `pnpm --filter @postbot/database db:reset:test`
- `pnpm --filter @postbot/database test`

`db:reset:test`는 `DATABASE_URL`의 DB 이름에 `_test`를 붙인 테스트 DB를 생성하고 migration reset을 수행한다.

## 2026-10-13 자산 checksum 범위 보완

`Asset.dedupScope`는 채널 ID이며 의도적인 공통 library는 `global`이다. 실제 파일 SHA-256은 변형하지 않고 `(dedupScope, checksumSha256)` UNIQUE로 같은 채널의 중복만 제거한다. migration `20261013010000_scope_asset_checksum`은 기존 행의 channelId로 범위를 채우고 기존 자산/사용/증빙 참조를 보존한다. 과거 전역 중복 제거로 다른 채널 소유 자산을 참조한 이력은 자동으로 권리 승인하지 않는다. 게시 gate에서 소유권을 거절하며 운영 전에 해당 참조를 검사하고 해당 채널의 독립 에셋/증빙으로 재등록한다.
