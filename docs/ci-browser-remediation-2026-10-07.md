# 2026-10-07 후속 브라우저 CI 보완

대상: `ffc0224`의 [ci 실행](https://github.com/jjaeno/postbot/actions/runs/37612332108). 기존 security 5개 작업과 validate 전체(lint/typecheck/unit/DB/build/audit)는 원격 PASS했고, 그 뒤 실행된 browser-e2e에서 아래 결함 3개가 드러났다.

## 원인과 변경

- production runtime 테스트 2개: browser-e2e는 별도 checkout/runner라 validate가 생성한 `dist`를 받지 않는다. 기존 `pree2e`는 contracts만 build하므로 production 서버가 없는 index.html에 404를 반환했다. `pree2e`를 `pnpm --filter @postbot/web... build`로 바꿔 contracts와 웹 artifact를 준비한다. 서버의 404/캐시/요청 처리 로직은 변경하지 않는다.
- 모바일 설정 테스트: Linux Chromium에서 390px 문서가 405px로 늘어났다. 자산 업로드 section의 암묵적 grid 열은 file input의 intrinsic 최소 너비(347px)를 따르지만, 이 section에 가용한 폭은 더 좁다. `grid-cols-1`의 `minmax(0, 1fr)`로 열을 축소 가능하게 했다. overflow를 숨기거나 업로드 기능을 없애지 않는다.
- 기존 mobile 회귀 assertion은 실패할 때 넘친 요소의 tag/class/좌표/폭을 제공한다. 테스트 fixture의 입력값·개인정보는 진단 출력에 포함하지 않는다.

## 검증

Linux 검증은 기존 renderer image의 Chromium과 Playwright 1.62.1을 사용한 임시 browser server로 실행했다. 저장소의 Vite/서버 host 정책은 변경하지 않고 진단 전용 설정으로 Docker host에 접근했다. 세부 증거는 git 제외 경로 `.artifacts/ci-fix/`에 보관한다.

- Linux Chromium 수정 전: 기존 mobile test FAIL, scrollWidth 405px. 자산 업로드 grid 자식의 오른쪽 좌표 405px.
- 같은 Linux browser 수정 후: mobile test PASS, scrollWidth 390px, 플랫폼별 설정 저장 요청 PASS.
- 최종 web lint/typecheck: PASS. server unit 8개, session-fetch unit 2개: PASS.
- 최종 web build 및 E2E의 자동 build 준비: PASS. 기존 512kB chunk 경고는 유지한다.
- 전체 기본 Playwright: 19/19 PASS. production runtime 테스트 2개 포함.
- 추가 Linux channel-wizard 회귀: 14개 PASS, Docker 전용 HTTP origin에서 secure context가 없어 `crypto.randomUUID` 관련 3개 실패. 진단용 Chromium DNS 설정으로 localhost를 Docker host에 연결해 CI의 secure context 조건을 맞춘 뒤 실패한 동일 3개 PASS. 합계 17개 PASS이며 최초 전체 명령의 성공으로 표기하지 않는다. 제품 코드에 crypto stub 또는 host 정책 완화를 추가하지 않는다.
- 변경 web production image build: PASS, `postbot-ci-browser-web:final`. Trivy 0.70.0 HIGH/CRITICAL scan: 0건, `trivy-browser-web.json`.

이번 단계는 web/E2E 준비만 변경한다. 동일 코드에서 이미 성공한 backend DB·렌더러·보안 vendor patch 검증은 반복하지 않는다. Rspack vendor patch의 관리 필요와 실제 외부 Provider/운영 배포 검증 제한은 19.6 보고서를 따른다. 문서는 커밋 전 로컬 결과이며 커밋·push 후 원격 CI 결과를 별도로 확인한다.
