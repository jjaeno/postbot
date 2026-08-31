> [!IMPORTANT]
> 이 문서는 Postbot v1 전체 개발 순서를 보존하는 참고용 마스터 로드맵이다.
>
> Codex가 개별 단계를 수행할 때 이 문서 전체를 읽지 않는다.
>
> 실행 기준:
> - 공통 규칙: `/AGENTS.md`
> - 단계 범위·완료 조건·커밋 메시지: `/docs/implementation-plan.md`
> - 확정 기술 결정: `/docs/architecture-decisions.md`
>
> 본 문서와 위 실행 기준이 충돌하면 위 실행 기준을 우선한다.

# Postbot 전체 개발용 Codex 프롬프트

이 문서는 Postbot을 빈 저장소부터 실제 배포 가능한 v1까지 순차적으로 개발하기 위한 프롬프트 묶음이다.

## 단계별 구현 프롬프트
docs/implementation-plan.md의 ?단계를 구현해.

루트 AGENTS.md를 따르고, 필요한 기존 기술 결정만
docs/architecture-decisions.md에서 확인해.

?단계 범위를 벗어나지 말고 필수 검증 후 지정된 메시지로 커밋해.

## 사용 방법

1. 저장소의 `docs/`에 다음 문서를 넣는다.
   - `Postbot_기능_UX_명세서_v0.2.docx`
   - `Postbot_v1_기술_스택_확정서.docx`
2. 아래 프롬프트를 번호 순서대로 Codex에 한 개씩 전달한다.
3. 각 단계의 테스트와 커밋이 성공한 뒤 다음 프롬프트를 실행한다.
4. 실제 API 키가 필요한 단계에서는 `.env.example`만 작성하고, 키가 없다면 Mock Provider로 검증한다.
5. Codex가 기존 코드와 명세 사이의 모순을 발견하면 임의로 큰 결정을 내리지 말고 기록한 뒤 질문하도록 한다.

---

## 모든 단계에 공통으로 붙일 실행 규칙

아래 블록을 각 단계 프롬프트 뒤에 붙여도 되고, 첫 실행에서 `AGENTS.md`에 반영해도 된다.

```text
공통 실행 규칙:

1. 작업 전 저장소 전체 구조, AGENTS.md, README, docs의 기능 명세서와 기술 스택 확정서를 읽어라.
2. 현재 단계의 범위를 벗어난 기능을 임의로 구현하지 마라. 다음 단계와 연결할 인터페이스만 정의하라.
3. 기존 사용자 변경과 관련 없는 파일을 되돌리거나 덮어쓰지 마라.
4. 구현 전에 현재 상태와 이번 단계의 세부 작업 계획을 짧게 정리하라.
5. TypeScript strict를 유지하고 any, ts-ignore, 임시 하드코딩을 피하라.
6. 외부 Provider와 SNS API는 인터페이스 뒤에 격리하고 테스트용 Fake/Mock 구현을 제공하라.
7. DB 변경은 Prisma migration으로 만들고 스키마, 인덱스, FK, UNIQUE, UTC, DECIMAL 원칙을 지켜라.
8. 장시간 작업은 HTTP 요청 안에서 실행하지 말고 BullMQ 작업으로 처리하라.
9. 생성·렌더·게시 작업에는 멱등성 키를 적용하고 재시도 시 중복 결과가 생기지 않게 하라.
10. 인증 토큰, OAuth 토큰, API 키, 개인정보가 로그에 남지 않게 하라.
11. 구현 후 lint, typecheck, 관련 단위·통합 테스트를 실행하고 실패 원인을 수정하라.
12. 실행하지 못한 테스트는 숨기지 말고 이유와 필요한 환경을 명시하라.
13. API, 환경 변수, 상태 전이, 운영 방법이 바뀌면 docs도 함께 갱신하라.
14. 완료 후 변경 파일, 핵심 구현, 테스트 결과, 남은 위험을 요약하라.
15. 모든 검증이 성공했을 때만 커밋하라. 커밋 메시지는 한국어로 작성하고 한 단계당 하나의 논리적 커밋을 기본으로 하라.
16. 다음 단계 작업은 수행하지 말고 종료하라.
```

---

# 0단계. 저장소 분석 및 개발 계획 고정

```text
Postbot 신규 프로젝트 개발을 시작한다.

docs/Postbot_기능_UX_명세서_v0.2.docx와 docs/Postbot_v1_기술_스택_확정서.docx를 읽고, 두 문서를 구현의 기준으로 사용하라. 아직 애플리케이션 코드는 만들지 말고 다음 작업만 수행하라.

1. 기능 요구사항을 도메인별로 분류한다.
2. v1 범위와 제외 범위를 명확히 정리한다.
3. 핵심 도메인 엔터티와 상태 전이를 정리한다.
4. apps/web, apps/api, apps/worker, apps/renderer와 packages의 의존 방향을 확정한다.
5. 전체 개발 단계를 체크리스트로 작성한다.
6. 기술 결정과 명세 사이의 모순, 구현 전 결정이 필요한 항목, 외부 API 제약을 별도 목록으로 작성한다.
7. 결과를 docs/implementation-plan.md와 docs/architecture-decisions.md에 저장한다.
8. 이후 Codex가 따라야 할 저장소 규칙을 루트 AGENTS.md에 작성한다.

완료 조건:
- 기능 명세의 모든 요구사항이 개발 단계 중 하나에 매핑되어 있다.
- 아직 결정되지 않은 항목이 숨겨지지 않고 문서화되어 있다.
- 애플리케이션 코드는 생성하지 않는다.
- 문서를 검토한 뒤 `docs: Postbot 구현 계획과 개발 규칙 정리`로 커밋한다.
```

# 1단계. 모노레포와 로컬 인프라 구축

```text
Postbot 모노레포의 실행 가능한 기반을 구축하라.

구현 범위:
- pnpm workspace와 Turborepo
- apps/web: React, Vite, TypeScript
- apps/api: NestJS
- apps/worker: NestJS standalone worker 또는 명확한 Node worker 엔트리
- apps/renderer: Remotion 프로젝트와 최소 샘플 composition
- packages/config, contracts, database, logger, providers, scene-schema, publishers, policy-engine
- ESLint, Prettier, TypeScript strict 공통 설정
- Docker Compose의 MySQL 8, Redis, MinIO
- 루트 명령어 dev, build, lint, typecheck, test
- `.env.example`과 환경 변수 Zod 검증
- `/health` API와 web의 API 연결 상태 확인 화면

제약:
- 비즈니스 기능은 구현하지 않는다.
- 실제 비밀값을 저장소에 넣지 않는다.
- 앱 간 내부 소스 직접 참조를 막고 packages의 공개 export만 사용한다.

검증:
- 깨끗한 환경에서 pnpm install이 성공한다.
- Docker Compose 서비스가 healthcheck를 통과한다.
- web, api, worker, renderer가 각각 실행된다.
- 전체 lint, typecheck, test, build가 성공한다.
- README에 로컬 실행법을 작성한다.

성공 시 `chore: Postbot 모노레포와 로컬 인프라 구축`으로 커밋한다.
```

# 2단계. MySQL 핵심 데이터 모델과 Prisma 기반 구축

```text
기능 명세와 기술 확정서를 기준으로 Postbot의 핵심 MySQL 데이터 모델을 구현하라.

필수 모델:
- User, Workspace, Membership
- Channel, PlatformAccount, OAuthCredential
- ChannelTemplate, PlatformOutputProfile, ScheduleRule
- ContentItem, SourceReference, ScriptVersion, SceneVersion
- Asset, AssetSource, AssetLicense, AssetUsage
- ProductionJob, JobAttempt
- PolicyRule, PolicyCheck, PolicySnapshot
- PublishPlan, PublishAttempt, PlatformPost
- ProviderUsage, CostLedger
- StrategyVersion, OptimizationSuggestion, Experiment

규칙:
- MySQL 8, InnoDB, utf8mb4를 전제로 한다.
- 관계형 데이터를 우선하고 Scene JSON, Provider 원본 응답 등 유동 데이터만 JSON으로 둔다.
- 금액은 DECIMAL, 시간은 UTC로 저장한다.
- 계정-채널 귀속, 중복 게시, 멱등성에 필요한 UNIQUE 제약을 설계한다.
- 삭제 정책을 명시하고 무분별한 cascade delete를 피한다.
- OAuth 토큰 컬럼은 평문 사용을 전제로 만들지 않는다.
- 상태 값은 코드와 DB에서 일관된 enum 또는 제약으로 관리한다.

추가 작업:
- 최초 Prisma migration과 seed를 만든다.
- 테스트 DB 초기화 명령을 제공한다.
- repository/service 계층에서 사용할 transaction helper를 만든다.
- docs/data-model.md에 엔터티 관계, 주요 인덱스, 보존·삭제 원칙을 기록한다.

검증:
- 빈 DB migration, seed, reset이 성공한다.
- FK, UNIQUE, DECIMAL, UTC, idempotency 제약에 대한 통합 테스트가 통과한다.

성공 시 `feat: Postbot 핵심 데이터 모델과 마이그레이션 구현`으로 커밋한다.
```

# 3단계. 인증·사용자·보안 기반

```text
개인 사용자로 시작하되 향후 워크스페이스 확장이 가능한 인증 기반을 구현하라.

백엔드:
- 이메일/비밀번호 회원가입, 로그인, 로그아웃, 세션 갱신, 내 정보 조회
- 비밀번호 안전한 해싱
- 짧은 수명의 access token과 refresh token 회전
- HttpOnly, Secure, SameSite 쿠키
- CSRF 방어, 요청 검증, 기본 rate limit
- 사용자/워크스페이스 접근 권한 guard
- refresh token 폐기와 탈취 재사용 탐지

프론트엔드:
- 로그인, 회원가입, 세션 복구, 로그아웃
- 보호 라우트와 인증 만료 UX
- 오류를 사용자에게 이해 가능한 문장으로 표시

테스트:
- 정상 인증 흐름과 잘못된 비밀번호
- 만료·갱신·로그아웃·토큰 재사용
- 다른 사용자의 리소스 접근 차단
- 쿠키와 민감 정보 로그 유출 여부

OpenAPI와 README를 갱신하고 `feat: 사용자 인증과 보안 세션 구현`으로 커밋한다.
```

# 4단계. 채널·템플릿·일정 설정 Vertical Slice

```text
Postbot의 첫 완성형 Vertical Slice로 채널 생성과 설정 기능을 백엔드부터 프론트엔드까지 구현하라.

백엔드:
- 채널 CRUD와 일시 중지/재개
- 한 채널은 하나의 명확한 주제·시청자·언어를 가짐
- 플랫폼 계정은 한 채널에만 귀속되는 규칙
- 공통 영상 템플릿, 플랫폼별 출력 프로필, 수집 규칙, 게시 일정, 최소 콘텐츠 재고
- 승인형/완전 자동형 선택과 자동화 안전 설정
- Zod/DTO/OpenAPI 계약

프론트엔드:
- 채널 목록과 상태
- 기능 명세의 8단계 채널 생성 마법사 UI
- 아직 OAuth가 없는 플랫폼은 `연결 예정` 상태로 처리하되 가짜 연결 성공을 만들지 않는다.
- 설정 수정, 일시 중지, 재개

테스트:
- API 단위·통합 테스트
- 마법사 생성과 수정 Playwright E2E
- 잘못된 일정, 계정 중복 귀속, 권한 위반 검증

성공 시 `feat: 채널 생성 마법사와 운영 설정 구현`으로 커밋한다.
```

# 5단계. SNS OAuth 연결 기반과 YouTube 연결

```text
플랫폼 계정 연결 구조와 YouTube OAuth를 우선 구현하라.

구현:
- PublisherProvider 공통 인터페이스
- OAuth state/PKCE, callback, scope 검증
- access/refresh token 애플리케이션 레벨 암호화
- 키 버전과 향후 재암호화가 가능한 구조
- YouTube 계정 연결, 채널 정보 조회, 연결 상태·만료·권한 부족 표시, 연결 해제
- 한 플랫폼 계정의 중복 귀속 방지
- 실제 인증정보가 없을 때 E2E를 위한 Fake OAuth provider
- 프론트엔드 계정 연결·재연결·해제 UX

주의:
- 토큰과 authorization code를 로그에 남기지 않는다.
- 실제 업로드는 아직 구현하지 않는다.
- 공식 API 제한 때문에 불가능한 동작을 가짜 성공으로 처리하지 않는다.

검증:
- state 위조, callback 재사용, 토큰 암복호화, scope 부족, 연결 해제 테스트
- Fake Provider 기반 Playwright E2E

성공 시 `feat: SNS OAuth 기반과 YouTube 계정 연결 구현`으로 커밋한다.
```

# 6단계. BullMQ 작업 오케스트레이션과 진행 상태

```text
장시간 콘텐츠 제작 파이프라인의 공통 작업 엔진을 구현하라.

구현:
- collect, script, asset, tts, render, policy, publish, analytics queue
- queued, running, retry_wait, succeeded, needs_review, failed, cancel_requested, cancelled 상태 전이
- 작업·시도·오류 분류·진행률을 MySQL과 Redis에 적절히 저장
- 지수 백오프, 최대 재시도, timeout, dead-letter 또는 수동 복구 경로
- idempotency key와 중복 enqueue 방지
- API는 작업 ID를 즉시 반환
- SSE를 통한 작업 진행 이벤트와 끊김 후 REST 복구
- 취소 가능한 단계와 취소 불가능한 단계 구분
- 테스트용 deterministic worker

테스트:
- 성공, 재시도 후 성공, 영구 실패, 중복 요청, 취소, worker 재시작 복구
- SSE 재연결과 권한 검사

docs/job-system.md를 작성하고 `feat: 비동기 작업 엔진과 진행 상태 구현`으로 커밋한다.
```

# 7단계. 소재 자동 수집과 아이디어 관리

```text
채널 설정에 따른 소재 수집과 아이디어 관리 기능을 구현하라.

구현:
- AssetProvider와 TopicSourceProvider 인터페이스
- RSS, 사용자가 지정한 공식 URL, 허용된 공개 소스 기반 수집
- URL canonicalization, 콘텐츠 hash, 유사 제목 기반 중복 제거
- 채널 주제 적합성, 최신성, 출처 신뢰도, 예상 시청 가치 점수
- 금지 주제와 제외 키워드
- 원문 전체 무단 저장 대신 필요한 메타데이터·짧은 근거·출처 스냅샷
- 아이디어 상태: candidate, shortlisted, rejected, used, expired
- 아이디어 목록, 필터, 근거, 점수 설명, 채택·제외 프론트 UI
- 자동 수집 스케줄과 수동 실행

실제 웹 수집이 불가능한 테스트 환경을 위해 fixture source를 제공한다.

검증:
- 동일 기사 중복 제거, 출처 실패, 금지 주제, 채널 간 분리
- 수집 작업 재시도와 멱등성
- API 및 Playwright E2E

성공 시 `feat: 소재 자동 수집과 아이디어 관리 구현`으로 커밋한다.
```

# 8단계. GPT 기반 대본·Scene JSON 생성

```text
GPT-5 mini를 사용하는 콘텐츠 기획·대본·Scene Director 파이프라인을 구현하라.

구현:
- LLMProvider와 OpenAI 구현, Fake 구현
- 모델명은 환경 설정으로 주입
- 입력: 채널 전략, 아이디어, 출처, 플랫폼 프로필, 금지 규칙
- 출력: 핵심 주장, Hook, 팩트 단위와 출처 연결, 숏폼 대본, 제목·설명·해시태그, SceneDocument
- packages/scene-schema에 버전이 있는 엄격한 Zod/JSON Schema
- Structured Output 검증과 제한된 자동 재생성
- ScriptVersion, SceneVersion 저장 및 변경 이력
- 프롬프트 버전, 모델, 토큰 사용량, 비용 기록
- 출처 없는 사실을 확정 표현하지 않도록 검증
- 부분 재생성: Hook, 대본, 메타데이터, 특정 scene

현재 단계에서는 실제 이미지·TTS·영상 렌더링을 수행하지 않는다.

테스트:
- Fake Provider deterministic snapshot
- 잘못된 JSON, 누락 출처, 길이 초과, 재시도, 중복 요청
- 실제 Provider 테스트는 opt-in 명령으로 분리

성공 시 `feat: 대본과 Scene JSON 생성 파이프라인 구현`으로 커밋한다.
```

# 9단계. Asset Library·이미지·TTS 파이프라인

```text
SceneDocument가 요구하는 시각·음성 자산을 준비하는 파이프라인을 구현하라.

자산 선택 순서:
1. 내부 Asset Library
2. 상업 이용이 허용된 실제 자료
3. Gemini 3.1 Flash Lite Image 생성

구현:
- ImageProvider, TTSProvider, AssetProvider, StorageProvider 인터페이스
- Gemini 이미지와 ElevenLabs Flash v2.5 구현, Fake 구현
- S3/MinIO 객체 저장 경로와 메타데이터
- checksum 기반 중복 저장 방지
- 출처 URL, 라이선스, 상업 이용, 가공, 표시 조건, 확인 시각 기록
- 라이선스 불명확 자산은 자동 게시 불가
- TTS 오디오와 문장/단어 타이밍 저장
- BGM/SFX Asset Library와 음량 메타데이터
- 사용량과 비용 원장
- 실패 시 대체 자산 탐색 또는 needs_review

테스트:
- 세 단계 fallback, checksum 중복 제거, 라이선스 차단, TTS timing, 비용 기록
- Fake Provider 기반 통합 테스트

성공 시 `feat: 이미지 음성 자산 준비 파이프라인 구현`으로 커밋한다.
```

# 10단계. Remotion·FFmpeg 영상 렌더러

```text
생성형 비디오 API 없이 SceneDocument를 실제 9:16 숏폼 MP4로 렌더링하는 엔진을 구현하라.

필수 Scene 컴포넌트:
- ImageScene, DiagramScene, BigNumberScene, TimelineScene
- ComparisonScene, ChartScene, QuoteScene, ListScene, SummaryScene

구현:
- 1080x1920, 안전 영역, fps, duration 규칙
- TTS timing 기반 animated caption
- 이미지 slow zoom/pan, 기본 transition, 브랜드 토큰
- BGM/SFX ducking과 음성 중심 믹싱
- Remotion 렌더 후 FFmpeg normalization, encoding, compression
- 격리된 임시 작업 폴더와 정리
- 진행률, timeout, 취소, 재시도, 멱등성
- 결과 MP4, thumbnail, render manifest를 S3/MinIO 저장
- 렌더러 버전과 Scene schema 버전 기록
- 폰트와 FFmpeg 버전을 컨테이너에 고정

자동 QA:
- 재생 가능 여부, 해상도, 길이, 오디오 존재, 음량, 검은 프레임, 자막 안전 영역

검증:
- 15초와 60초 fixture 영상 렌더
- 각 scene 컴포넌트 시각 snapshot 또는 프레임 검증
- 동일 입력 재실행 시 중복 비용·파일 방지

성공 시 `feat: Remotion 기반 숏폼 렌더링 엔진 구현`으로 커밋한다.
```

# 11단계. 정책 검사·검수·승인 UX

```text
콘텐츠가 게시되기 전에 사실·출처·권리·독창성·플랫폼 규칙을 검사하고 사용자가 검수하는 기능을 구현하라.

백엔드:
- Policy Engine의 버전 있는 규칙 구조
- 플랫폼/국가/시행일/마지막 확인일
- 적합, 주의, 부적합, 확인 불가 결과와 근거
- 사실 주장과 SourceReference 연결 검사
- 자산 라이선스와 AI disclosure 필요 여부 검사
- 반복적·저가치·재사용 콘텐츠 위험 신호
- 플랫폼별 길이·형식·메타데이터 검사
- 정책 스냅샷과 게시 당시 판단 보존
- REVIEW_REQUIRED, APPROVED, SCHEDULED 등 상태 전이와 권한 검증

프론트엔드:
- 공통 기획과 플랫폼 탭
- 영상 미리보기, 대본·제목·설명·해시태그·커버 수정
- 특정 대본·음성·장면·자막·플랫폼 버전 부분 재생성
- 검사 결과와 근거 표시
- 승인, 예약 변경, 보류, 폐기, 전체 재생성

주의:
- 정책 준수를 보증한다는 표현을 사용하지 않는다.
- 부적합은 자동 게시를 차단하고 확인 불가는 강제 검수한다.

E2E까지 검증하고 `feat: 콘텐츠 정책 검사와 승인 워크플로 구현`으로 커밋한다.
```

# 12단계. 대시보드·캘린더·운영 UX 완성

```text
기능 명세의 핵심 운영 화면을 완성하라.

구현 화면:
- 홈: 오늘 예정·성공·실패, 다음 게시, 검수 필요, 채널 상태, 재고, 오류, 비용
- 채널: 설정, 연결 계정, 템플릿, 일정, 자동화 제어
- 아이디어: 수집 후보, 점수, 출처, 채택·제외
- 콘텐츠: 생성 상태, 미리보기, 버전, 승인·폐기
- 캘린더: 플랫폼별 예약, 빈 슬롯, 드래그 변경
- 계정: OAuth 연결, 만료, 권한, 연결 해제
- 사용량·설정: 예산, 알림, Provider 상태

UX 원칙:
- 로딩, 빈 상태, 오류, 재시도, 권한 없음 상태를 모두 설계한다.
- SSE 실시간 상태와 REST 복구가 화면에서 일관되게 동작한다.
- 모바일 앱은 아니지만 데스크톱과 태블릿에서 사용할 수 있게 반응형으로 만든다.
- 접근 가능한 label, focus, keyboard, contrast를 적용한다.

Playwright로 핵심 사용자 여정을 검증하고 `feat: Postbot 운영 대시보드와 캘린더 완성`으로 커밋한다.
```

# 13단계. 예약·YouTube Shorts 업로드

```text
승인된 콘텐츠를 예약하고 YouTube Shorts에 중복 없이 게시하는 기능을 구현하라.

구현:
- NestJS Scheduler는 예약 시각을 탐색하고 실제 게시 작업은 BullMQ에 enqueue
- 빈 슬롯 자동 배치와 수동 예약 변경
- 게시 직전 계정, 토큰, 파일, 정책 스냅샷 재검사
- YouTube PublisherProvider validate/publish/status
- upload idempotency key와 PublishAttempt
- 일시 오류와 영구 오류 분류, 지수 백오프
- 애매한 timeout 후 재업로드 전에 플랫폼 상태 확인
- 성공 시 외부 post ID, URL, 게시 시각, 응답 스냅샷 저장
- 실패·재시도·수동 복구 UX
- API 감사 또는 제한으로 비공개 업로드만 가능한 경우 상태와 운영 절차를 명확히 표시

테스트:
- Fake Publisher 전체 E2E
- 실제 YouTube sandbox/테스트 계정 검증은 opt-in
- 중복 요청, worker 재시작, 토큰 만료, 정책 변경, 애매한 timeout

성공 시 `feat: YouTube Shorts 예약 게시 파이프라인 구현`으로 커밋한다.
```

# 14단계. Instagram Reels·TikTok 게시 확장

```text
기존 PublisherProvider와 게시 파이프라인을 재사용해 Instagram Reels와 TikTok을 추가하라.

구현:
- 각 플랫폼 OAuth, 계정 상태, scope 검증
- 플랫폼별 validate, publish, status 구현
- 기능 명세의 플랫폼 출력 프로필과 정책 규칙 적용
- 공통 기획에서 플랫폼별 독립 렌더·메타데이터·게시 시각
- AI 생성물 표시나 공개 옵션이 필요한 경우 명시적으로 처리
- 플랫폼 API가 지원하지 않는 기능은 UI에서 비활성화하고 이유 표시
- 계정/앱 검수 전에는 Fake Publisher로 전체 흐름 검증 가능

테스트:
- 공통 Publisher contract test를 세 플랫폼 구현체에 동일 적용
- 한 플랫폼 실패가 다른 플랫폼 게시를 막지 않는지 검증
- 중복 게시, 토큰 만료, 권한 부족, 정책 차이

성공 시 `feat: Instagram과 TikTok 게시 연동 확장`으로 커밋한다.
```

# 15단계. 완전 자동 운영과 안전장치

```text
승인형으로 완성된 파이프라인 위에 사용자가 선택할 수 있는 완전 자동 운영을 구현하라.

구현:
- 채널별 승인형/완전 자동형
- 최소 콘텐츠 재고와 선행 생성
- 소재 수집→대본→자산→렌더→정책 검사→예약→게시 자동 연결
- 주의 등급 처리, 최대 재생성 횟수, 실패 시 보류 규칙
- 부적합·확인 불가·라이선스 불명확은 자동 게시 금지
- 일/월 예산 hard limit과 단계별 비용 사전 확인
- 채널 pause/resume, kill switch, 작업 drain
- 동일 소재 반복, 게시 폭주, 연속 실패 방지
- 중요한 자동 결정 감사 로그와 일간 운영 요약

테스트:
- 24시간 가상 시간 기반 스케줄 시뮬레이션
- 재고 부족, API 장애, 예산 초과, 정책 실패, 계정 만료, 중단·재개
- 승인형 채널에 자동 게시되지 않는지 회귀 테스트

성공 시 `feat: 안전한 완전 자동 콘텐츠 운영 구현`으로 커밋한다.
```

# 16단계. 성과 데이터 수집과 분석 대시보드

```text
게시된 콘텐츠의 성과를 플랫폼에서 동기화하고 비교 가능한 범위에서 분석하는 기능을 구현하라.

수집 항목:
- 조회·노출·도달·조회 증가 속도
- 평균 시청 시간·완주율·이탈·반복 재생
- 좋아요·댓글·공유·저장·팔로우/구독 전환
- 주제, Hook, 길이, 첫 장면, 장면 전환, 자막, 음성, BGM
- 플랫폼, 요일, 시간, 게시 간격, 해시태그
- 제작비, 1천 조회당 비용, 비용 대비 성과

구현:
- AnalyticsProvider와 플랫폼별 metric mapping
- 플랫폼 원본 지표와 Postbot 정규화 지표를 함께 보존
- 지원하지 않는 지표를 추정하지 않고 unavailable로 표시
- 기준 기간, timezone, 마지막 동기화, 데이터 지연 표시
- 주기적 동기화와 수동 새로고침, rate limit 대응
- 채널·콘텐츠·플랫폼·기간별 대시보드
- 일간·주간 요약

테스트:
- Fake metric fixture, 누락 지표, 중복 동기화, 수정된 플랫폼 수치, timezone
- 플랫폼 간 의미가 다른 지표를 잘못 합산하지 않는지 검증

성공 시 `feat: 플랫폼 성과 수집과 분석 대시보드 구현`으로 커밋한다.
```

# 17단계. 성공 패턴 추출과 콘텐츠 최적화

```text
성과 분석 결과를 다음 콘텐츠 개선으로 연결하는 폐쇄 루프를 구현하라.

구현:
- 채널·플랫폼 내부에서 최근 콘텐츠의 상위/하위 성과군 비교
- 주제, Hook 유형, 길이, 첫 장면, 전환 속도, 자막, 음성, 게시 시간 등의 후보 패턴 추출
- 최소 표본 수와 관찰 기간 미달 시 `가설`로 표시
- 근거 콘텐츠, 비교 기간, 표본 수, 기대 효과, 신뢰도 제공
- OptimizationSuggestion의 제안·채택·거절·보류
- 변경 가능한 항목과 보호 항목 분리
- 승인된 제안을 StrategyVersion과 템플릿/생성 설정에 버전 반영
- 이전 전략으로 rollback
- 제한된 콘텐츠에 기존/개선 전략을 배정하는 Experiment
- 실험 기간, 비율, 중단 조건, 승자 판단 기준
- 완주율·반응·전환·비용·정책 위험을 함께 평가

자동화 모드:
- 승인형은 모든 변경을 사용자 승인 후 반영
- 완전 자동형도 사용자가 허용한 항목과 변화 폭 안에서만 실험·반영
- 채널 주제, 금지 소재, 사실·권리·정책, 예산 상한은 자동 변경 금지

주의:
- 상관관계를 인과관계로 단정하지 않는다.
- 조회수가 높은 단일 바이럴 영상이 전체 전략을 즉시 바꾸지 못하게 한다.

테스트:
- 표본 부족, 이상치, 플랫폼 분리, 승인/거절, 자동 범위 제한, rollback, 실험 중단
- 개선 전후 대시보드 Playwright E2E

성공 시 `feat: 성공 패턴 기반 콘텐츠 최적화 구현`으로 커밋한다.
```

# 18단계. 비용·알림·관측성·보안 강화

```text
Postbot을 실제 장기 운영할 수 있도록 비용, 알림, 로그, 오류 추적과 보안을 강화하라.

구현:
- 콘텐츠·채널·Provider별 예상/실제 비용
- 일·월 budget과 hard limit
- 검수, 재고 부족, 게시 실패, 토큰 만료, 정책 위험, 예산, 최적화 제안 알림
- Pino 구조화 로그와 request/job/content correlation ID
- Sentry 오류·release 연동과 민감정보 제거
- 관리자용 Provider/queue/storage/DB 상태
- 감사 로그 조회
- 데이터 보존·삭제 작업
- OAuth 암호화 키 rotation 절차
- dependency/security scan과 기본 보안 헤더
- DB 백업과 복구 문서

검증:
- 로그에 토큰·쿠키·대본 원문 등 민감정보가 노출되지 않는지 검사
- 비용 합계와 hard limit 경쟁 조건
- 알림 중복 방지
- 장애 상황 runbook 연습

성공 시 `feat: 운영 비용 알림 관측성과 보안 강화`로 커밋한다.
```

# 19단계. 전체 회귀 테스트·배포 준비·v1 완료 판정

```text
Postbot v1 전체를 구현 완료 상태로 만들기 위한 최종 검증과 배포 준비를 수행하라. 새로운 기능을 무분별하게 추가하지 말고 명세 대비 누락, 오류, 보안, 운영 문제를 해결하라.

1. 기능 명세의 모든 MVP 요구사항을 코드·테스트와 추적 가능한 매트릭스로 연결한다.
2. 기술 확정서의 스택과 실제 구현 차이를 점검하고 정당한 차이는 ADR로 기록한다.
3. 다음 전체 E2E를 Fake Provider로 실행한다.
   - 사용자 가입·로그인
   - 과학 채널 생성
   - 플랫폼 계정 연결
   - 소재 수집
   - 대본·Scene 생성
   - 자산·TTS 준비
   - Remotion 렌더
   - 정책 검사
   - 승인 또는 자동 처리
   - 예약·세 플랫폼 게시
   - 성과 동기화
   - 개선안 승인과 전략 반영·되돌리기
4. MySQL migration을 빈 DB와 기존 fixture DB에 검증한다.
5. worker 재시작, Redis 장애, Provider 장애, 업로드 timeout, 토큰 만료, 예산 초과를 시뮬레이션한다.
6. lint, typecheck, unit, integration, contract, Playwright, renderer smoke test를 실행한다.
7. Docker 기반 production build와 시작·종료·healthcheck를 검증한다.
8. GitHub Actions CI/CD, `.env.production.example`, 배포·백업·복구·rollback runbook을 완성한다.
9. README에 현재 지원 범위, 외부 앱 심사 필요 사항, 실제 키 설정법, 알려진 제한을 작성한다.
10. docs/v1-acceptance-report.md에 통과/실패/미검증 항목과 증거를 기록한다.

완료 판정:
- 미완성 stub, TODO, 가짜 성공 응답을 검색해 제거하거나 명확한 비범위로 기록한다.
- 실제 외부 계정이나 API 키가 없어 검증하지 못한 항목은 Fake 테스트 성공과 실제 검증 대기 상태를 구분한다.
- 치명적·높음 수준 문제가 남아 있으면 커밋은 가능하지만 v1 완료라고 선언하지 않는다.
- 모든 로컬 검증이 성공하면 `release: Postbot v1 구현 및 배포 준비 완료`로 커밋한다.

최종 보고에는 다음을 포함한다.
- 구현 완료 범위
- 실제 외부 검증이 필요한 항목
- 실행한 테스트와 결과
- 배포 절차
- 남은 위험과 우선순위
```

---

## 실제 개발 시 권장 첫 목표

전체 프롬프트는 v1 전체를 다루지만, 최초로 실제 API까지 관통시키는 목표는 다음으로 제한한다.

> 과학 채널 1개 + YouTube Shorts + 승인형 운영

이 경로가 실제로 동작한 뒤 Instagram, TikTok, 완전 자동화, 성과 최적화를 순서대로 활성화한다. 데이터 구조와 Provider 인터페이스는 처음부터 세 플랫폼을 수용하되, 외부 API 심사와 권한이 완료되지 않은 기능을 가짜로 완료 처리하지 않는다.
