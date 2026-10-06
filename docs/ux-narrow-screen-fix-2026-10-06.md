# 320px 비용 필터 보완 — 19.5

기준일: 2026-10-06. 시작 commit `25d86c3`. 최종 추가 UX 점검에서 발견된 320px 문서 폭 344px 결함을 한정 보완한다.

최종 판정: **PASS — 이번 가로 넘침 결함 수정 및 필수 검증 완료**. 최초 명세 전체 또는 실 서비스 출시까지 완료했다는 판정은 아니다.

## 원인과 수정

실제 합성 콘텐츠 `Reusable rocket test reaches new altitude`를 선택했을 때 비용 콘텐츠 select의 기본 폭이 303px, 부모 label이 311px였다. 비용 필터의 가용 폭은 280px인데 flex item의 자동 최소 폭과 왼쪽 margin이 이를 넘어섰다. 간소화된 기존 Mock 제목은 짧아서 이 조건을 재현하지 못했다.

비용 필터 그룹의 label만 `min-width: 0`, 축소 가능한 flex basis, 최대 폭 제한을 적용한다. select/input은 라벨 아래 전폭으로 배치하고 왼쪽 margin을 없앴다. 페이지 전체의 overflow를 숨기거나 제목을 잘라 저장하지 않는다. 채널/콘텐츠/Provider/기간 값과 API 쿼리 계약은 그대로다.

## 검증

새 Playwright 회귀는 수정 전 320px에서 문서 폭 344px로 실패했다. 실제 UI의 동일 합성 데이터·확장된 분석/최적화/대본 상태에서도 같은 label/select를 DOM 측정으로 특정했다. 테스트 쿠키는 공개된 테스트 전용 비밀값으로 합성 계정에만 메모리에서 부여했으며 실제 로그인/refresh를 다시 검증한 것으로 세지 않는다. 실제 키·토큰·서명 URL은 기록하지 않는다.

최종 검증 결과:

* web lint/typecheck/build PASS, 서버 8개·세션 2개 테스트 PASS.
* 새 긴 제목 회귀: 수정 전 320→344px FAIL, 수정 후 320/360/390/768/1440px 문서 폭·전체 옵션 텍스트·채널/콘텐츠/제공자/기간 선택값과 비용 쿼리 PASS.
* 최종 built 웹 desktop Playwright 19/19 PASS, 390px 전체 Playwright 19/19 PASS.
* 실제 합성 데이터의 확장 화면: 320/360/390/768/1440px에서 문서 폭이 각각 viewport와 같고 넘치는 DOM 요소 0. 기존 콘텐츠 선택 보존 PASS.
* 실제 영상 재생 1080×1920/30초, media error null, page error 0. 로그아웃 후 새로고침의 인증 화면 유지 PASS.
* 최종 whitespace/변경 코드의 금지 TypeScript 패턴 점검 PASS. 기존 500kB chunk 경고(512.43kB, gzip 151.25kB)는 남아 있으며 이번 레이아웃 수정의 해소 대상으로 세지 않는다.

증거는 `.artifacts/ux-fix/layout-results.json`(수정 전), `layout-results-fixed.json`, `320-fixed.png` 및 Playwright 결과에 보관한다. 이번 테스트 API·웹 서버는 검증 후 중지하며 기존 데이터/미디어는 삭제하지 않는다. 최종 commit은 `git log -1 --format=%H`로 확인한다. push/운영 배포는 수행하지 않는다.

API/worker/renderer/DB 변경이 없어 앞선 동일 코드의 전체 HTTP 3/3과 migration 검증은 반복하지 않는다. 미구현 커버/외부 스톡 자동 구매/고급 최적화, 실 Provider/SNS/운영 배포 검증 제한은 그대로다. 이번 수정이 최초 명세 전체 완료나 모든 미래 결함 부재를 의미하지 않는다.
