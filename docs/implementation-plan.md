# Postbot 구현 계획

기준 문서:

- `docs/Postbot_기능_UX_명세서_v0.2.docx`
- `docs/Postbot_v1_기술_스택_확정서.docx`
- `docs/Postbot_Codex_전체_개발_프롬프트.md`

본 문서는 0단계 산출물이다. 아직 애플리케이션 코드는 만들지 않으며, 이후 구현은 이 계획의 단계 범위 안에서만 진행한다.

## 1. 도메인별 기능 요구사항

### 채널·계정

- 개인 사용자 1명이 여러 채널을 운영할 수 있다.
- 채널은 콘텐츠 전략, 소재 수집 규칙, 공통 기획 템플릿, 플랫폼별 출력 프로필, 일정, 연결 계정을 묶는 자동화 단위다.
- YouTube, Instagram, TikTok 계정을 채널별 최대 1개씩 연결한다.
- 하나의 SNS 계정은 반드시 0개 또는 1개 채널에만 귀속된다.
- 채널 설정 변경은 이후 생성 콘텐츠부터 적용하고, 기존 예약 콘텐츠는 별도 확인한다.

### 콘텐츠 수집·기획

- 뉴스, 공식 발표, 논문, RSS, 공공기관 자료 등에서 소재를 자동 수집한다.
- 제목, 본문, URL, 게시 시각, 사건 시각, 작성자, 출처를 정규화해 저장한다.
- URL, 핵심 문장, 사건, 기존 게시물 의미 유사도로 중복을 제거한다.
- 원문 여부, 출처 등급, 복수 출처 일치 정도로 신뢰도를 평가한다.
- 주제, 목표 시청자, 금지 키워드, 기존 콘텐츠 균형으로 채널 적합도를 산정한다.
- 중요 사실은 원문 또는 복수 출처로 확인하고, 확인되지 않은 최신·민감 소재는 자동 게시하지 않는다.
- 공통 기획안은 핵심 주장, 근거, 출처, 스토리 흐름, 타깃, 위험도를 포함한다.

### 콘텐츠 제작·렌더링

- 하나의 공통 기획안에서 연결된 플랫폼 수만큼 독립 결과물을 만든다.
- 대본은 훅, 본문, 결론·참여 유도, 발음, 길이 검사를 포함한다.
- Scene JSON은 버전이 있는 렌더 계약이며 스키마 검증을 통과해야 한다.
- 장면 계획은 목적, 소스 유형, 프롬프트, 표시 시간, 출처·라이선스를 포함한다.
- 내레이션, 자막, 제목 카드, 인포그래픽, 워터마크, BGM/SFX를 조립한다.
- 생성형 비디오 API는 v1에서 사용하지 않고 Remotion과 FFmpeg로 최종 영상을 만든다.

### 자산·권리

- 내부 Asset Library, 라이선스 허용 실제 자료, Gemini 이미지 생성 순서로 시각 자산을 선택한다.
- AI 생성물, 무료·유료 스톡, 공공 자료마다 생성 서비스, 모델, 프롬프트, URL, 제작자, 다운로드일, 라이선스, 사용 범위를 기록한다.
- 상업 이용 가능 여부를 게시 전에 확인한다.
- 다른 플랫폼 워터마크가 포함된 파일은 재사용하지 않는다.
- 대본 유사도, 장면 반복, 템플릿 반복, 재사용 콘텐츠, 권리 불명을 검사하고 실패 시 게시를 차단하거나 재생성한다.

### 플랫폼 출력·정책

- YouTube Shorts, Instagram Reels, TikTok을 v1 플랫폼으로 지원한다.
- 콘텐츠 형식은 9:16 세로형 숏폼으로 제한한다.
- 영상 길이는 약 30~90초 범위에서 플랫폼 정책과 수익화 목표에 맞게 결정한다.
- 플랫폼별 길이, 훅, 편집, 자막, 메타데이터, 공개 설정을 독립 프로필로 관리한다.
- 정책 엔진은 플랫폼, 지역, 시행일, 확인일, 길이 규칙, 독창성, AI 표시, 권리, 제한 주제를 버전 관리한다.
- 정책 적합성은 사전 위험 탐지이며 수익화 승인이나 수익 발생을 보장하지 않는다.

### 자동화·상태

- 승인형은 생성과 검사를 자동 수행한 뒤 `REVIEW_REQUIRED`에서 사용자 승인을 기다린다.
- 완전 자동형은 사실·권리·정책·품질 검사를 모두 통과한 콘텐츠만 예약한다.
- 강제 검수 조건은 출처 신뢰도 미달, 핵심 사실 충돌, 사망·재난·범죄 최신 뉴스, 정치·건강·금융·법률 주제, 실제 인물처럼 보이는 AI 영상, 권리 불명, 플랫폼 정책 실패다.
- 오류 시 콘텐츠 보류, 실패 단계 재생성, 전체 재생성, 특정 플랫폼 건너뛰기, 채널 자동화 일시 중지를 선택할 수 있다.
- 생성·렌더·게시 작업은 멱등성 키와 재시도 정책을 가진다.

### UX

- 첫 채널 생성 마법사는 기본 정보, SNS 연결, 소재 수집, 영상 템플릿, 플랫폼 출력, 일정, 자동화, 샘플 단계로 구성한다.
- 메인 화면은 오늘 업로드, 검수 필요, 채널 상태, 콘텐츠 재고, 최근 결과, 사용량·비용을 보여준다.
- 주요 메뉴는 홈, 채널, 아이디어, 콘텐츠, 캘린더, 분석·최적화, 계정, 사용량·설정이다.
- 검수 화면은 공통 기획, 플랫폼 탭, 영상 미리보기, 편집 항목, 부분 재생성, 검사 결과, 승인·예약·보류·폐기 액션을 제공한다.
- 정책 검사 결과는 적합, 주의, 부적합, 확인 불가로 표시한다.

### 예약·게시

- 승인된 콘텐츠는 가장 가까운 빈 슬롯에 자동 배치할 수 있다.
- 같은 기획의 플랫폼별 게시 시각은 서로 다르게 설정할 수 있다.
- 예약 시간에 플랫폼별 업로드를 실행하고 외부 게시물 ID, URL, 게시 시각, 정책 버전을 저장한다.
- 일시적 실패는 지수 백오프로 재시도하고 최종 실패를 알린다.
- 플랫폼 post ID가 확인되기 전 동일 요청을 무작정 반복하지 않는다.

### 분석·최적화

- 플랫폼 API가 제공하는 범위에서 조회수, 노출수, 평균 시청 시간, 완주율, 이탈 시점, 반응, 전환, 비용 대비 성과를 수집한다.
- API가 제공하지 않는 지표는 임의 추정하지 않고, 수집 가능 여부와 기준 기간, 마지막 동기화 시각을 표시한다.
- 성공 패턴은 플랫폼별로 분리해 주제, Hook, 길이, 첫 장면, 전환 속도, 자막, 음성, 게시 시간 등을 비교한다.
- 표본이 적거나 외부 이슈 영향이 큰 결과는 확정 패턴이 아니라 가설로 표시한다.
- 개선 제안은 근거 콘텐츠, 비교 기간, 표본 수, 기대 효과, 신뢰도를 포함한다.
- 승인된 개선안만 전략·프롬프트·템플릿 버전에 반영하고 되돌릴 수 있어야 한다.
- 완전 자동형도 사용자가 허용한 항목과 범위 안에서만 실험·반영한다.

### 운영·비용·알림

- 콘텐츠·채널별 예상 비용과 실제 비용을 기록한다.
- 텍스트, 음성, 이미지, 영상, 렌더링, 스톡 사용량을 항목별로 기록한다.
- 일·월 예산 한도와 임계치 알림을 지원한다.
- 예산 초과 시 신규 생성을 중단하고 예약 콘텐츠 업로드 여부는 설정으로 분리한다.
- 검수 요청, 재고 부족, 게시 실패, 계정 문제, 정책·권리 위험, 예산 위험, 운영 요약, 최적화 제안, 전략 변경 알림을 제공한다.
- 콘텐츠가 부족하거나 검증에 실패하면 임의 콘텐츠를 게시하지 않고 보류한다.

## 2. v1 범위와 제외 범위

### v1 포함

- 개인 사용자 1명, 여러 채널
- YouTube, Instagram, TikTok 계정 연결과 계정-채널 1:1 귀속
- 9:16 숏폼, 공통 템플릿, 플랫폼별 출력 프로필
- 뉴스, 공식 자료, RSS 중심 소재 자동 수집
- 대본, 음성, 자막, AI 이미지, 스톡 소스를 활용한 영상 제작
- Remotion과 FFmpeg 기반 렌더링
- 사실, 출처, 권리, 독창성, 플랫폼 정책 검사
- 승인형과 완전 자동형
- 검수 화면, 콘텐츠 캘린더, 예약, 업로드, 재시도
- 기본 알림, 오류 로그, 비용·사용량 기록
- 플랫폼 성과 지표 동기화와 채널·콘텐츠·플랫폼별 분석
- 성공 패턴과 개선안 추천
- 사용자가 승인한 개선안의 전략·템플릿 버전 반영
- 제한된 성과 비교 실험과 개선 전후 확인

### v1 제외

- 팀 초대, 역할, 권한
- 모바일 앱
- 롱폼 콘텐츠
- 댓글 자동 답변과 커뮤니티 운영
- 자유 편집형 영상 편집기
- 결제, 구독제, 외부 고객용 SaaS 운영
- 사용자 허용 범위가 없는 무제한 자동 전략 변경
- 인과관계를 확정 판정하는 고급 통계·머신러닝 최적화
- 생성형 AI Video
- 마이크로서비스 전면 분리
- GraphQL
- Kubernetes
- 다중 DB

## 3. 핵심 엔터티와 상태 전이

### 핵심 엔터티

- `User`, `Workspace`, `Membership`: v1은 개인 사용자 중심이지만 확장 가능한 계정 경계만 둔다.
- `Channel`: 주제, 브랜드, 수집 규칙, 템플릿, 자동화 모드, 일정, 최소 재고를 가진다.
- `PlatformAccount`, `OAuthCredential`: 외부 SNS 계정과 암호화된 OAuth 토큰을 관리한다.
- `ContentItem`: 소재 후보부터 게시 완료까지 추적되는 콘텐츠 단위다.
- `Source`, `FactCheck`, `IdeaScore`: 수집 원문, 출처 신뢰도, 중복·적합도·위험도 근거를 보존한다.
- `ContentPlan`: 플랫폼 공통 기획안이다.
- `Script`, `SceneVersion`: 대본과 버전이 있는 Scene JSON이다.
- `Asset`, `AssetSource`, `AssetLicense`, `AssetUsage`: 미디어 자산과 권리 증빙이다.
- `ProductionJob`: 수집, 대본, 자산, TTS, 렌더 등 장시간 작업이다.
- `PolicyRule`, `PolicyCheck`, `PolicySnapshot`: 정책 규칙과 검사 결과 스냅샷이다.
- `PublishPlan`, `PublishAttempt`, `PlatformPost`: 예약, 업로드 시도, 외부 게시 결과다.
- `ProviderUsage`, `CostLedger`: 공급자 사용량과 비용 원장이다.
- `MetricSnapshot`, `OptimizationFinding`, `Experiment`, `StrategyVersion`: 성과 수집, 개선 가설, 실험, 전략 버전이다.
- `Notification`, `AuditLog`: 사용자 알림과 감사 이력이다.

### 콘텐츠 상태 전이

```text
IDEA
  -> VALIDATING
  -> GENERATING
  -> REVIEW_REQUIRED
  -> APPROVED
  -> SCHEDULED
  -> PUBLISHING
  -> PUBLISHED
```

예외 전이:

- 검증 실패, 정책 실패, 권리 불명, 강제 검수 조건: `FAILED` 또는 `HELD`
- 승인형 생성 완료: `REVIEW_REQUIRED`
- 완전 자동형 검사 통과: `SCHEDULED`
- 사용자 승인: `REVIEW_REQUIRED -> APPROVED`
- 사용자 보류: `REVIEW_REQUIRED -> HELD`
- 사용자 폐기: `REVIEW_REQUIRED -> FAILED`
- 게시 최종 실패: `PUBLISHING -> FAILED`
- 특정 플랫폼만 실패: 공통 콘텐츠는 유지하고 해당 플랫폼 결과물만 `HELD` 또는 `FAILED`

### 작업 상태 전이

```text
queued -> running -> succeeded
queued -> running -> retry_wait -> running
queued -> running -> needs_review
queued -> running -> failed
cancel_requested -> cancelled
```

## 4. 앱과 패키지 의존 방향

의존 방향은 앱에서 패키지로만 흐른다. 앱끼리 직접 참조하지 않는다.

```text
apps/web
  -> packages/contracts
  -> packages/config
  -> packages/logger

apps/api
  -> packages/contracts
  -> packages/database
  -> packages/providers
  -> packages/publishers
  -> packages/policy-engine
  -> packages/asset-library
  -> packages/config
  -> packages/logger

apps/worker
  -> packages/contracts
  -> packages/database
  -> packages/providers
  -> packages/policy-engine
  -> packages/asset-library
  -> packages/scene-schema
  -> packages/config
  -> packages/logger

apps/renderer
  -> packages/scene-schema
  -> packages/providers
  -> packages/config
  -> packages/logger

packages/publishers
  -> packages/contracts
  -> packages/policy-engine
  -> packages/logger

packages/providers
  -> packages/contracts
  -> packages/scene-schema
  -> packages/logger
```

`packages/database`는 Prisma schema, migrations, client만 제공하고 앱 레이어를 참조하지 않는다. `packages/contracts`는 DTO, Zod schema, OpenAPI 타입의 기준이며 데이터베이스 구현에 의존하지 않는다.

## 5. 전체 개발 단계 체크리스트

단계 번호와 커밋 메시지는 `docs/Postbot_Codex_전체_개발_프롬프트.md`를 단일 실행 기준으로 삼는다.

### 0단계. 저장소 분석 및 개발 계획 고정

- [x] 기준 문서와 저장소 규칙 확인
- [x] 기능 요구사항 도메인 분류
- [x] v1 범위와 제외 범위 정리
- [x] 핵심 엔터티와 상태 전이 정리
- [x] 앱·패키지 의존 방향 확정
- [x] 구현 전 결정 필요 항목과 외부 API 제약 문서화
- [x] 이후 Codex가 따를 루트 `AGENTS.md` 규칙 작성

매핑 요구사항: 0단계 완료 조건 전체.

### 1단계. 모노레포와 로컬 인프라 구축

- [x] pnpm workspace와 Turborepo 구성
- [x] `apps/web`, `apps/api`, `apps/worker`, `apps/renderer` 생성
- [x] 공통 `packages` 생성
- [x] Docker Compose로 MySQL 8, Redis, MinIO 구성
- [x] ESLint, Prettier, TypeScript strict, Vitest, Playwright 기본 설정
- [x] `.env.example`, 환경 변수 Zod 검증, `/health`, README 작성

매핑 요구사항: 기술 스택 확정, 모노레포 구조, 로컬 개발 재현, 테스트·CI 기준.

### 2단계. MySQL 핵심 데이터 모델과 Prisma 기반 구축

- [ ] Prisma 핵심 스키마와 최초 migration 작성
- [ ] FK, UNIQUE, 인덱스, UTC, DECIMAL, JSON 제한 사용 원칙 반영
- [ ] 계정-채널 귀속, 중복 게시, 멱등성 제약 설계
- [ ] seed, 테스트 DB 초기화, transaction helper 작성
- [ ] `docs/data-model.md` 작성

매핑 요구사항: 핵심 엔터티, 채널·계정 관계, 콘텐츠·작업 상태, 자산·권리, 정책 스냅샷, 비용·분석 엔터티.

### 3단계. 인증·사용자·보안 기반

- [x] 이메일/비밀번호 인증과 세션 갱신 구현
- [x] JWT + HttpOnly Cookie, CSRF, rate limit 적용
- [x] 사용자/워크스페이스 접근 권한 guard 구현
- [x] 쿠키·토큰·민감 정보 로그 유출 방지 검증

매핑 요구사항: 개인 사용자, 확장 가능한 계정 경계, 보안·감사 기준.

### 4단계. 채널·템플릿·일정 설정 Vertical Slice

- [x] 채널 CRUD와 일시 중지/재개
- [x] 공통 영상 템플릿, 플랫폼 출력 프로필, 수집 규칙, 일정, 최소 재고 저장
- [x] 승인형/완전 자동형과 오류 시 행동 설정
- [x] 첫 채널 생성 8단계 마법사 구현
- [x] 플랫폼 계정은 `연결 예정` 상태로만 표시하고 가짜 연결 성공은 만들지 않음

매핑 요구사항: 채널 모델, 설정 항목, 첫 채널 생성 UX, 자동화 제어.

### 5단계. SNS OAuth 연결 기반과 YouTube 연결

- [ ] PublisherProvider 공통 인터페이스 작성
- [ ] OAuth state/PKCE, callback, scope 검증 구현
- [ ] access/refresh token 애플리케이션 레벨 암호화
- [ ] YouTube 계정 연결·상태·해제 UX 구현
- [ ] Fake OAuth provider로 E2E 검증

매핑 요구사항: 플랫폼 계정 연결, 계정-채널 1:1 귀속, 토큰 보안, 외부 SNS API 격리.

### 6단계. BullMQ 작업 오케스트레이션과 진행 상태

- [ ] collect, script, asset, tts, render, policy, publish, analytics 큐 구성
- [ ] 작업 상태 전이, 재시도, timeout, 취소, 수동 복구 구현
- [ ] idempotency key와 중복 enqueue 방지
- [ ] API 즉시 작업 ID 반환, SSE 진행 이벤트와 REST 복구 구현

매핑 요구사항: 장시간 작업 분리, 진행 상태, 멱등성, 재시도.

### 7단계. 소재 자동 수집과 아이디어 관리

- [ ] TopicSourceProvider와 수집 fixture 구현
- [ ] RSS, 공식 URL, 허용 공개 소스 기반 수집
- [ ] 정규화, 중복 제거, 출처 신뢰도, 최신성, 채널 적합도 산정
- [ ] 금지 주제, 제외 키워드, 아이디어 상태와 관리 UI 구현

매핑 요구사항: 소재 자동 수집, 최신 콘텐츠 원칙, 아이디어 메뉴, Fail-safe.

### 8단계. GPT 기반 대본·Scene JSON 생성

- [ ] LLMProvider와 OpenAI/Fake 구현
- [ ] 공통 기획안, 대본, 메타데이터, SceneDocument 생성
- [ ] SceneDocument v1 Zod/JSON Schema와 Structured Output 검증
- [ ] ScriptVersion, SceneVersion, 프롬프트 버전, 비용 기록
- [ ] Hook, 대본, 메타데이터, 특정 scene 부분 재생성

매핑 요구사항: 원본 콘텐츠 제작, 공통 기획안, Scene JSON, Provider 격리.

### 9단계. Asset Library·이미지·TTS 파이프라인

- [ ] ImageProvider, TTSProvider, AssetProvider, StorageProvider와 Fake 구현
- [ ] 내부 Asset Library, 라이선스 허용 자료, Gemini 이미지 생성 fallback
- [ ] ElevenLabs TTS와 타이밍 저장
- [ ] 출처, 라이선스, 상업 이용, 비용, checksum, 권리 차단 구현

매핑 요구사항: AI·스톡 혼합, 권리 관리, 자막 타이밍, 사용량·비용.

### 10단계. Remotion·FFmpeg 영상 렌더러

- [ ] 필수 Scene 컴포넌트 구현
- [ ] 1080x1920, 안전 영역, fps, duration 규칙 적용
- [ ] TTS timing 기반 자막, BGM/SFX ducking, FFmpeg 후처리
- [ ] 결과 MP4, thumbnail, render manifest 저장
- [ ] 재생 가능 여부, 해상도, 길이, 음량, 검은 프레임, 자막 QA

매핑 요구사항: 9:16 숏폼 렌더링, 미디어 QA, S3/MinIO 저장.

### 11단계. 정책 검사·검수·승인 UX

- [ ] Policy Engine 규칙 버전과 검사 스냅샷 구현
- [ ] 사실, 출처, 권리, 독창성, AI disclosure, 플랫폼별 길이·형식 검사
- [ ] 적합, 주의, 부적합, 확인 불가 결과와 근거 표시
- [ ] 검수 화면, 편집, 부분 재생성, 승인·예약·보류·폐기 구현

매핑 요구사항: 정책 검사, 강제 검수, 검수 UX, 수익화 보장 금지.

### 12단계. 대시보드·캘린더·운영 UX 완성

- [ ] 홈, 채널, 아이디어, 콘텐츠, 캘린더, 계정, 사용량·설정 화면 완성
- [ ] 예정·성공·실패, 다음 게시, 검수 필요, 채널 상태, 재고, 오류, 비용 표시
- [ ] 로딩, 빈 상태, 오류, 권한 없음, 재시도 상태 구현
- [ ] SSE 실시간 상태와 REST 복구 검증

매핑 요구사항: 메인 화면, 주요 메뉴, 콘텐츠 캘린더, 운영 UX.

### 13단계. 예약·YouTube Shorts 업로드

- [ ] 예약 탐색과 publish queue enqueue 구현
- [ ] 빈 슬롯 자동 배치와 수동 예약 변경
- [ ] 게시 직전 계정, 토큰, 파일, 정책 스냅샷 재검사
- [ ] YouTube validate/publish/status와 중복 업로드 방지 구현
- [ ] 외부 post ID, URL, 게시 시각, 응답 스냅샷 저장

매핑 요구사항: 예약·업로드, YouTube 게시, 멱등성, 재시도, 성공·실패 이력.

### 14단계. Instagram Reels·TikTok 게시 확장

- [ ] Instagram/TikTok OAuth, scope, 계정 상태 구현
- [ ] 플랫폼별 validate, publish, status 구현
- [ ] 플랫폼별 출력 프로필과 정책 규칙 적용
- [ ] 한 플랫폼 실패가 다른 플랫폼 게시를 막지 않도록 검증

매핑 요구사항: 세 플랫폼 지원, 플랫폼별 독립 결과물, 정책 차이 처리.

### 15단계. 완전 자동 운영과 안전장치

- [ ] 소재 수집부터 게시까지 자동 연결
- [ ] 최소 콘텐츠 재고, 선행 생성, 최대 재생성 횟수 구현
- [ ] 부적합·확인 불가·권리 불명 자동 게시 금지
- [ ] 예산 hard limit, pause/resume, kill switch, 작업 drain 구현
- [ ] 게시 폭주, 동일 소재 반복, 연속 실패 방지

매핑 요구사항: 완전 자동형, 강제 검수, 오류 정책, 안전한 중단, 예산 보호.

### 16단계. 성과 데이터 수집과 분석 대시보드

- [ ] AnalyticsProvider와 플랫폼별 metric mapping 구현
- [ ] 원본 지표와 정규화 지표 보존
- [ ] unavailable 지표, 기준 기간, timezone, 마지막 동기화, 데이터 지연 표시
- [ ] 채널·콘텐츠·플랫폼·기간별 대시보드와 요약 구현

매핑 요구사항: 성과 데이터 수집, 플랫폼 간 지표 차이, 비용 대비 성과.

### 17단계. 성공 패턴 추출과 콘텐츠 최적화

- [ ] 상위·하위 성과군 비교와 패턴 후보 추출
- [ ] 표본 부족 시 가설 표시
- [ ] 근거 콘텐츠, 비교 기간, 표본 수, 기대 효과, 신뢰도 제공
- [ ] 개선안 승인·거절·보류, StrategyVersion 반영, rollback 구현
- [ ] 제한 실험과 보호 설정 자동 변경 금지

매핑 요구사항: 성공 패턴, 개선 제안, 실험, 전략 버전, 최적화 안전장치.

### 18단계. 비용·알림·관측성·보안 강화

- [ ] 콘텐츠·채널·Provider별 예상/실제 비용과 budget hard limit 구현
- [ ] 검수, 재고 부족, 게시 실패, 토큰 만료, 정책 위험, 예산, 최적화 알림 구현
- [ ] Pino correlation ID, Sentry, 민감정보 제거, 감사 로그 조회 구현
- [ ] 데이터 보존·삭제, OAuth 키 rotation, 백업·복구 문서 작성

매핑 요구사항: 운영·비용·알림, 관측성, 보안 강화.

### 19단계. 전체 회귀 테스트·배포 준비·v1 완료 판정

- [ ] 명세 요구사항과 코드·테스트 추적 매트릭스 작성
- [ ] 전체 Fake Provider E2E 실행
- [ ] migration, 장애 시뮬레이션, lint, typecheck, unit, integration, contract, Playwright, renderer smoke test 실행
- [ ] Docker production build, healthcheck, CI/CD, 운영 runbook 검증
- [ ] README와 `docs/v1-acceptance-report.md` 작성

매핑 요구사항: 제품 단위 완료 기준, CI/CD, 배포 준비, 변경 관리, v1 완료 판정.

## 6. 기능 요구사항 매핑 검토

아래 명세 섹션은 모두 개발 단계에 매핑된다.

- 제품 범위: 1, 4, 5, 10, 13, 14, 15단계
- 정보 구조 및 채널 모델: 2, 4, 5단계
- 콘텐츠 자동화 파이프라인: 6, 7, 8, 9, 10, 11, 13, 14, 15단계
- 영상 소스 및 권리 관리: 8, 9, 11단계
- 플랫폼별 출력 및 수익화 적합성: 4, 8, 10, 11, 13, 14단계
- 자동화 모드 및 예외 정책: 6, 11, 13, 15, 18단계
- UX 명세: 4, 7, 11, 12, 16, 17단계
- 콘텐츠 검수 및 게시 UX: 10, 11, 12, 13단계
- 성과 분석 및 콘텐츠 최적화: 16, 17단계
- 운영·비용·알림: 18단계
- 초기 개발 범위와 완료 기준: 전체 단계
