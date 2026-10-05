# Postbot 아키텍처 결정 기록

이 문서는 Postbot v1의 **확정된 아키텍처 결정과 아직 해결되지 않은 기술 결정**을 기록한다.

단계별 구현 범위와 완료 조건은 `docs/implementation-plan.md`를 따른다.

상세 제품 및 기술 요구사항이 필요한 경우에만 다음 문서를 참조한다.

* `docs/Postbot_기능_UX_명세서_v0.2.docx`
* `docs/Postbot_v1_기술_스택_확정서.docx`

`docs/Postbot_Codex_전체_개발_프롬프트.md`는 전체 로드맵 참고용이며 아키텍처 결정의 기준 문서가 아니다.

---

# 1. 확정된 ADR

## ADR-001 — TypeScript end-to-end

**결정**

웹, API, worker, renderer, 공통 package를 TypeScript strict로 구현한다.

**제약**

* `any`, `ts-ignore`, 임시 하드코딩을 피한다.
* 공유 데이터 계약은 타입과 schema로 명시한다.

---

## ADR-002 — 모듈형 모놀리스 + 분리된 worker

**결정**

v1은 마이크로서비스가 아닌 모듈형 모놀리스로 구성한다.

프로세스 경계:

* `apps/web`
* `apps/api`
* `apps/worker`
* `apps/renderer`

**제약**

앱끼리 내부 소스를 직접 참조하지 않고 공통 package를 사용한다.

---

## ADR-003 — React/Vite 관리 콘솔

**결정**

`apps/web`:

* React
* Vite
* Tailwind CSS
* shadcn/ui
* TanStack Query
* Zustand
* React Hook Form
* Zod

**상태 원칙**

* 서버 상태: TanStack Query
* 편집 세션 등 로컬 UI 상태: Zustand

---

## ADR-004 — NestJS REST API

**결정**

`apps/api`는 Node.js + NestJS + REST + OpenAPI를 사용한다.

출시 runtime 및 CI는 지원 중인 Node.js 24 LTS를 사용한다(19.3 보안 보완). Node 20은 2026-04-30에 지원 종료됐다. 공식 Node 24 trixie slim에서 빌드하고 동일 공식 이미지의 Node 실행 파일을 Ubuntu 26.04 LTS runtime에 복사한다. Debian 13 미디어 의존성의 미패치 libxml2 CRITICAL 항목을 회피하고, FFmpeg/Chromium/CJK 의존성은 worker/renderer에만 설치한다. NestJS·Prisma·Remotion의 기존 API 및 migration 계약은 유지하며 이미지 변경 후 실제 렌더/DB/HTTP 회귀로 호환성을 검증한다.

근거: [Node 릴리스 정책](https://github.com/nodejs/Release#release-schedule), [Prisma 6 지원 환경](https://www.prisma.io/docs/orm/v6/reference/system-requirements), [Ubuntu 26.04 LTS 지원 기간](https://documentation.ubuntu.com/release-notes/26.04/).

**제약**

장시간 작업은 API 요청 안에서 처리하지 않고 BullMQ 작업을 생성한 뒤 job ID를 반환한다.

---

## ADR-005 — MySQL 8 + Prisma

**결정**

영속 데이터:

* MySQL 8
* InnoDB
* utf8mb4
* Prisma schema/migration

**데이터 원칙**

* 금액·단가·사용량: DECIMAL
* 시간: UTC
* 무결성: FK / UNIQUE / 필요한 CHECK + application validation
* JSON: SceneDocument, Provider raw response 등 구조 변화가 필요한 데이터에 제한 사용

---

## ADR-006 — BullMQ + Redis

**결정**

장시간 작업과 재시도를 BullMQ + Redis로 처리한다.

대표 queue:

* collect
* script
* asset
* tts
* render
* policy
* publish
* analytics

**제약**

업무적으로 중요한 상태는 MySQL에 영속화하고 Redis는 queue와 일시적 진행 상태에 사용한다.

---

## ADR-007 — Remotion + FFmpeg

**결정**

생성형 비디오 API 대신 Remotion으로 SceneDocument를 영상으로 구성하고 FFmpeg로 후처리한다.

**제약**

* SceneDocument는 버전을 가진다.
* renderer version을 결과물과 함께 기록한다.
* 동일 입력에 대한 재실행은 멱등성을 가져야 한다.

---

## ADR-008 — 외부 Provider 격리

**결정**

다음 외부 기능은 interface 뒤에 격리한다.

* LLM
* Image
* TTS
* Asset source
* Storage
* Publisher
* Analytics

**제약**

* Fake/Mock 구현을 제공한다.
* 외부 모델명이나 가격을 도메인 코드에 하드코딩하지 않는다.
* API 키와 토큰을 로그에 기록하지 않는다.

---

## ADR-009 — 정책 엔진 독립화

**결정**

플랫폼 정책은 `packages/policy-engine`의 versioned rule로 관리한다.

**정책 데이터**

필요한 경우 다음 정보를 포함한다.

* platform
* region
* effective_at
* checked_at
* rule version

**제약**

정책 검사는 수익화 또는 플랫폼 승인을 보장하지 않는다.

---

## ADR-010 — 멱등성과 게시 시점 스냅샷

**결정**

생성·렌더·게시 작업은 idempotency key와 필요한 UNIQUE 제약을 사용한다.

게시 당시 다음 정보를 보존한다.

* 출처
* asset license
* policy result
* policy version
* 사용자 승인 또는 override 이력

외부 post ID 확인 여부가 불명확한 업로드는 플랫폼 상태 확인 없이 무조건 재시도하지 않는다.

---

## ADR-011 — 인증 및 플랫폼 자격 증명

**결정**

사용자 인증은 JWT + HttpOnly Cookie를 사용한다.

플랫폼 연결은 OAuth 2.0을 사용한다.

OAuth access/refresh token은 애플리케이션 레벨에서 암호화해 저장한다.

**제약**

암호화 키 버전을 기록하고 향후 key rotation이 가능한 구조를 유지한다.

---

## ADR-012 — SNS 계정과 Channel 귀속

**결정**

하나의 SNS 플랫폼 계정은 동시에 최대 하나의 Postbot Channel에만 연결할 수 있다.

한 Channel에는 플랫폼별 최대 한 계정을 연결한다.

DB UNIQUE 제약과 application validation을 함께 적용한다.

---

## ADR-013 — 자동화 비용은 서버에서 산정하고 미확정 단가는 차단

**결정**

자동화 실행 요청은 단계별 예상 비용을 받지 않는다. API가 선택된 Provider, 설정 단가, 예상 또는 실제 작업량을 사용해 각 단계의 예약 금액을 계산한다.

Fake Provider는 회귀 테스트를 위한 결정적 비영(非零) 단가를 사용한다. 실제 LLM/Image/TTS/Renderer Provider를 선택했는데 해당 단가가 설정되지 않았으면 비용을 0으로 간주하지 않고 `COST_PRICING_REQUIRED`로 작업을 보류한다.

Provider 응답에 실제 청구 금액이 있을 때만 actual ledger로 확정하고, 그렇지 않으면 estimated ledger와 외부 청구 대사 상태를 구분한다.

**이유**

클라이언트가 제공한 금액은 조작 가능하고 scheduler 요청에는 존재하지 않아 hard limit을 우회하거나 정상 자동화를 영구 보류시킬 수 있다. 서버 단일 계산 경로가 수동·예약 자동화와 모든 UI의 동일한 예산 정책을 보장한다.

**제약**

단가는 환경 설정 또는 향후 versioned pricing table에서 관리하며 코드에 실제 Provider 가격을 상수로 고정하지 않는다. 금액 저장과 합산은 DECIMAL을 유지한다.

---

# 2. 패키지 경계

## Applications

`apps/web`

관리 콘솔과 사용자 인터페이스.

`apps/api`

인증, 도메인 API, job 생성, 정책 gate, 상태 조회.

`apps/worker`

수집, 조사, 대본, 자산, TTS, 분석 동기화.

`apps/renderer`

Remotion 렌더링과 FFmpeg 후처리.

## Packages

* `packages/database`: Prisma schema, migration, client
* `packages/contracts`: DTO, Zod schema, 공유 API 계약
* `packages/scene-schema`: SceneDocument 계약
* `packages/providers`: 외부 생성·자산·스토리지 Provider
* `packages/publishers`: SNS Publisher
* `packages/policy-engine`: 정책 규칙과 검사
* `packages/asset-library`: 자산과 라이선스 메타데이터
* `packages/config`: 환경 설정과 검증
* `packages/logger`: 구조화 로그

## Dependency rules

* application → package 허용
* application → application 직접 참조 금지
* `contracts` → database 의존 금지
* `database` → application 의존 금지
* 외부 시스템의 SDK 타입을 도메인 계약으로 직접 노출하지 않는다.

---

# 3. 제품과 기술 결정 사이의 해석

## 기술 스택 우선순위

기능 명세에서 기술 스택이 미결정으로 남아 있고 기술 스택 확정서에서 결정된 경우 기술 스택 확정서를 따른다.

## Provider

v1 기본 Provider가 기술 확정서에서 지정되어 있더라도 모델명은 설정으로 주입하고 Provider interface 뒤에 둔다.

## 영상 길이

기능 명세의 약 30~90초는 제품 방향이다.

실제 플랫폼별 허용 길이 또는 수익화 관련 조건은 versioned policy rule을 기준으로 판단한다.

## 완전 자동 운영

완전 자동형에서도 정책·사실·권리 gate를 우회하지 않는다.

고위험 또는 확인 불가 콘텐츠는 자동 게시하지 않는다.

## 성과 최적화

관찰된 상관관계를 인과관계로 단정하지 않는다.

표본이 부족한 경우 결과를 확정 패턴이 아니라 가설로 취급한다.

## Workspace

v1 제품은 개인 사용자를 대상으로 한다.

Workspace와 Membership은 향후 확장을 위한 최소 데이터 경계만 제공하며 팀 초대·역할 관리 UX는 v1에서 구현하지 않는다.

---

# 4. 미결정 사항

미결정 사항은 구현 단계에서 실제 결정이 필요한 시점에 해결하고, 확정되면 새로운 ADR로 이동한다.

* 플랫폼별 기본 게시 빈도와 추천 시간대
* 최소 콘텐츠 재고 기본값
* policy checked_at 갱신 책임과 주기
* stock asset 공급자
* 초기 BGM/SFX/font/graphic asset 구성
* YouTube/Instagram/TikTok 최소 OAuth scope
* production OAuth encryption key 관리 방식
* 사용자 기본 timezone
* Provider 비용 단가·환율·세금 관리 방식
* 기본 알림 채널
* analytics sync 주기
* production 배포 대상

이미 완료된 단계 이전에 결정했어야 하는 항목은 실제 구현 상태를 확인하고 ADR 또는 구현 문서에 반영한다.

---

# 5. 변경 가능한 외부 조건

다음 정보는 코드에 고정된 사실로 취급하지 않는다.

* SNS 플랫폼 정책
* OAuth scope 및 API 기능
* API rate limit
* 업로드 파일 제한
* 플랫폼 metric 제공 범위
* AI Provider 모델명
* AI Provider 가격
* AI Provider 라이선스·안전 정책
* TTS voice 사용 조건
* stock asset license
* 수익화 프로그램 조건

관련 기능을 구현하거나 갱신할 때 공식 문서를 확인하고 필요한 경우 다음을 기록한다.

* 확인일
* 적용 대상
* 정책/버전
* 다음 검토 책임 또는 갱신 기준

플랫폼 API가 제공하지 않는 지표는 추정하여 플랫폼 원본 지표처럼 저장하지 않는다.

---

# 6. ADR 변경 규칙

다음 변경은 기존 ADR 수정 또는 새로운 ADR 작성을 요구한다.

* DB 기술 또는 데이터 저장 원칙 변경
* 인증 방식 변경
* AI Provider 전략 변경
* queue/worker 구조 변경
* renderer 계약 변경
* SceneDocument 호환성 변경
* Channel과 SNS account 관계 변경
* 자동화 safety gate 변경
* 플랫폼 정책 처리 방식 변경

API, 환경 변수, 상태 전이 또는 운영 방법만 변경되고 아키텍처 결정 자체가 바뀌지 않는 경우 해당 운영 문서만 갱신한다.
