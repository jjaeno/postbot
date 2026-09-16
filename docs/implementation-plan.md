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
| 8    | GPT 기반 대본·Scene JSON 생성 | 부분 완료 |
| 8.5  | 생성 비동기화·실제 LLM 연동 | 완료 (실제 OpenAI 키 검증 대기) |
| 9~19 | 후속 단계           | 미완료   |

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

**상태:** 부분 완료

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

**상태:** 미완료

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

**상태:** 미완료

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

**상태:** 미완료

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

**상태:** 미완료

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

**상태:** 미완료

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

**상태:** 미완료

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

**상태:** 미완료

### 범위

수집→생성→자산→렌더→정책→예약→게시 자동 연결, 콘텐츠 재고, 재생성 제한, 예산, pause/resume, kill switch, drain, 반복·폭주·연속 실패 방지.

### 필수 검증

가상 시간 시뮬레이션, 재고 부족, API 장애, 예산 초과, 정책 실패, 계정 만료, 중단·재개.

### Commit

`feat: 안전한 완전 자동 콘텐츠 운영 구현`

---

# 16단계. 성과 데이터 수집과 분석

**상태:** 미완료

### 범위

* AnalyticsProvider
* 플랫폼 metric mapping
* raw + normalized metric
* unavailable
* 기준 기간/timezone/sync 시각/data delay
* 주기적/수동 sync
* 분석 대시보드
* 일간/주간 요약

### 필수 검증

누락 지표, 중복 sync, 수정된 플랫폼 수치, timezone, 의미가 다른 지표의 잘못된 합산 방지.

### Commit

`feat: 플랫폼 성과 수집과 분석 대시보드 구현`

---

# 17단계. 성공 패턴 추출과 콘텐츠 최적화

**상태:** 미완료

### 범위

* 상위/하위 성과군
* 패턴 후보
* 표본 부족 가설 표시
* OptimizationSuggestion
* StrategyVersion
* rollback
* Experiment
* 승인형/자동형 변경 제한
* 보호 항목

### 필수 검증

표본 부족, 이상치, 플랫폼 분리, 승인/거절, 자동 범위 제한, rollback, 실험 중단, E2E.

### Commit

`feat: 성공 패턴 기반 콘텐츠 최적화 구현`

---

# 18단계. 비용·알림·관측성·보안 강화

**상태:** 미완료

### 구현 순서

#### 18A. 비용·예산·알림

비용 원장, budget/hard limit, 경쟁 조건 방지, 운영 알림과 중복 억제.

#### 18B. 관측성

Pino correlation ID, Sentry, Provider/queue/storage/DB 상태와 장애 진단 정보.

#### 18C. 보안·데이터 수명주기

감사 로그, 보존·삭제, OAuth key rotation, security scan와 security header.

#### 18D. 운영 복구

backup/restore 검증과 장애·복구 runbook.

### 필수 검증

민감정보 로그 검사, 비용 합계와 경쟁 조건, hard limit, 알림 중복, 장애 runbook.

### Commit

`feat: 운영 비용 알림 관측성과 보안 강화`

---

# 19단계. 전체 회귀 테스트·배포 준비·v1 완료 판정

**상태:** 미완료

### 범위

새 기능 추가가 아니라 전체 명세 대비 누락, 오류, 보안·운영 문제 해결과 배포 준비를 수행한다.

### 필수 검증

* 명세 추적 매트릭스
* 전체 Fake Provider E2E
* migration 검증
* Redis/Provider/upload/token/budget 장애 시뮬레이션
* lint
* typecheck
* unit
* integration
* contract
* Playwright
* renderer smoke
* Docker production build
* healthcheck
* CI/CD
* deployment/backup/restore/rollback runbook
* `docs/v1-acceptance-report.md`

치명적 또는 높은 위험이 남아 있으면 v1 완료라고 선언하지 않는다.

### Commit

`release: Postbot v1 구현 및 배포 준비 완료`

---

## 요구사항 추적

세부 제품 요구사항과 각 단계의 추적 관계는 기능 명세에서 관리한다.

구현 계획에는 **단계 범위와 완료 조건만 유지**하며 기능 명세의 전체 내용을 중복 복사하지 않는다.
