# 2026-10-18 PR CI 실패 보완

대상: [PR #1](https://github.com/jjaeno/postbot/pull/1)의 `488afdd6f026bc8e52702e0ac0a98303ab042bac`.

## 원인과 변경

- [ci 실행](https://github.com/jjaeno/postbot/actions/runs/38541451253): DB 회귀의 `automation-kill-budget.integration.spec.ts:23`에서 예약 fixture INSERT가 MySQL deadlock(`P2034`)으로 실패했다. 테스트 파일 두 개가 같은 DB에서 병렬 실행되고, 예산 예약 코드는 SERIALIZABLE 트랜잭션으로 예약/원장을 조회한다. 파일별 UUID만으로는 DB 범위 잠금이나 전역 미귀속 비용 fixture를 격리할 수 없다. DB 회귀의 Vitest worker를 2개에서 1개로 줄여 파일 간 실행을 직렬화한다. Turbo package 직렬 실행과 테스트 내부 `Promise.all` 동시 예약 검증은 유지한다. 앱 동작, DB schema, 예산 안전장치와 테스트 assertion은 바꾸지 않는다.
- [security 실행](https://github.com/jjaeno/postbot/actions/runs/38541451267): 의존성 audit와 네 앱 container scan은 성공했지만 Gitleaks가 PR 커밋 목록 API에서 403(`Resource not accessible by integration`, 필요 권한 `pull_requests=read`)으로 중단됐다. 해당 job에 `contents: read`, `pull-requests: read`를 명시한다. PR 댓글은 비활성화해 쓰기 권한 없이 검사를 수행한다. [Gitleaks 공식 환경 변수 설명](https://github.com/gitleaks/gitleaks-action#environment-variables) 확인일: 2026-10-18.

## 검증

- `actionlint` 1.7.7: 변경 workflow 두 개 PASS.
- Gitleaks 8.24.3: 기존 PR commit 범위 history scan PASS, 노출 0건(`--redact`). GitHub Actions 토큰 권한은 push 후 원격 실행에서 별도 확인한다.
- 격리 MySQL 8.4의 `postbot_ci_repair_test`: 빈 DB에 migration 13개 적용 PASS. 전용 Redis를 사용하며 기존 DB/container는 수정하지 않는다.
- Linux/Node 24.21.0 build stage의 frozen lockfile 설치·Prisma generate·전체 build: PASS(기존 Docker cache 재사용).
- 수정한 DB 회귀 명령 `pnpm exec turbo run test --concurrency=1 -- --maxWorkers=1 --testTimeout=20000`: Linux/Node 24에서 27 task PASS, 테스트 210개 PASS·기존 환경 gate 4개 skip. API 99개(원격 실패 kill-budget 포함), worker 33개, Redis lifecycle 6개 모두 PASS. 예산 파일 내 동시 예약 테스트도 PASS. 로컬 증거: git 제외 경로 `.artifacts/ci-repair-20261018/linux-db-regression.log`.
- 최초 Windows/Node 20 실행은 Redis lifecycle 자식 프로세스 2개의 5초 timeout으로 중단됐다. Linux에서 동일 lifecycle 6개와 전체 회귀가 성공한 결과로 대체하며 최초 명령을 성공으로 표기하지 않는다. PowerShell의 pnpm 인수 전달 문제로 시작하지 못한 최초 시도도 증거에 남긴다.
- `git diff --check`: PASS. Prettier 추가 점검은 workflow의 기존 따옴표/배열 스타일에 경고를 반환했다. 기존 파일 전체 재포맷은 제외했고 필수 workflow 정적 검증은 위 actionlint 결과를 사용한다.
- GitHub 토큰의 실제 권한과 원격 후속 job은 push 후 확인 대상이다.

이번 보완은 19.8단계 PR의 CI 실행 설정 수정이다. 전체 단계 검증을 다시 완료했다고 주장하지 않으며, 원격에서 이전에 skip된 build/audit·후속 job은 새 실행 결과로 확인한다. 실제 Provider 호출, SNS 게시와 운영 배포는 범위에 포함하지 않는다.
