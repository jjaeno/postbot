# Postbot 저장소 작업 규칙

이 저장소의 기준 문서는 다음 파일이다.

- `docs/Postbot_기능_UX_명세서_v0.2.docx`
- `docs/Postbot_v1_기술_스택_확정서.docx`
- `docs/implementation-plan.md`
- `docs/architecture-decisions.md`
- `docs/Postbot_Codex_전체_개발_프롬프트.md`

## 공통 실행 규칙

1. 작업 전 저장소 전체 구조, `AGENTS.md`, `README.md` 존재 여부, `docs`의 기능 명세서와 기술 스택 확정서를 읽어라.
2. 현재 단계의 범위를 벗어난 기능을 임의로 구현하지 마라. 다음 단계와 연결할 인터페이스만 정의하라.
3. 기존 사용자 변경과 관련 없는 파일을 되돌리거나 덮어쓰지 마라.
4. 구현 전에 현재 상태와 이번 단계의 세부 작업 계획을 짧게 정리하라.
5. TypeScript strict를 유지하고 `any`, `ts-ignore`, 임시 하드코딩을 피하라.
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

## v1 기술 기준

1. 언어는 TypeScript end-to-end를 사용한다.
2. 프론트엔드는 React + Vite, Tailwind CSS, shadcn/ui, TanStack Query, Zustand, React Hook Form, Zod를 사용한다.
3. 백엔드는 Node.js + NestJS, REST + OpenAPI를 사용한다.
4. DB는 Prisma + MySQL 8 / InnoDB / utf8mb4를 사용한다.
5. 큐와 캐시는 BullMQ + Redis를 사용한다.
6. 파일 저장은 S3 호환 스토리지와 개발용 MinIO를 사용한다.
7. 렌더링은 Remotion, 후처리는 FFmpeg를 사용한다.
8. 인증은 JWT + HttpOnly Cookie를 기준으로 하며 OAuth 2.0으로 플랫폼 계정을 연결한다.
9. 관측성은 Pino JSON 로그와 Sentry를 기준으로 한다.
10. 테스트는 Vitest, Supertest, Playwright를 기준으로 한다.

## 모노레포 경계

1. `apps/web`은 관리 콘솔만 담당한다.
2. `apps/api`는 인증, 도메인 API, 작업 생성, 정책 게이트를 담당한다.
3. `apps/worker`는 수집, 조사, 대본, 자산, TTS, 분석 동기화를 담당한다.
4. `apps/renderer`는 Remotion 렌더링과 FFmpeg 후처리를 담당한다.
5. 공통 코드는 `packages/database`, `packages/contracts`, `packages/scene-schema`, `packages/providers`, `packages/publishers`, `packages/policy-engine`, `packages/asset-library`, `packages/config`, `packages/logger`에 둔다.
6. 앱은 패키지를 참조할 수 있지만 앱끼리 직접 참조하지 않는다.
7. `packages/contracts`는 데이터베이스 구현에 의존하지 않는다.
8. `packages/database`는 앱 레이어에 의존하지 않는다.

## 제품 범위 규칙

1. v1은 개인 사용자 1명과 여러 채널을 대상으로 한다.
2. 지원 플랫폼은 YouTube Shorts, Instagram Reels, TikTok이다.
3. 콘텐츠 형식은 9:16 세로형 숏폼으로 제한한다.
4. SNS 계정 하나는 하나의 채널에만 연결할 수 있다.
5. 승인형과 완전 자동형을 모두 지원하되, 정책·권리·사실 검사가 우선한다.
6. 최신·민감 콘텐츠, 정치·건강·금융·법률 주제, 권리 불명, 정책 실패는 자동 게시하지 않는다.
7. 수익화 가능성을 점검하되 수익화 승인이나 수익 발생을 보장한다고 표현하지 않는다.
8. 생성형 AI Video, 모바일 앱, 롱폼, 팀 권한, 댓글 자동 답변, 결제·구독제, 자유 편집형 영상 편집기는 v1 범위에서 제외한다.

## 데이터·보안·운영 원칙

1. OAuth access/refresh token은 애플리케이션 레벨에서 암호화해 저장한다.
2. 금액, 단가, 사용량 계산에는 FLOAT 대신 DECIMAL을 사용한다.
3. DB 시간은 UTC로 저장하고 화면에서 사용자 시간대로 변환한다.
4. SceneDocument와 정책 규칙은 버전을 가진다.
5. 출처, 자산 라이선스, 정책 검사 결과는 게시 당시 스냅샷으로 보존한다.
6. 플랫폼 API가 제공하지 않는 성과 지표는 임의 추정하지 않는다.
7. 플랫폼 정책, 외부 모델명, 가격, 라이선스 조건은 변경 가능하므로 코드에 고정하지 않는다.
8. 콘텐츠가 부족하거나 검증에 실패하면 임의 콘텐츠를 게시하지 말고 보류한다.
