# Postbot 아키텍처 결정 기록

기준 문서:

- `docs/Postbot_기능_UX_명세서_v0.2.docx`
- `docs/Postbot_v1_기술_스택_확정서.docx`

본 문서는 v1 구현 전 확정된 기술 결정, 명세와의 관계, 미결정 사항, 외부 API 제약을 기록한다.

## 1. 확정 기술 결정

### ADR-001. TypeScript end-to-end

- 결정: 웹, API, 워커, 렌더러, 공통 패키지를 TypeScript strict로 작성한다.
- 근거: DTO, Zod schema, SceneDocument, Provider 계약을 한 언어로 공유해 계약 불일치를 줄인다.
- 제약: `any`, `ts-ignore`, 임시 하드코딩을 피하고 타입 누락은 계약으로 보완한다.

### ADR-002. 모듈형 모놀리스와 분리된 워커 프로세스

- 결정: v1은 마이크로서비스가 아니라 모듈형 모놀리스로 시작한다. API, worker, renderer는 같은 저장소에 두되 프로세스는 분리한다.
- 근거: 초기 운영 복잡도를 낮추면서 수집·생성·렌더·게시 장시간 작업이 HTTP 요청을 막지 않게 한다.
- 제약: 앱 간 직접 참조 금지, 공통 계약은 `packages`를 통해서만 공유한다.

### ADR-003. React/Vite 관리 콘솔

- 결정: `apps/web`은 React + Vite, Tailwind CSS, shadcn/ui, TanStack Query, Zustand, React Hook Form, Zod를 사용한다.
- 근거: 채널 설정, 검수, 캘린더, 분석 UX를 빠르게 구현하고 API 계약 검증을 공유한다.
- 제약: 서버 상태는 TanStack Query, 편집 세션 등 로컬 UI 상태만 Zustand에 둔다.

### ADR-004. NestJS REST API

- 결정: `apps/api`는 Node.js + NestJS, REST + OpenAPI를 사용한다.
- 근거: 명시적 API 계약과 SDK 생성 기반을 제공하며 관리 콘솔 요구에는 GraphQL이 필요하지 않다.
- 제약: 수집·생성·렌더·게시 작업은 BullMQ에 등록하고 작업 ID를 반환한다.

### ADR-005. MySQL 8과 Prisma

- 결정: 영속 데이터 기준은 MySQL 8 / InnoDB / utf8mb4이며 Prisma schema와 migration으로 관리한다.
- 근거: 사용자, 채널, 콘텐츠, 작업, 게시, 비용은 정규화된 관계형 모델에 적합하다.
- 제약: 금액·단가·사용량은 `DECIMAL`, 시간은 UTC, 무결성은 FK/UNIQUE/CHECK와 애플리케이션 검증을 함께 사용한다.

### ADR-006. BullMQ와 Redis

- 결정: collect, script, asset, tts, render, publish 큐를 BullMQ + Redis로 운영한다.
- 근거: 장시간 작업, 재시도, 진행 상태, 취소를 HTTP 요청과 분리한다.
- 제약: 중요 상태는 MySQL에 영속화하고 진행률은 Redis와 SSE로 노출한다.

### ADR-007. Remotion과 FFmpeg 렌더링

- 결정: 생성형 영상 API 대신 Remotion + React/SVG/HTML로 장면을 조립하고 FFmpeg로 후처리한다.
- 근거: 비용, 통제, 일관성, 재현성을 확보하기 위함이다.
- 제약: SceneDocument는 버전이 있어야 하며 과거 영상은 당시 스키마로 재현 가능해야 한다.

### ADR-008. Provider와 Publisher 격리

- 결정: LLM, 이미지, TTS, Asset, Renderer, Storage, Publisher는 인터페이스 뒤에 둔다.
- 근거: 외부 모델명, 가격, 정책, API 제한은 바뀔 수 있으므로 도메인 코드와 분리한다.
- 제약: 모든 외부 호출 구현에는 Fake/Mock 테스트 더블을 제공하고 토큰·개인정보를 로그에 남기지 않는다.

### ADR-009. 정책 엔진 독립화

- 결정: 플랫폼 정책은 프롬프트나 생성 코드에 고정하지 않고 `packages/policy-engine`에서 규칙 버전으로 관리한다.
- 근거: 플랫폼 정책 변경 시 생성·렌더 코드 전체 수정 없이 규칙 갱신과 예약물 재검사를 수행하기 위함이다.
- 제약: 정책 검사는 수익화 보장이 아니라 현재 규칙 기준의 위험 탐지와 승인·차단 근거다.

### ADR-010. 멱등성과 감사 가능성

- 결정: 생성, 렌더, 게시 요청에는 idempotency key와 UNIQUE 제약을 적용한다.
- 근거: 재시도 시 중복 결과와 중복 업로드를 방지해야 한다.
- 제약: 게시 당시의 출처, 자산 라이선스, 정책 검사 결과, 정책 버전, 사용자 승인·우회 이력을 스냅샷으로 보존한다.

## 2. 패키지 경계와 의존 방향

### 앱

- `apps/web`: 관리 콘솔, 채널 설정, 검수, 일정, 결과·비용 확인
- `apps/api`: 인증, 도메인 API, 작업 생성, 정책 게이트, 상태 조회
- `apps/worker`: 소재 수집, 조사, 대본, 자산, TTS, 분석 동기화
- `apps/renderer`: Remotion 렌더링과 FFmpeg 후처리

### 패키지

- `packages/database`: Prisma schema, migrations, client
- `packages/contracts`: DTO, Zod schema, OpenAPI types
- `packages/scene-schema`: SceneDocument JSON 계약
- `packages/providers`: LLM, Image, TTS, Asset, Storage, Renderer 인터페이스와 구현
- `packages/publishers`: YouTube, Instagram, TikTok Publisher 인터페이스와 구현
- `packages/policy-engine`: 정책 규칙과 검사 결과
- `packages/asset-library`: 자산 검색과 라이선스 메타데이터
- `packages/config`: 환경 설정과 검증
- `packages/logger`: 공통 구조화 로그

### 의존 규칙

- 앱은 패키지를 참조할 수 있다.
- 앱은 다른 앱의 내부 구현을 참조할 수 없다.
- `contracts`는 DB 구현에 의존하지 않는다.
- `database`는 앱 레이어에 의존하지 않는다.
- `providers`와 `publishers`는 도메인 계약과 표준 결과 객체를 통해서만 외부 시스템을 노출한다.
- `policy-engine`은 독립 규칙 엔진이며 프롬프트, 렌더러, Publisher 구현에 종속되지 않는다.

## 3. 명세와 기술 결정 사이의 모순·주의점

- 기능 명세 v0.2의 "아직 결정하지 않은 세부 항목"에는 구체적인 기술 스택이 미결정으로 남아 있지만, 기술 스택 확정서 v1.0은 React/Vite, NestJS, MySQL 8, BullMQ, Remotion/FFmpeg 등을 확정한다. 구현 기준은 기술 스택 확정서 v1.0을 우선한다.
- 기능 명세 v0.2는 콘텐츠 생성 공급자와 스톡 공급자를 미결정으로 적었지만, 기술 스택 확정서는 GPT-5 mini, Gemini 3.1 Flash Lite Image, ElevenLabs Flash v2.5를 v1 기본 Provider로 확정한다. 단, 코드에는 모델명을 고정하지 않고 설정과 Provider 구현으로 격리한다.
- 기능 명세는 영상 길이를 약 30~90초로 정의하고 TikTok Creator Rewards 목표 시 1분 이상을 고려한다고 한다. 플랫폼 정책은 변경될 수 있으므로 정책 엔진의 duration rule과 checked_at으로 판단한다.
- 기능 명세는 완전 자동형을 포함하지만 최신·민감·고위험 주제는 강제 검수를 요구한다. 자동형 구현은 정책 게이트가 우선하며 사용자의 자동화 설정으로 우회할 수 없다.
- 기능 명세는 성과 최적화를 포함하지만 인과관계 확정 판정은 제외한다. 분석 결과는 패턴 또는 가설로 표시하고 자동 전략 변경은 허용 범위 안에서만 수행한다.
- 기술 스택 확정서는 `workspaces`, `memberships` 테이블 예시를 포함하지만 기능 명세 v1 범위는 팀 기능 제외다. v1에서는 개인 사용자 중심으로 최소 구조만 두고 팀 초대·권한 UI와 정책은 구현하지 않는다.

## 4. 구현 전 결정이 필요한 항목

- 최초 수직 슬라이스 채널: 과학, 뉴스, 트렌드 중 첫 샘플 채널을 결정해야 한다.
- 게시 빈도 기본값: 플랫폼별 기본 일일 게시 수, 추천 시간대, 최소 콘텐츠 재고 기본값을 정해야 한다.
- 정책 갱신 운영: 수동 검토, 정기 확인, 관리자 승인 방식과 checked_at 갱신 책임자를 정해야 한다.
- 스톡 공급자: 무료·유료 공급자 후보, 라이선스 저장 필드, 출처 표시 방식, 비용 처리 방식을 정해야 한다.
- Asset Library 초기 자산: BGM, SFX, 폰트, 그래픽 템플릿, 워터마크 기본값을 정해야 한다.
- OAuth scope: YouTube, Instagram, TikTok별 최소 권한 범위를 실제 API 문서 기준으로 확정해야 한다.
- 토큰 암호화 방식: 애플리케이션 레벨 암호화 키 관리 방식과 로컬 개발용 키 주입 방식을 정해야 한다.
- 사용자 시간대 기본값: v1 개인 사용자 기준 화면 시간대와 예약 시간 입력 기준을 정해야 한다.
- 비용 단가 관리: Provider별 단가 입력, 환율, 세금, 무료 할당량 반영 방식을 정해야 한다.
- 알림 채널: v1 기본 알림을 웹 인앱으로 할지, 이메일까지 포함할지 결정해야 한다.
- 분석 동기화 주기: 플랫폼별 rate limit와 데이터 지연을 고려해 동기화 주기를 정해야 한다.
- 샘플 렌더 기준: 15초 샘플 3종의 주제, 스타일, 자막 안전 영역 기준을 정해야 한다.
- 운영 배포 대상: 초기 운영을 단일 VPS로 할지 소규모 클라우드로 할지 확정해야 한다.

## 5. 외부 API와 플랫폼 제약

- YouTube, Instagram, TikTok 정책과 수익화 조건은 변경될 수 있다. 정책 규칙은 platform, region, effective_at, checked_at을 포함해야 한다.
- 플랫폼 API가 제공하지 않는 성과 지표는 추정하지 않는다. 지표별 수집 가능 여부와 기준 기간을 저장한다.
- 플랫폼 간 조회수, 도달, 완주율 등은 동일한 의미로 단정하지 않는다.
- OAuth 토큰은 만료, 권한 철회, scope 변경, 계정 연결 해제에 대비해야 한다.
- 업로드 API는 rate limit, 파일 크기, 포맷, 처리 지연, 검수 지연이 있을 수 있다.
- 게시 작업은 외부 post ID가 확인되기 전 동일 요청을 반복하면 중복 업로드가 발생할 수 있으므로 Publisher별 멱등 처리와 복구 절차가 필요하다.
- AI Provider 모델명, 가격, 지연 시간, 출력 품질, 안전 정책은 변경될 수 있다.
- TTS Provider는 음성 라이선스, 타이밍 정확도, 재시도 과금, 상업 이용 조건을 기록해야 한다.
- 이미지 생성 Provider는 실제 인물·사건처럼 보이는 합성 콘텐츠 표시 필요성을 정책 엔진과 함께 판단해야 한다.
- 스톡 공급자는 라이선스 변경, 출처 표시 의무, 다운로드 시점 증빙, 계정 귀속 제한을 추적해야 한다.
- S3 호환 스토리지는 서명 URL 만료, 공개 범위, 원본·중간·완성본 보존 정책을 분리해야 한다.

## 6. 변경 관리 원칙

- DB 교체, AI 모델 교체, 플랫폼 정책 변경, 렌더 컴포넌트 계약 변경은 별도 ADR 또는 본 문서 갱신 후 구현한다.
- 채널-계정 관계, 자동화 모드, 콘텐츠 상태 흐름, 플랫폼 정책 처리, 수익화 관련 표현을 바꾸는 경우 기능 명세와 코드 계약을 함께 갱신한다.
- API, 환경 변수, 상태 전이, 운영 방법이 바뀌면 같은 단계에서 docs를 갱신한다.
- 모든 검증이 성공했을 때만 커밋하고, 커밋 메시지는 한국어로 작성한다.
