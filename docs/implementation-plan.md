# Postbot 구현 계획

이 문서는 Postbot v1의 **단계별 구현 범위와 완료 조건에 대한 실행 기준(Source of Truth)** 이다.

공통 저장소 규칙은 루트 `AGENTS.md`, 확정된 기술 결정은 `docs/architecture-decisions.md`를 따른다.

상세 기능 요구사항 또는 기술 사양이 필요한 경우에만 다음 문서를 확인한다.

* `docs/Postbot_기능_UX_명세서_v0.2.docx`
* `docs/Postbot_v1_기술_스택_확정서.docx`

`docs/Postbot_Codex_전체_개발_프롬프트.md`는 전체 개발 로드맵 참고용이며 개별 단계 실행 시 전체를 읽지 않는다.

## 단계 실행 원칙

* 현재 단계만 수행한다.
* 이전 단계에서 제공된 공개 인터페이스를 사용하되 다음 단계 기능을 선행 구현하지 않는다.
* 각 단계의 필수 검증이 성공한 경우에만 지정된 메시지로 커밋한다.
* 외부 API 키 또는 계정이 없어 수행할 수 없는 검증은 Fake Provider 검증과 실제 검증 대기 상태를 구분한다.
* 단계 완료 여부는 코드 존재가 아니라 완료 조건과 검증 결과로 판단한다.
* 현재 체크아웃 브랜치와 저장소 기본 브랜치를 먼저 확인하고, 실제 코드가 존재하는 브랜치를 기준으로 작업한다.
* 문서의 완료 표시만 신뢰하지 않고 코드, migration, 테스트, 커밋을 함께 확인한다.
* 이전 단계의 결함이 현재 단계를 막으면 영향 범위를 먼저 보고하고 현재 단계에 필요한 최소 호환 수정만 수행한다.
* 외부 API 키가 없을 때 Fake Provider 검증과 실제 Provider 검증 대기 상태를 명확히 구분한다.
* 완료 보고에는 변경 파일, 상태 전이, 멱등성·동시성 처리, 실행·미실행 검증과 남은 위험을 포함한다.

### 단계 시작 전 확인

* 재사용할 기존 interface, schema, model
* 생성·수정할 주요 파일
* DB migration 필요 여부
* job 상태 전이와 idempotency 전략
* Fake Provider와 실제 Provider 검증 범위

---

## 현재 진행 상태

### 19.8 후속 — 출시 전 내부 동시성·프록시·CI 보완 (2026-10-20)

상태: 요청 범위 로컬 필수 검증 완료 — PASS_WITH_EXTERNAL_VERIFICATION_PENDING. 범위는 refresh 원자성/logout 경합, 신규 workspace slug, Caddy 요청 식별, 배포 테스트 CI 연결/별도 실제 renderer smoke, 최신 인수 문서다. 새 기능·TikTok Direct Post 재활성화·실 유료 호출·실 게시·운영 배포는 제외했다. 검증과 미실행 사유는 `docs/release-internal-remediation-2026-10-20.md`를 기준으로 하고, 아래 19.8 완료 표시는 과거 기록으로 구분한다. 새 커밋의 원격 CI/security 및 실환경 검증은 대기이며 운영 준비 완료나 내부 blocker 0을 선언하지 않는다. 커밋 메시지는 기존 19.8 메시지를 유지한다.

### 19.8단계 — 실제 서비스 운영 준비 보완 (2026-10-13)

상태: 내부 구현·필수 검증 완료 — PASS_WITH_EXTERNAL_VERIFICATION_PENDING. 운영 준비 보완과 검증 증거·외부 조건은 `docs/production-readiness-2026-10-13.md`에 기록한다. 실제 유료 호출·SNS 게시·운영 배포·원격 CI/security 완료를 뜻하지 않는다.

범위: 설정/네트워크 preflight, 활성 플랫폼 격리 및 Fake canary 구분, 실제 AI REST 계약·미디어 검증, 유료 호출 journal·원장 실패/취소 비용 예약 보호, SNS 권한·게시 성공 후 DB 실패/중복 게시 안전장치, TikTok Direct Post 보류, digest 배포/HTTPS/secret 주입, worker readiness·web SIGTERM 종료, 권리 승인 경로·채널별 자산 checksum migration 점검과 사용자 설정 체크리스트.

필수 내부 검증: 변경 app/package lint·typecheck·unit·build, 격리 MySQL/Redis/S3 통합 회귀(예산·멱등성·권리 재개·worker lifecycle), production Compose 설정, 변경 production 이미지 build, Fake acceptance 및 renderer smoke, 브라우저 핵심 Playwright, backup checksum/빈 격리 DB 복원. 실행 불가 검증은 BLOCKED 또는 NOT_RUN으로 기록하고 성공으로 간주하지 않는다. 외부 Provider/SNS·운영 배포·최종 커밋 CI/security는 자격 증명·승인·서버·원격 push 조건을 분리해 보고한다.

Commit: `fix: 실제 서비스 운영 준비와 안전 검증 보완`

| 단계   | 내용              | 상태    |
| ---- | --------------- | ----- |
| 0    | 저장소 분석 및 개발 계획  | 완료    |
| 1    | 모노레포와 로컬 인프라    | 완료    |
| 2    | MySQL 핵심 데이터 모델 | 완료    |
| 3    | 인증·사용자·보안       | 완료    |
| 4    | 채널·템플릿·일정       | 완료    |
| 5    | SNS OAuth 기반과 YouTube 연결 | 완료    |
| 6    | BullMQ 작업 오케스트레이션과 진행 상태 | 완료    |
| 7    | 소재 자동 수집과 아이디어 관리 | 완료    |
| 8    | GPT 기반 대본·Scene JSON 생성 | 완료 |
| 8.5  | 생성 비동기화·실제 LLM 연동 | 완료 (실제 OpenAI 키 검증 대기) |
| 9    | Asset Library·이미지·TTS 파이프라인 | 완료 (실제 Image/TTS Provider 키 검증 대기) |
| 10   | Remotion·FFmpeg 영상 렌더러 | 완료 |
| 11   | 정책 검사·검수·승인 UX | 완료 |
| 12   | 대시보드·캘린더·운영 UX | 완료 |
| 13   | 예약·YouTube Shorts 업로드 | 완료 (실제 YouTube 자격 증명 검증 대기) |
| 14   | Instagram Reels·TikTok 게시 확장 | 완료 (실제 앱 심사·자격 증명 검증 대기) |
| 15   | 완전 자동 운영과 안전장치 | 완료 |
| 16   | 성과 데이터 수집과 분석 | 완료 |
| 17   | 성공 패턴 추출과 콘텐츠 최적화 | 완료 |
| 18   | 비용·알림·관측성·보안 강화 | 완료 |
| 19   | 전체 회귀·배포 준비·v1 판정 | 완료 |

# 0단계. 저장소 분석 및 개발 계획 고정

**상태:** 완료

### 범위

* 기능 요구사항 도메인 분류
* v1 포함/제외 범위 정의
* 핵심 엔터티와 상태 흐름 정리
* 앱·패키지 경계 결정
* 전체 구현 단계 정의
* 초기 ADR과 저장소 작업 규칙 작성

### 완료 조건

* 요구사항이 구현 단계에 매핑되어 있다.
* 미결정 사항과 외부 API 제약이 기록되어 있다.
* 애플리케이션 코드를 생성하지 않는다.

### Commit

`docs: Postbot 구현 계획과 개발 규칙 정리`

---

# 1단계. 모노레포와 로컬 인프라 구축

**상태:** 완료

### 범위

* pnpm workspace + Turborepo
* `apps/web`, `apps/api`, `apps/worker`, `apps/renderer`
* 공통 packages
* React/Vite, NestJS, Remotion 기본 구성
* MySQL 8, Redis, MinIO Docker Compose
* ESLint, Prettier, TypeScript strict
* 환경 변수 Zod 검증
* `/health`
* 루트 dev/build/lint/typecheck/test 명령
* README 로컬 실행법

### 제외

비즈니스 기능.

### 필수 검증

* pnpm install
* Docker healthcheck
* 각 앱 실행
* lint
* typecheck
* test
* build

### Commit

`chore: Postbot 모노레포와 로컬 인프라 구축`

---

# 2단계. MySQL 핵심 데이터 모델과 Prisma 기반 구축

**상태:** 완료

### 범위

핵심 모델:

* User, Workspace, Membership
* Channel, PlatformAccount, OAuthCredential
* ChannelTemplate, PlatformOutputProfile, ScheduleRule
* ContentItem, SourceReference, ScriptVersion, SceneVersion
* Asset, AssetSource, AssetLicense, AssetUsage
* ProductionJob, JobAttempt
* PolicyRule, PolicyCheck, PolicySnapshot
* PublishPlan, PublishAttempt, PlatformPost
* ProviderUsage, CostLedger
* StrategyVersion, OptimizationSuggestion, Experiment

추가:

* Prisma schema + 최초 migration
* FK, UNIQUE, 주요 index
* UTC
* DECIMAL
* 제한적인 JSON 사용
* 계정-채널 귀속 제약
* 게시 및 작업 멱등성 제약
* seed
* 테스트 DB reset
* transaction helper
* `docs/data-model.md`

### 필수 검증

* 빈 DB migration
* seed
* reset
* FK
* UNIQUE
* DECIMAL
* UTC
* idempotency 관련 통합 테스트

### Commit

`feat: Postbot 핵심 데이터 모델과 마이그레이션 구현`

---

# 3단계. 인증·사용자·보안 기반

**상태:** 완료

### 범위

* 회원가입
* 로그인 / 로그아웃
* 세션 갱신
* 내 정보 조회
* 비밀번호 해싱
* access/refresh token
* refresh token rotation 및 reuse detection
* HttpOnly/Secure/SameSite cookie
* CSRF 방어
* 기본 rate limit
* 사용자/workspace guard
* 로그인·회원가입 UI
* 세션 복구
* protected route
* 인증 만료 UX

### 제외

SNS OAuth 및 플랫폼 계정 연결.

### 필수 검증

* 정상 인증
* 잘못된 비밀번호
* token expiry/refresh
* logout
* refresh token reuse 차단
* 타 사용자 리소스 접근 차단
* 민감 정보 로그 유출 검사

### Commit

`feat: 사용자 인증과 보안 세션 구현`

---

# 4단계. 채널·템플릿·일정 설정 Vertical Slice

**상태:** 완료

### 범위

* Channel CRUD
* pause/resume
* 주제·시청자·언어
* 영상 템플릿
* 플랫폼별 출력 프로필
* 수집 규칙
* 게시 일정
* 최소 콘텐츠 재고
* 승인형 / 완전 자동형 설정
* 자동화 안전 설정
* 8단계 채널 생성 마법사
* 설정 수정
* OAuth 미구현 플랫폼은 `연결 예정`

### 제외

실제 SNS 계정 연결 및 업로드.

### 필수 검증

* API unit/integration
* 마법사 Playwright
* 잘못된 일정
* 계정 중복 귀속
* 권한 위반

### Commit

`feat: 채널 생성 마법사와 운영 설정 구현`

---

# 5단계. SNS OAuth 기반과 YouTube 연결

**상태:** 완료

### 범위

* PublisherProvider 공통 계약
* OAuth state/PKCE/callback/scope
* OAuth credential 암호화
* 암호화 키 버전
* YouTube 계정 연결
* YouTube 채널 정보 조회
* 연결 상태 / 만료 / scope 부족
* 재연결 / 연결 해제 UX
* 플랫폼 계정 중복 귀속 방지
* Fake OAuth provider

### 제외

영상 업로드.

### 필수 검증

* state 위조
* callback 재사용
* token 암복호화
* scope 부족
* 연결 해제
* Fake Provider Playwright

### Commit

`feat: SNS OAuth 기반과 YouTube 계정 연결 구현`

---

# 6단계. BullMQ 작업 오케스트레이션과 진행 상태

**상태:** 완료

### 범위

* collect/script/asset/tts/render/policy/publish/analytics queue
* 작업 상태 전이
* JobAttempt
* retry/backoff/timeout
* dead-letter 또는 수동 복구
* idempotency
* API 즉시 job ID 반환
* SSE 진행 이벤트
* REST 상태 복구
* cancel
* deterministic test worker
* `docs/job-system.md`

### 필수 검증

성공, retry 성공, 영구 실패, 중복 요청, 취소, worker 재시작, SSE 재연결, 권한 검사.

### Commit

`feat: 비동기 작업 엔진과 진행 상태 구현`

---

# 7단계. 소재 자동 수집과 아이디어 관리

**상태:** 완료

### 범위

* TopicSourceProvider
* RSS / 공식 URL / 허용 공개 소스
* URL canonicalization
* content hash
* 중복 제거
* 적합성 / 최신성 / 출처 신뢰도 / 예상 시청 가치
* 금지 주제 / 제외 키워드
* candidate / shortlisted / rejected / used / expired
* 아이디어 관리 UI
* 자동/수동 수집
* fixture source

### 필수 검증

중복 제거, 출처 실패, 금지 주제, 채널 분리, retry/idempotency, API/E2E.

### Commit

`feat: 소재 자동 수집과 아이디어 관리 구현`

---

# 8단계. GPT 기반 대본·Scene JSON 생성

**상태:** 완료

### 현재 구현 상태

* Fake LLM 기반 구조화 생성, SceneDocument 검증, 버전·사용량·비용 저장은 구현되어 있다.
* 실제 OpenAI Provider는 아직 외부 호출을 수행하지 않는다.
* 생성 요청이 BullMQ SCRIPT job이 아니라 API 요청 안에서 동기 실행된다.
* partial 값은 전달되지만 기존 버전의 미수정 영역을 보존하는 병합 로직이 없다.
* 동시 요청 시 version·idempotency 경쟁 조건과 생성 API E2E를 보완해야 한다.

### 범위

* LLMProvider + OpenAI/Fake
* 모델 환경 설정 주입
* 공통 기획
* Hook / 대본 / 메타데이터
* 사실-출처 연결
* SceneDocument
* versioned Zod/JSON Schema
* Structured Output 검증
* ScriptVersion / SceneVersion
* prompt/model/token/cost 기록
* 부분 재생성

### 제외

이미지, TTS, 실제 렌더링.

### 필수 검증

deterministic Fake snapshot, 잘못된 JSON, 누락 출처, 길이 초과, retry, 중복 요청.

### Commit

`feat: 대본과 Scene JSON 생성 파이프라인 구현`

---

# 8.5단계. 대본·Scene 생성 파이프라인 완성 및 비동기 전환

**상태:** 완료 (실제 OpenAI 키 검증 대기)

### 목표

8단계의 Fake 기반 동기 생성 코드를 실제 운영 가능한 SCRIPT 작업 파이프라인으로 완성한다. 9단계 기능은 구현하지 않는다.

### 범위

* POST /generation/script-scene을 BullMQ SCRIPT job 생성 방식으로 변경
* API는 LLM을 직접 호출하지 않고 job ID와 상태 조회 정보를 즉시 반환
* worker에 SCRIPT job processor 구현
* FakeLlmProvider 유지
* 실제 OpenAI Provider와 Structured Output 또는 JSON Schema 기반 출력 검증
* 모델, API key, timeout, retry 설정의 환경 변수 주입
* hook/body/metadata/scene 부분 재생성 시 이전 버전의 미수정 영역 보존
* ScriptVersion·SceneVersion 생성의 동시성 안전성 보장
* idempotency key 동시 요청 경쟁 조건 처리
* ProviderUsage와 CostLedger 연결 및 중복 비용 기록 방지
* 실패·취소 시 ContentItem, ContentIdea, ProductionJob 상태 일관성 유지
* SCRIPT job 진행률을 SSE와 REST에서 조회
* 생성 요청의 CSRF, workspace, idea 소유권 검증
* README, OpenAPI, generation-system 문서 동기화

### 제외

이미지, TTS, Asset Library, 영상 렌더링, 정책 승인 UX.

### 필수 검증

* Fake Provider API → BullMQ → worker → DB 저장 E2E
* API 요청 중 LLM 직접 호출이 실행되지 않음
* 중복 요청이 하나의 논리적 결과와 비용 기록만 생성
* 동시 요청 시 version 충돌 없음
* 부분 재생성 시 선택하지 않은 필드 보존
* 잘못된 JSON, 누락 출처, 길이 초과, timeout, retry, 취소
* CSRF, workspace, idea 권한
* 관련 lint, typecheck, unit, integration, E2E
* 실제 OpenAI 키가 없으면 실제 Provider 검증을 완료로 표시하지 않고 필요한 환경을 기록

### Commit

`fix: 대본 생성 파이프라인 비동기화 및 실제 LLM 연동`

---
# 9단계. Asset Library·이미지·TTS 파이프라인

**상태:** 완료 (실제 Image/TTS Provider 키 검증 대기)

### 구현 순서

#### 9A. Storage Provider와 Asset 도메인

* S3/MinIO Storage Provider와 Fake Provider
* upload/download/delete/presigned URL
* Asset, AssetSource, AssetLicense, AssetUsage repository
* checksum 기반 중복 처리와 storage contract test

#### 9B. 이미지와 내부 Asset Library

* Image Provider와 Fake Provider
* 설정으로 주입되는 실제 이미지 Provider
* 내부 라이선스 허용 Asset Library
* 이미지 생성 실패 시 허용 asset fallback
* 프롬프트, 모델, 출처, 상업 이용, 라이선스 snapshot
* 권리 불명확 시 NEEDS_REVIEW

#### 9C. TTS와 오디오 자산

* TTS Provider와 Fake Provider
* 설정으로 주입되는 실제 TTS Provider
* 음성 파일과 word/sentence timing
* BGM/SFX 선택과 라이선스 snapshot
* ProviderUsage와 CostLedger

### 필수 검증

storage contract, fallback, checksum 동시 중복, 라이선스 차단, TTS timing, 비용 멱등성, Provider 실패·재시도.

### Commit

`feat: 이미지 음성 자산 준비 파이프라인 구현`

---

# 10단계. Remotion·FFmpeg 영상 렌더러

**상태:** 완료

### 구현 순서

#### 10A. Remotion Scene 렌더러

* SceneDocument 버전별 composition
* 1080x1920, safe area, fps/duration
* TTS timing 기반 animated captions
* 이미지 zoom/pan/transition
* scene/frame 계산 unit test
* 15초/60초 fixture

#### 10B. FFmpeg와 RENDER 작업 오케스트레이션

* RENDER BullMQ processor
* BGM/SFX ducking과 FFmpeg 후처리
* job별 임시 폴더 격리와 정리
* progress/timeout/cancel/retry/idempotency
* MP4, thumbnail, manifest 생성과 Storage Provider 업로드
* renderer/schema version 저장
* ffprobe 기반 자동 QA

### 필수 검증

15초/60초 fixture, scene frame 검증, 동일 입력 재실행.

### Commit

`feat: Remotion 기반 숏폼 렌더링 엔진 구현`

---

# 11단계. 정책 검사·검수·승인 UX

**상태:** 완료

### 구현 순서

#### 11A. Versioned Policy Engine

* 사실·출처, asset license, AI disclosure
* 반복·저가치·재사용 위험
* 플랫폼 형식과 메타데이터
* platform, region, effectiveAt, checkedAt, version
* block, warning, review, pass 결과
* immutable PolicySnapshot과 게시 gate

#### 11B. 검수·승인 UX

* 콘텐츠 미리보기와 정책·출처·권리 표시
* 수정과 부분 재생성
* 승인, 예약, 보류, 폐기
* REVIEW_REQUIRED → APPROVED → SCHEDULED 상태 전이
* workspace 권한

### 필수 검증

정책 결과, 상태 전이, 권한, 자동 게시 차단, E2E.

### Commit

`feat: 콘텐츠 정책 검사와 승인 워크플로 구현`

---

# 12단계. 대시보드·캘린더·운영 UX

**상태:** 완료

### 범위

홈, 채널, 아이디어, 콘텐츠, 캘린더, 계정, 사용량·설정 화면과 운영 UX.

### 핵심 사용자 여정

로그인 → 채널 생성 → 수집 → 아이디어 선택 → 생성 → 자산 준비 → 렌더 → 검수 → 승인 → 캘린더 예약.

### 필수 검증

* 핵심 Playwright 사용자 여정
* loading, empty, error, permission, retry
* URL 직접 접근과 새로고침 시 상태 복구
* SSE 단절 시 REST 상태 복구
* 모바일 최소 지원 범위와 데스크톱 기준 해상도 확인

### Commit

`feat: Postbot 운영 대시보드와 캘린더 완성`

---

# 13단계. 예약·YouTube Shorts 업로드

**상태:** 완료 (실제 YouTube 자격 증명 검증 대기)

### 구현 순서

#### 13A. 예약 scheduler와 Fake Publisher

* 빈 슬롯 계산과 예약 scheduler
* BullMQ publish
* 게시 직전 정책, 계정, 파일 재검사
* PublishPlan, PublishAttempt
* publish idempotency와 ambiguous timeout 복구
* 실패, 재시도, 수동 복구
* Fake Publisher 전체 E2E

#### 13B. 실제 YouTube Shorts 게시

* resumable upload
* metadata, privacy, scheduledAt
* token refresh와 scope 오류
* 외부 video ID, URL, 게시 시각과 status 저장
* 중복 업로드 방지
* 실제 자격 증명 검증 체크리스트

### 필수 검증

Fake Publisher E2E, 중복 요청, worker restart, token expiry, 정책 변경, ambiguous timeout.

### Commit

`feat: YouTube Shorts 예약 게시 파이프라인 구현`

---

# 14단계. Instagram Reels·TikTok 게시 확장

**상태:** 완료 (실제 Instagram/TikTok 앱 심사·자격 증명 검증 대기)

### 구현 순서

#### 14A. Instagram Reels

Instagram OAuth, validate/publish/status, 출력 프로필, 정책, 메타데이터, 게시 시각.

#### 14B. TikTok

TikTok OAuth, validate/publish/status, 출력 프로필, 정책, 메타데이터, 게시 시각.

공식 API 제공 범위, 앱 심사, 테스트 모드 제한, 최소 scope와 확인일을 문서화한다. Fake Provider 성공만으로 실제 플랫폼 연동 완료를 선언하지 않는다.

### 필수 검증

플랫폼별 Publisher contract, 독립 실패, 중복 게시, token 만료, scope 부족, ambiguous timeout.

### Commit

`feat: Instagram과 TikTok 게시 연동 확장`

---

# 15단계. 완전 자동 운영과 안전장치

**상태:** 완료

### 목표

채널별 자동화 설정에 따라 수집부터 게시까지 전체 파이프라인을 지속적으로 실행하되, 중복 실행·무한 재시도·예산 초과·정책 우회를 방지하고 장애 후 안전하게 복구할 수 있게 한다.

### 구현 순서

#### 15A. 자동화 실행 계획과 상태 모델

* 채널별 자동화 실행 단위와 단계별 상태를 영속화한다.
* 수집 → 아이디어 선정 → 대본 → 자산 → TTS → 렌더 → 정책 → 예약 → 게시 작업을 기존 BullMQ queue와 공개 interface로 연결한다.
* scheduler 기반 주기 실행과 운영자 수동 실행을 제공한다.
* 동일 채널·실행 구간의 중복 실행을 분산 락과 DB UNIQUE/idempotency 제약으로 방지한다.
* 완료된 단계 결과는 재사용하고 실패·중단된 단계부터 재개한다.
* worker 재시작과 Redis 재연결 후에도 MySQL의 업무 상태를 기준으로 복구한다.
* 실행 이력, 단계별 시도, 실패 원인, 마지막 heartbeat와 다음 실행 시각을 조회할 수 있게 한다.

#### 15B. 콘텐츠 재고와 자동 예약

* 채널별 최소 재고와 목표 게시량을 기준으로 부족 수량만 계산한다.
* 생성 중, 검수 대기, 승인, 예약 상태를 구분해 재고를 중복 계산하지 않는다.
* 빈 게시 슬롯과 플랫폼별 출력 프로필을 반영해 예약한다.
* 동일 소재·유사 콘텐츠의 반복 생성을 차단하고 재생성 횟수 상한을 적용한다.
* 강제 검수 주제, 권리 불명, 정책 BLOCK/REVIEW 결과는 완전 자동형에서도 게시하지 않는다.
* 게시 슬롯 또는 유효한 플랫폼 계정이 없으면 불필요한 생성 비용을 쓰지 않고 보류한다.
* 승인형과 완전 자동형의 상태 전이 및 자동 예약 조건을 분리한다.

#### 15C. 예산과 비용 실행 제어

* workspace·채널별 일간/월간 예산과 soft/hard limit을 적용한다.
* 비용 발생 작업 시작 전에 예상 비용을 원자적으로 예약하고, 완료 후 실제 비용을 확정·정산한다.
* 실패·취소된 작업의 미사용 예약 비용을 해제한다.
* 동시 worker가 동일 예산을 초과 사용하지 않도록 transaction 또는 원자적 갱신을 사용한다.
* hard limit에서는 신규 생성 작업을 차단하되 이미 예약된 게시의 처리 정책은 별도로 적용한다.
* 비용을 확인할 수 없거나 원장이 불일치하면 fail-open하지 않고 보류한다.

#### 15D. 실패·폭주 방지와 복구

* 단계별 retry/backoff/timeout과 콘텐츠별 최대 재생성 횟수를 적용한다.
* 동일 원인의 연속 실패와 poison job을 감지해 격리한다.
* 채널·Provider별 연속 실패 임계치를 넘으면 자동 pause하고 원인을 기록한다.
* circuit breaker로 장애 Provider를 일시 차단하되 영향받지 않는 채널과 Provider는 계속 운영한다.
* 중복 queue delivery와 scheduler 재실행에도 결과·비용·예약·게시가 중복되지 않게 한다.
* 게시 결과가 불명확한 timeout은 외부 상태 확인 전 재업로드하지 않는다.
* 자동화의 생성→실패→재생성 무한 순환을 방지한다.

#### 15E. 운영 제어와 UX

* 채널 pause/resume, workspace 전체 kill switch, Provider별 kill switch를 제공한다.
* 신규 작업만 막는 graceful pause와 대기 작업까지 중단하는 즉시 중지를 구분한다.
* queue drain 시 진행 중 작업의 완료·취소 정책을 명시한다.
* 실패 단계 재시도, 보류, 스킵, 취소, 재개 API와 권한 검사를 구현한다.
* 운영 화면에서 자동화 상태, 다음 실행, 재고, 예산, 연속 실패와 중단 원인을 확인한다.
* pause/resume/kill switch와 수동 복구 조작을 감사 가능한 이력으로 남긴다.

### 불변 조건

* 하나의 논리적 작업은 재시도되어도 결과와 비용이 한 번만 반영된다.
* 정책·사실·권리 gate는 완전 자동형에서도 우회하지 않는다.
* pause 상태에서는 신규 자동화 작업을 생성하지 않는다.
* hard limit을 넘는 신규 비용 작업을 시작하지 않는다.
* 완료된 단계는 재개 시 다시 실행하지 않는다.
* 외부 게시 여부가 불명확하면 확인 전 중복 업로드하지 않는다.

### 제외

성과 분석, 자동 전략 최적화, 외부 알림 채널, 전면적인 관측성·보안 강화는 각각 16~18단계에서 구현한다.

### 필수 검증

* 가상 시간 기반 하루·일주일 자동 운영 시뮬레이션
* 재고 부족 수량만 생성하고 예약된 콘텐츠를 중복 계산하지 않음
* scheduler 중복 실행, queue 중복 전달, worker 재시작
* 단계 실패 후 완료 지점 보존과 실패 지점 재개
* LLM/Image/TTS/Storage/Renderer/Publisher 장애와 부분 격리
* 일간·월간 soft/hard limit 및 동시 비용 경쟁 조건
* 정책 실패, 강제 검수 주제, 권리 불명 콘텐츠의 자동 게시 차단
* OAuth 만료, 계정 연결 해제, 게시 ambiguous timeout
* 재생성 상한, 연속 실패 자동 pause, circuit breaker
* graceful pause, 즉시 중지, resume, drain
* workspace·채널 권한과 운영 UI E2E
* Fake Provider 전체 자동 운영 E2E

### 문서

자동화 상태 전이, 재고 계산, 비용 예약·확정·해제, pause/kill switch/drain 차이와 장애 복구 절차를 문서화한다.

### Commit

`feat: 안전한 완전 자동 콘텐츠 운영 구현`

---

# 16단계. 성과 데이터 수집과 분석

**상태:** 완료

### 목표

플랫폼별로 의미와 제공 시점이 다른 성과 지표를 원본 그대로 보존하면서 공통 지표로 안전하게 정규화하고, 사용자가 기간·플랫폼·채널별 성과와 비용 효율을 확인할 수 있게 한다.

### 구현 순서

#### 16A. Analytics Provider와 지표 계약

* AnalyticsProvider 공통 계약과 YouTube·Instagram·TikTok·Fake 구현을 제공한다.
* 플랫폼별 metric 이름, 단위, 집계 방식과 지원 여부를 versioned mapping으로 관리한다.
* 조회수, 노출, 평균 시청 시간, 완주율, 이탈, 반응, 전환 중 실제 API가 제공하는 값만 수집한다.
* 제공되지 않는 값은 0으로 저장하지 않고 unavailable 상태와 사유를 기록한다.
* 플랫폼 원본 응답과 normalized metric을 분리해 저장한다.
* 외부 SDK 타입과 raw 응답을 도메인 계약으로 직접 노출하지 않는다.

#### 16B. 동기화와 데이터 정합성

* ANALYTICS BullMQ processor와 주기적·수동 sync를 구현한다.
* channel/platform/post/metric/period를 포함한 idempotency key로 중복 저장을 방지한다.
* 플랫폼 수치의 지연 도착과 사후 수정이 가능하도록 관측 시각과 값의 revision 또는 snapshot을 보존한다.
* 기준 기간, channel timezone, source timezone, syncedAt와 예상 data delay를 기록한다.
* API pagination, rate limit, token refresh, 부분 실패와 backfill을 처리한다.
* 삭제·비공개·연결 해제된 게시물의 마지막 성공 값과 unavailable 상태를 구분한다.
* 동일 sync 재실행 시 중복 행 없이 최신 원본 상태를 반영한다.

#### 16C. 분석 API와 대시보드

* 채널·플랫폼·콘텐츠·기간 필터와 비교 기간을 제공한다.
* 플랫폼별 지표와 공통 정의가 검증된 지표만 합산한다.
* 조회, 평균 시청 시간, 완주율, 참여율, 게시 빈도와 콘텐츠당 비용을 표시한다.
* 데이터 지연, 미지원 지표, 마지막 동기화 시각과 부분 실패를 UI에 표시한다.
* 일간·주간 요약과 CSV 내보내기 또는 동등한 재사용 가능한 조회 결과를 제공한다.
* 원본 지표에서 정규화 지표까지의 출처와 계산식을 추적할 수 있게 한다.

### 불변 조건

* unavailable과 실제 0을 구분한다.
* 단위·분모·집계 의미가 다른 지표를 이름이 비슷하다는 이유로 합산하지 않는다.
* raw metric은 덮어써서 이력을 잃지 않는다.
* 모든 기간 계산은 저장 시 UTC, 표시·경계 계산 시 명시된 timezone을 사용한다.
* 플랫폼 API가 제공하지 않는 지표를 추정값처럼 원본 지표로 저장하지 않는다.

### 제외

성과 기반 전략 변경과 실험 자동화는 17단계에서 구현한다.

### 필수 검증

* Provider contract와 Fake Analytics 전체 E2E
* 누락 지표, 실제 0, unavailable 구분
* 중복·동시 sync와 pagination
* 플랫폼에서 수정된 과거 수치와 backfill
* timezone, DST 경계, 일간·주간 기간 계산
* rate limit, token 만료, 부분 실패, 재시도
* 의미가 다른 지표의 합산 차단
* 채널·workspace 데이터 격리와 권한
* 대시보드 loading/empty/error/partial 상태
* 일간·주간 요약 계산과 비용 연결

### 문서

플랫폼별 metric mapping, 계산식, data delay, sync 주기와 backfill 운영법을 문서화한다.

### Commit

`feat: 플랫폼 성과 수집과 분석 대시보드 구현`

---

# 17단계. 성공 패턴 추출과 콘텐츠 최적화

**상태:** 완료

### 목표

성과 데이터에서 반복 가능한 개선 후보를 추출하되 상관관계를 인과관계로 단정하지 않고, 표본·신뢰도·보호 항목과 승인 절차가 포함된 안전한 전략 개선 흐름을 구현한다.

### 구현 순서

#### 17A. 비교군과 패턴 후보 생성

* 채널·플랫폼·콘텐츠 형식·비교 기간별 상위/하위 성과군을 구성한다.
* 영상 길이, hook 유형, 주제, 게시 시각, 장면 수, 자막 밀도 등 허용된 feature만 분석한다.
* 최소 표본 수, 데이터 완전성, 이상치 처리와 baseline을 명시한다.
* 플랫폼과 의미가 다른 metric을 섞지 않는다.
* 표본이 부족하거나 편향 가능성이 크면 확정 패턴이 아니라 가설로 표시한다.
* 분석 입력 snapshot, metric version, 기간과 생성 모델·규칙 버전을 보존한다.

#### 17B. OptimizationSuggestion과 승인

* 근거, 대상 전략 필드, 예상 효과, 표본 수, 신뢰도, 위험과 rollback 방법을 포함한 제안을 생성한다.
* 제안의 pending/approved/rejected/applied/expired 상태 전이를 구현한다.
* 사용자가 보호한 주제·브랜드 문구·금지 조건·정책 설정은 변경 후보에서 제외한다.
* 승인형은 명시적 승인 전 StrategyVersion을 변경하지 않는다.
* 자동형도 사전에 허용된 필드와 변화 폭 안에서만 적용한다.
* 적용 시 immutable StrategyVersion을 생성하고 이전 버전을 보존한다.

#### 17C. Experiment와 rollback

* control/variant, 가설, 대상 metric, 시작·종료 조건과 최소 표본을 가진 Experiment를 구현한다.
* 동일 채널에서 충돌하는 실험의 동시 실행을 차단한다.
* 콘텐츠 배정은 재현 가능하고 게시 후 임의 변경되지 않게 한다.
* 중단 조건과 안전 지표 악화 시 자동 중단을 지원한다.
* 결과에 inconclusive 상태를 포함하고 승자를 강제로 선택하지 않는다.
* 적용된 전략을 이전 StrategyVersion으로 rollback하고 이후 자동화가 복구된 버전을 사용하게 한다.

#### 17D. 최적화 UX

* 제안 목록, 근거 비교, 승인·거절, 적용 이력과 rollback UI를 제공한다.
* 실험 진행률, 표본, 데이터 지연, 결과와 중단 사유를 표시한다.
* 자동 적용 범위와 보호 항목을 채널 설정에서 확인·수정할 수 있게 한다.
* 전략 변경과 승인·거절·rollback을 감사 가능한 이력으로 남긴다.

### 불변 조건

* 상관관계를 인과관계로 표현하지 않는다.
* 표본 부족 결과는 확정 패턴으로 자동 적용하지 않는다.
* 플랫폼 간 metric 의미가 다르면 동일 비교군으로 합치지 않는다.
* 보호 항목과 정책·권리 gate는 최적화가 변경하거나 우회하지 않는다.
* 모든 전략 변경은 이전 버전으로 rollback할 수 있다.

### 제외

새로운 ML 학습 인프라, 다변량 고급 실험과 실시간 개인화는 v1 범위에서 제외한다.

### 필수 검증

* 표본 부족, 결측 데이터, 데이터 지연과 이상치
* 플랫폼·채널·기간별 비교군 격리
* 동일 입력의 deterministic suggestion
* 승인·거절·만료·적용 상태 전이와 권한
* 자동형 허용 필드·변화 폭 제한과 보호 항목
* StrategyVersion 생성·적용·rollback
* 실험 배정 재현성, 충돌 차단, 조기 중단, inconclusive
* 최적화 후에도 정책·예산·자동화 안전장치 유지
* Fake Analytics 기반 API·Playwright E2E

### 문서

feature 목록, 비교·신뢰도 규칙, 자동 적용 허용 범위, 실험 판정과 rollback 절차를 문서화한다.

### Commit

`feat: 성공 패턴 기반 콘텐츠 최적화 구현`

---

# 18단계. 비용·알림·관측성·보안 강화

**상태:** 완료

### 목표

15단계의 실행 시점 예산 제어를 운영 가능한 비용 관리로 확장하고, 장애 탐지·추적·알림·감사·데이터 수명주기·복구 체계를 완성한다.

### 구현 순서

#### 18A. 비용 원장·예산 관리와 알림

* ProviderUsage와 CostLedger의 생성·예약·확정·조정 흐름을 대사한다.
* workspace·채널·Provider·작업·기간별 비용 집계 API와 UI를 제공한다.
* 단가 버전, 통화, 환율 적용 시점과 추정/확정 비용을 구분한다.
* 원장 합계와 집계값 불일치를 탐지하고 재계산할 수 있게 한다.
* 예산 soft/hard limit 변경과 적용 이력을 보존한다.
* 검수 대기, 작업 실패, 연속 실패, 계정 만료, 정책 차단, 예산 임계치와 게시 실패 알림을 제공한다.
* 알림 event key, cooldown과 acknowledgement로 중복·폭주를 억제한다.
* v1 알림 채널이 확정되지 않았다면 in-app을 기본으로 하고 외부 채널은 interface 뒤에 둔다.

#### 18B. 관측성과 장애 진단

* 요청·job·workspace·channel·content를 연결하는 correlation ID를 Pino 구조화 로그에 적용한다.
* Sentry에 API·worker·renderer 오류와 release/environment 정보를 연결한다.
* 비밀정보, OAuth token, cookie, 원문 개인정보를 로그·breadcrumb에서 제거한다.
* queue lag, retry/dead-letter, Provider latency/error, storage, DB, scheduler와 게시 성공률 지표를 수집한다.
* readiness/liveness를 구분하고 의존성 상태와 기능 저하 원인을 노출한다.
* 운영 화면에서 현재 장애 범위와 최근 실패를 민감정보 없이 조회한다.

#### 18C. 보안과 데이터 수명주기

* 로그인·OAuth·게시·승인·설정·예산·kill switch·전략 변경 감사 로그를 구현한다.
* 감사 로그는 append-only 원칙과 workspace 권한을 적용한다.
* 사용자·콘텐츠·원본 응답·렌더 파일·로그·OAuth credential의 보존·삭제 정책을 문서화하고 실행한다.
* 계정 삭제와 workspace 데이터 삭제를 비동기 job으로 처리하고 결과를 검증한다.
* OAuth 암호화 키 rotation과 이전 key version의 재암호화 절차를 구현한다.
* CSP, HSTS, CORS, cookie와 기타 security header를 production 설정으로 검증한다.
* dependency, secret, container 및 정적 보안 scan을 CI에 연결한다.

#### 18D. 백업·복구와 운영 runbook

* MySQL 백업·복원, object storage 복구와 Redis queue 유실 시 MySQL 기준 재구성 절차를 정의한다.
* 백업 파일의 암호화, 보존 기간과 접근 권한을 적용한다.
* staging 또는 격리 환경에서 restore rehearsal을 수행하고 RPO/RTO 측정값을 기록한다.
* Provider 장애, DB 장애, Redis 장애, 저장소 장애, credential 유출 의심, 게시 중복 의심 runbook을 작성한다.
* 알림에서 관련 진단 정보와 runbook으로 연결한다.

### 불변 조건

* 비용 집계는 원장과 대사 가능해야 하며 부동소수점으로 계산하지 않는다.
* 알림 실패가 핵심 작업의 상태를 되돌리거나 중복 실행시키지 않는다.
* 관측 데이터와 감사 로그에 비밀정보를 기록하지 않는다.
* Redis 복구 시 MySQL 업무 상태를 source of truth로 사용한다.
* key rotation 중에도 기존 credential을 안전하게 읽고 점진적으로 재암호화한다.

### 필수 검증

* 비용 예약·확정·조정·환불과 원장 대사
* 동시 비용 기록, hard limit 경쟁 조건과 집계 재계산
* 알림 중복 억제, cooldown, acknowledgement와 알림 채널 실패
* request→job→Provider→결과 correlation 추적
* Sentry/Pino 민감정보 redaction 검사
* queue/Provider/storage/DB 상태와 readiness/liveness
* 감사 로그 권한과 변조 방지 속성
* 사용자 데이터 삭제와 보존 예외
* OAuth key rotation 및 이전 key 호환
* security header와 CI 보안 scan
* 실제 백업 생성, 격리 복원, 무결성 확인과 RPO/RTO 기록
* 주요 장애 runbook tabletop 또는 자동화 검증

### 문서

비용 계산·대사, 알림 정책, 관측성 필드, 데이터 보존·삭제, key rotation, backup/restore와 장애 대응 runbook을 작성한다.

### Commit

`feat: 운영 비용 알림 관측성과 보안 강화`

---

# 19단계. 전체 회귀 테스트·배포 준비·v1 완료 판정

**상태:** 완료

### 목표

새 기능을 추가하지 않고 기능 명세와 기술 결정에 대한 추적성을 완성하며, production과 동등한 환경에서 회귀·장애·보안·배포·복구 검증을 수행해 v1 출시 가능 여부를 근거와 함께 판정한다.

### 구현 순서

#### 19A. 명세 추적과 미완료 항목 정리

* 기능 명세의 각 요구사항을 코드, API, migration, 테스트와 연결한 추적 매트릭스를 작성한다.
* 0~18단계의 완료 표시를 코드·migration·테스트·커밋으로 재검증한다.
* 실제 Provider 키·앱 심사·외부 권한이 필요한 검증을 Fake 완료와 구분한다.
* 미완료, 제외, 운영 수동 절차와 알려진 위험을 심각도·영향·대응 계획과 함께 기록한다.
* 치명적·높은 위험은 release blocker로 처리한다.

#### 19B. 전체 회귀와 장애 시뮬레이션

* 신규 사용자 로그인부터 채널 생성, 수집, 제작, 검수, 예약, 게시, 분석, 최적화까지 전체 Fake Provider E2E를 수행한다.
* 승인형과 완전 자동형의 핵심 사용자 여정을 각각 검증한다.
* 빈 DB migration, 기존 schema upgrade, seed와 rollback/forward-fix 절차를 검증한다.
* Redis 재시작·유실, Provider timeout/rate limit, storage 실패, renderer 실패, OAuth 만료, 게시 ambiguous timeout과 예산 초과를 시뮬레이션한다.
* 중복 요청과 worker 재시작 후 생성·비용·게시 결과가 중복되지 않는지 확인한다.
* 데이터 격리, 권한, CSRF, rate limit과 민감정보 노출을 회귀 검증한다.

#### 19C. Production build와 CI/CD

* web/api/worker/renderer의 production Docker image와 실행 설정을 완성한다.
* 환경 변수 schema, secret 주입, migration 실행 순서와 healthcheck를 검증한다.
* CI에서 install, lint, typecheck, unit, integration, contract, build와 보안 scan을 실행한다.
* 조건이 갖춰진 환경에서 Playwright, renderer smoke와 migration 검증을 별도 job으로 실행한다.
* image tag와 release version을 고정하고 동일 artifact를 승격한다.
* 배포 실패 시 자동 또는 명시적 rollback과 DB forward-fix 기준을 정의한다.
* production 배포 대상이 미결정이면 임의로 고정하지 않고 필요한 계약과 체크리스트를 완성해 blocker로 기록한다.

#### 19D. 성능·용량과 운영 인수

* 핵심 API, scheduler, queue 처리, SSE, analytics sync와 게시 worker의 기준 부하를 측정한다.
* 동시 사용자, 채널 수, 일일 콘텐츠 수와 대용량 파일 기준의 테스트 조건·결과를 기록한다.
* DB query, index, queue concurrency, memory, 임시 디스크와 renderer 처리량 병목을 확인한다.
* 수치 목표가 미확정이면 실제 측정 baseline과 허용 가능한 운영 범위를 기록하고 임의의 합격 수치를 만들지 않는다.
* 대시보드, 알림, on-call 대응, backup/restore/rollback runbook을 최종 점검한다.
* 실제 Provider smoke test는 자격 증명이 있는 항목만 실행하고 결과와 확인일을 기록한다.

#### 19E. v1 완료 판정

* `docs/v1-acceptance-report.md`에 검증 환경, commit SHA, 실행 명령, 결과와 증거를 기록한다.
* PASS, PASS_WITH_EXTERNAL_VERIFICATION_PENDING, FAIL 중 하나로 판정한다.
* Fake Provider 성공만으로 실제 SNS·LLM·Image·TTS 연동까지 검증됐다고 선언하지 않는다.
* 치명적 또는 높은 위험, migration 실패, 보안 blocker, 복구 불가 상태가 남으면 FAIL로 판정한다.
* 외부 앱 심사나 자격 증명만 남고 내부 구현·Fake 계약·운영 체크리스트가 모두 충족된 경우에만 외부 검증 대기 판정을 사용한다.

### 필수 검증

* 명세 추적 매트릭스
* 전체 Fake Provider E2E
* 승인형·완전 자동형 Playwright 핵심 여정
* 빈 DB 및 기존 DB migration 검증
* Redis/Provider/upload/token/budget 장애 시뮬레이션
* 중복 요청·worker 재시작·ambiguous publish 복구
* 전체 lint, typecheck, unit, integration, contract, build
* renderer smoke와 ffprobe QA
* production Docker build와 healthcheck
* CI/CD와 보안 scan
* 권한·CSRF·rate limit·민감정보 회귀
* 성능·용량 baseline
* deployment/backup/restore/rollback rehearsal
* 가능한 실제 Provider smoke와 미실행 사유
* `docs/v1-acceptance-report.md`

### 완료 조건

* 모든 필수 검증 결과와 미실행 사유가 acceptance report에 기록되어 있다.
* 명세 요구사항이 구현·테스트 또는 명시적 제외 항목으로 추적된다.
* release blocker가 0개다.
* 배포·모니터링·복구 절차를 다른 운영자가 문서만 보고 수행할 수 있다.
* 판정과 남은 외부 검증이 과장 없이 구분되어 있다.

### Commit

`release: Postbot v1 구현 및 배포 준비 완료`

---
# 19.1단계. 출시 전 핵심 기능·UX 정합성 보완

**상태:** 내부 구현·필수 로컬 검증 완료 — PASS_WITH_EXTERNAL_VERIFICATION_PENDING (지원 제외 기능과 외부/CI 검증 제한은 acceptance report 참조)

### 범위

* 아이디어에서 내부 ID 입력 없이 전체 제작 자동화를 시작하고 중복 클릭을 방지한다.
* 채널 언어·대상·톤·훅·CTA·길이·최신 적용 전략을 스크립트/장면 생성에 전달한다.
* 장면별 이미지 생성 결과를 정확한 SceneVersion에 연결하고 Remotion 결과에 합성한다.
* 예상 비용은 클라이언트 입력을 신뢰하지 않고 서버 설정과 실제 작업량으로 계산하며, 단가 미확정 실 Provider는 fail-closed 한다.
* 플랫폼별 최신 스크립트·장면·정책 스냅샷·편집 메타데이터를 검수/예약/게시 전 과정에서 일치시킨다.
* 여러 플랫폼을 순차 예약할 수 있게 하고 동일 계정·동일 시각 예약 충돌을 차단한다.
* 예산 설정, 실제 예약/게시 캘린더, 채널별 분석/최적화 선택, 로컬 시간 입력을 사용자 화면에서 제공한다.

### 필수 검증

* 변경 package/app lint 및 typecheck
* 비용 추정·플랫폼별 게시 선택·채널 생성 설정 반영 unit test
* 아이디어→제작, 검수, 예산, 채널 wizard Playwright 여정
* 장면 이미지가 Remotion 프레임에 나타나는 실제 Chromium still smoke
* 전체 lint, typecheck, test, build
* FFmpeg/ffprobe 및 Docker 기반 통합 검증은 실행 가능 환경에서 수행하고, 불가하면 acceptance report에 환경 원인을 기록한다.

### 문서

`docs/pre-release-remediation.md`와 관련 API, 자동화, asset, renderer, acceptance 문서를 갱신한다.

### Commit

`fix: 출시 전 사용자 흐름과 제작 정합성 개선`

---

## 요구사항 추적

### 19.7단계 — 후속 브라우저 CI 실패 보완

**상태:** 내부 수정·필수 로컬 검증 완료. 상세 결과는 `docs/ci-browser-remediation-2026-10-07.md`에 기록하며 커밋 후 원격 CI를 추적한다.

범위: 19.6 수정 후 처음 실행된 browser-e2e에서 발견한 production artifact 준비 누락과 Linux Chromium의 모바일 자산 업로드 grid 넘침. 서버 기능·API·DB·제작 기능은 변경하지 않는다.

커밋 전 필수 검증: web lint/typecheck/unit/build, 전체 Playwright와 Linux Chromium의 수정 전 실패·수정 후 모바일 재검증, 변경 web production image build와 HIGH/CRITICAL scan. 19.6에서 통과한 동일 backend/renderer/보안 patch의 검증은 반복하지 않는다. 커밋 후 원격 CI를 확인한다.

Commit: `fix: 브라우저 CI 빌드 준비와 모바일 자산 업로드 레이아웃 보완`

### 19.6단계 — 원격 CI 보안 스캔·자동화 DB 회귀 실패 수정

**상태:** 내부 수정·필수 로컬 검증 완료. 원인, 환경 보완 재검증과 이미지 보안/렌더 결과는 `docs/ci-remediation-2026-10-07.md`에 기록한다. 커밋 후 원격 CI 결과를 추적한다.

범위: `5592fde`의 원격 CI에서 발견된 production 의존성 취약점 패치와 자동화 DB 테스트의 명시적 정책 fixture 구성. 정책 검사와 HIGH/CRITICAL 차단 기준을 유지하며 신규 기능·운영 DB 변경은 수행하지 않는다.

커밋 전 필수 검증: frozen install, production dependency audit, api/worker/renderer lint·typecheck·unit, 빈 격리 DB의 자동화 integration 회귀, 네 production image build와 HIGH/CRITICAL scan, filesystem dependency scan과 secret history scan, 실제 Remotion 렌더 smoke 및 Rspack bundle 호환성. 커밋 후 원격 CI의 후속 결과를 확인하고 미실행 항목은 기록한다.

Commit: `fix: CI 보안 취약점과 자동화 테스트 정책 데이터 보완`

### 19.5단계 — 320px 비용 필터 가로 넘침 수정

**상태:** 내부 구현·필수 검증 완료. 실제 데이터의 긴 콘텐츠 제목으로 비용 선택창과 부모 라벨이 320px viewport를 넘어가는 결함을 보완했다. 원인과 재검증은 `docs/ux-narrow-screen-fix-2026-10-06.md`에 기록한다.

범위: 비용 필터의 축소 가능한 라벨·입력 레이아웃, 긴 제목을 포함한 좁은 화면 회귀. API/DB/제작/렌더/게시 동작은 변경하지 않는다.

필수 검증: web lint/typecheck/unit/build, desktop·390px 전체 Playwright, 긴 제목과 필터 선택 보존의 320/360/390/768/1440px 회귀, 기존 실제 합성 데이터의 확장 화면·미디어 재생·로그아웃/새로고침 확인. 동일 API/worker/renderer/DB 코드에서 성공한 전체 HTTP 여정·migration은 반복하지 않는다.

완료 조건: 실제 재현의 344px 넘침이 없어지고 새 회귀가 수정 전 실패·수정 후 통과하며 모든 필수 web 검증이 성공한다.

Commit: `fix: 좁은 화면 비용 필터 가로 넘침 수정`

### 19.4단계 — 직접 UX 점검 결함과 운영 화면 보완

**상태:** 내부 구현·필수 검증 완료 — PASS_WITH_EXTERNAL_VERIFICATION_PENDING. 2026-10-06 직접 UX 점검의 현재 단계 지원 범위 결함을 보완했다. 최초 명세 전체 완료가 아니며 미구현/외부 확인 항목은 `docs/ux-remediation-2026-10-06.md`에 구분한다.

범위: 예약 취소 후 재예약·플랫폼별 메타데이터 격리, 채널 수집/일정/자동화/플랫폼 설정, 분석 동기화와 최적화 설정/제안, 검수 안내·플랫폼 이동·키보드 접근성·모바일 레이아웃, 세션 복구, 중지 채널/실패 상태 안내, Provider 차단 제어와 생성 전 정책 길이 확인. 기존 v1 계약에서 지원하는 기능을 실제 사용자 화면에서 사용할 수 있게 한다. 외부 스톡 구매/검색 Provider 선택, 자유 영상 편집기, 고급 인과 분석, 실 자격 증명·유료 호출·실 게시·운영 배포는 제외하며 제외를 화면/검증 보고서에서 숨기지 않는다.

필수 검증: 변경 app/package lint·typecheck·unit/관련 DB integration, 예약 이력·동시 요청·플랫폼 격리 회귀, 데스크톱/모바일 Playwright 실제 조작, 변경 API와 Fake 전체 여정, 변경 app build. DB 변경 시 기존/빈 테스트 DB migration을 검증한다. renderer/배포/보안 전체 회귀는 해당 코드나 설정이 변경된 경우에만 재실행한다. 미실행/남은 결함은 기록하며 성공으로 간주하지 않는다.

추가 명세 범위: 권리 확인된 사용자 WAV 배경음·효과음 선택 및 볼륨, 구조화된 대본 편집, 음성/자막 부분 재생성을 지원한다. 자유 타임라인 편집기는 제외하되 지원 가능한 검수 편집을 그 제외에 묻어 숨기지 않는다. 이 범위 변경으로 renderer lint/typecheck/test/build 및 실제 오디오 합성/ffprobe smoke를 필수 검증에 추가한다.

완료 조건: UX 점검 항목별 수정/재검증/지원 제외/외부 확인 필요를 추적하고 내부 필수 검증이 모두 성공한다.

Commit: `fix: 직접 UX 점검 결함과 운영 화면 보완`

### 19.3단계 — 사용자 설정을 제외한 출시 회귀·결함 보완

**상태:** 내부 구현·필수 로컬 검증 완료 — PASS_WITH_EXTERNAL_VERIFICATION_PENDING (사용자 운영 설정·실제 자격 증명/SNS·원격 CI 제한은 acceptance report 참조)

범위: 잘못된 URL에 대한 웹 서버 장애 방지, 동일 웹 artifact의 runtime API 주소 설정, CI DB 회귀 실행 보장, 전체 내부 기능·장애·보안·배포/복구 회귀에서 발견한 결함 보완. 사용자 선택(배포 대상/도메인/운영 용량), 자격 증명, SNS 앱 심사 및 실제 유료 호출/게시/운영 배포는 제외한다.

필수 검증: 전체 lint/typecheck/unit/build, 테스트 전용 DB integration/장애/멱등성 회귀, desktop/mobile Playwright, production image와 실제 Fake 전체 여정/샘플/renderer QA, dependency/secret/filesystem/image scan, 격리 migration 및 backup/restore 검사. 이미 동일 최종 코드에서 성공한 항목은 반복하지 않는다. 실행 불가 항목은 이유를 보고하며 성공으로 간주하지 않는다.

Commit: `fix: 출시 회귀 결함과 운영 검증 보완`

### 19.2단계 — 최종 명세 점검 결함 보완

**상태:** 구현·필수 로컬 검증 완료 — PASS_WITH_EXTERNAL_VERIFICATION_PENDING (실 Provider/SNS/CI 제한은 acceptance report 참조)

범위: 권리 승인 후 기존 자산을 재사용해 제작 재개, 실제 사용 플랫폼만 승인/예약 무효화, ElevenLabs voice 설정 매핑, 제한된 성과 비교 실험의 제작 배정·결과 계산, 채널 브랜드/자막·AI/스톡 비율 반영, 계정 연결과 실제 샘플 제작·정책 검사를 포함하는 마법사.

필수 검증: 변경 app/package lint·typecheck·build, 권리 재개/플랫폼 격리 DB 회귀, Provider voice mock, 실험 배정/비교 unit·DB 회귀, 마법사 Playwright, 브랜드·장면 이미지 실제 renderer smoke. 유료 Provider/SNS/운영 배포는 실행하지 않는다. 기존 성공 검증은 영향 없는 경우 반복하지 않는다.

Commit: `fix: 최종 명세 점검 결함과 누락 기능 보완`

### 19.8단계 — 이미지 모션 MVP 운영 복구·정합성 보완

**상태:** 내부 필수 검증 통과. 실제 Provider/SNS 검증과 불명확 결과의 운영 대사는 별도이며, 실제 계정 무인 운영 승인은 유보한다.

범위: 2026-10-21 사용자가 명시적으로 승인한 큐 복구·보류 예약·소재 선정·작업 권한·음성 타이밍·권리 검수·정기 분석·운영 설정 결함. 기존 사용자 UI 변경을 보존하며 새 제작 엔진, 실 유료 호출/외부 게시/push/merge/배포는 제외한다.

필수 검증: lint/typecheck/build, 관련 unit/HTTP·MySQL·실제 Redis 복구/동시성·채널/workspace 격리, 브라우저 소재/검수/수정/보류 복구/분석, 로컬 FFmpeg·Chromium 음성/자막 렌더, Fake 수집부터 정기 분석까지의 여정, 빈 DB 및 기존 DB migration.

운영 계약·결과·제한은 `docs/image-motion-mvp-2026-10-21.md`에 기록한다.

Commit: `fix: 이미지 모션 MVP 운영 복구와 정합성 보완`

### 19.9단계 — 운영 안정성과 콘텐츠 개선 후속 작업 (2026-11-17)

**상태:** 6단계 내부 구현과 필수 검증 완료. 실제 Provider/SNS 및 운영 규모 검증은 외부 확인 필요. 단계별 로컬 커밋이며 push/merge/배포하지 않는다. 전체 검사에서 발견한 문제 수정과 관련 재검증 이력은 후속 검증 보고서에 기록한다.

기준 HEAD: `7c0e638`. 2026-11-17 첨부 요청에 따라 아래 순서로 구현·검증·커밋한다. 단계별 상세 재검증과 증거는 `docs/operations-content-remediation-2026-11-17.md`에 기록한다. 유료 호출, 실제 게시, 운영 DB 변경, push/merge/배포는 제외한다.

1. 중단 작업 복구·게시 정합성: 실행 소유권/heartbeat, 원자적 복구, 불명확 호출 보류, 예약과 durable job 및 게시 시도 트랜잭션. 실제 격리 MySQL/Redis의 재전달·경쟁·실패 검증. Commit: `fix: 중단 작업 복구와 게시 정합성 보완`
2. 성과 수집 정확성: 지연/부분/영구 미제공 구분, 유한 재수집, 관측 기간·게시 버전 보존. 관련 Provider 계약 및 DB 회귀. Commit: `fix: 성과 집계 지연과 게시 버전 추적 보완`
3. 근거·비용 통제: 주장별 근거와 결정적 검증, 입력/출력 토큰·재시도 예약. 정상 및 거짓 주장·긴 입력·실패 회귀. Commit: `fix: 주장 근거 검증과 생성 비용 통제 보완`
4. 후보·소재 선정: 현재 조건 재평가, 설명 가능한 의미 중복·요소 점수, 권리 유지 스톡 적합도. 관련 unit/DB 회귀. Commit: `fix: 주제 재평가와 장면 소재 적합도 개선`
5. 표현·품질: 호환 가능한 장면 역할/템플릿, 즉시 Hook, 오버레이·긴 텍스트·기술 QA. 대표 프레임 시각 검사와 짧은 실제 렌더 smoke. Commit: `feat: 역할별 영상 템플릿과 기술 품질 검사`
6. 분석·실험: 동질 관측군·게시 특성·최종 길이, 불확실성과 종료 기준. 플랫폼/기간/길이/표본 회귀. Commit: `fix: 성과 비교와 실험 판정 정확성 보완`

각 단계는 변경 app/package lint/typecheck와 관련 테스트가 통과한 뒤 커밋하고 다음 단계로 진행한다. migration은 빈 DB 및 기존 데이터 DB에 적용 검증하며 기본값·복구·rollback 한계를 기록한다. 공유 계약/스키마 영향이 넓으면 마지막에 전체 lint/typecheck/test/build를 수행한다. 필수 검증 미실행은 완료로 간주하지 않는다.

### 19.10단계 — PR #4 CI 전체 여정 계약 보완

**상태:** API/providers 관련 lint·typecheck·unit과 격리 Docker acceptance 3개 여정 통과. 수정 커밋을 PR #4에 반영한 뒤 원격 CI를 확인한다.

범위: 사용자 요청에 따라 PR #4의 실패한 acceptance fixture와 Fake Provider 계약을 수정한다. NEWS 발행일/원문 근거와 최신 분석 결론을 검증하며 운영 판정 기준은 유지한다. 검증 후 같은 PR에 push하고 원격 CI 결과를 확인한다. merge/운영 배포는 제외한다.

필수 검증: 변경 API/providers lint·typecheck와 관련 unit, 실제 격리 Docker HTTP·MySQL·Redis·S3·renderer의 acceptance 3개 여정. 원격 CI 실패 로그에 따라 필요한 회귀만 추가한다.

Commit: `fix: CI 전체 여정의 수집 근거와 Fake Hook 계약 보완`

### 20단계 — 채널별 제작과 운영 자동화 개선 (2026-11-17)

기준: `31d0564a1d44711f830e44de0b6563c39cff6ca2`. 첨부 요청의 전체 범위를 순차 구현한다. 실제 유료 호출·SNS 게시·운영 DB·외부 알림·push·merge·배포는 제외한다. 상세 상태와 검증 증거는 `channel-production-operations-2026-11-17.md`에서 관리한다.

1. 제작 결과 계약과 조회 경계. 완료 조건: 버전 고정 조회·workspace 격리·비밀 응답 제외 회귀 및 변경 contracts/API lint·typecheck 통과. Commit: `refactor: 제작 결과 계약과 운영 책임 경계 정의`
2. 채널 수집 프로필·공식 커넥터·안전한 원문·질문 후보. 완료 조건: SSRF/예산/캐시/소스 장애 격리 계약 및 관련 DB 회귀 통과. Commit: `feat: 채널 수집 프로필과 근거 수집 경로 구현`
3. 기획 보존·Hook 평가·장면 의미 정렬·수정 무효화. 완료 조건: 다국어·버전·부분 수정 회귀 통과. Commit: `fix: 기획 보존과 장면별 대본 정렬 개선`
4. 시각 가이드·호출 전 공유 캐시·권리 정책. 완료 조건: GRAPHIC 무과금·동시 재사용·권리 변경 예약 회귀 통과. Commit: `feat: 제작 자산 캐시와 권리 정책 보완`
5. 발화 정규화·자막·오디오·렌더 중단. 완료 조건: 타임라인/중단 자원 회수 회귀와 실제 대표 프레임·짧은 렌더 시각 검사 통과. Commit: `fix: 음성 자막 정렬과 렌더 자원 회수 보완`
6. 재고 기반 제작과 운영 대기 분리. 완료 조건: 격리 MySQL/Redis의 수요·후보 동시 점유·빈 수집·채널 정지 회귀 통과. Commit: `fix: 제작 재고와 승인 게시 대기 분리`
7. 예산 정산·오류 분류·안전한 재개. 완료 조건: 확정/불명확 사용·중복 정산·원래 호출 키 보존 DB 회귀 통과. Commit: `fix: 사용량 정산과 외부 호출 복구 보완`
8. OAuth 경쟁과 게시 결과 확인. 완료 조건: Mock 플랫폼 계약과 실제 DB refresh fencing·재인증·공개 상태 대사 회귀 통과. Commit: `fix: 계정 갱신 동시성과 게시 상태 대사 보완`
9. 동질 성과 관측과 주기적 제한 개선. 완료 조건: 날짜/시간대/부분 데이터/정책 제한/멱등 분석 회귀 통과. Commit: `fix: 성과 관측 기간과 정기 분석 보완`
10. 보존·운영 감시·백업과 최종 회귀. 완료 조건: 참조 재검사·삭제 재개·durable 키·Mock 알림·격리 백업 복원 및 최종 Fake 전체 여정, 영향 범위의 전체 lint/typecheck/test/build 통과. 빈 DB/기존 데이터 migration·복구 한계 기록. Commit: `feat: 운영 감시와 안전한 보존 백업 보완`

각 단계는 관련 lint/typecheck/test를 통과해야 커밋한다. 변경되지 않은 성공 검증은 반복하지 않는다. 외부 확인 대기와 내부 미완료는 구별해서 보고한다.

### 20.11단계 — PR #5 소재 조사·업무 감시 결함 보완

기준: `fa755d59d97decc588834c7fad7d405375ec6fdd`, 브랜치 `feat/channel-production-operations`. NASA 미디어 계약, 출처별 처리 기회와 평가 후 제한, 질문별 조사·근거 상태, YouTube 독립 원문 조사, 작업 미생성 중단 감지만 수정한다. push·merge·배포·실 SNS 게시·유료 호출은 제외한다.

완료 조건: 결함의 실패 테스트와 수정 후 회귀, 변경 contracts/providers/database/API/worker/web lint·typecheck, 관련 unit 및 격리 MySQL/Redis integration, 업무 감시 화면의 관련 Playwright, 빈 DB와 기존 데이터 migration 검증. 기존 성공 검증은 해당 코드가 바뀌지 않으면 반복하지 않는다. 기존 구현 보고서와 운영 계약을 갱신하고 실 API/운영 미검증을 명시한다.

Commit: `fix: 소재 조사와 채널 업무 중단 감지 보완`

세부 제품 요구사항과 각 단계의 추적 관계는 기능 명세에서 관리한다.

구현 계획에는 **단계 범위와 완료 조건만 유지**하며 기능 명세의 전체 내용을 중복 복사하지 않는다.
