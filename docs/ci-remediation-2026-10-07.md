# 2026-10-07 CI 실패 보완

대상: `5592fde1bb677ffc787f479978981fb8f551c076`의 [security 실행](https://github.com/jjaeno/postbot/actions/runs/37607531346)과 [ci 실행](https://github.com/jjaeno/postbot/actions/runs/37607531310).

## 원인과 변경

- `pnpm audit --prod --audit-level=high`와 image scan: `proxy-addr` 2.0.7의 Critical, `source-map-js` 1.2.1의 High 취약점. 각각 2.0.8과 1.2.2로 고정했다. 근거: [proxy-addr 권고](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [source-map-js 권고](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- worker/renderer image scan: Rspack 1.7.11 내부에 번들된 `tinypool` 1.1.1의 Critical 취약점 2건. 단순 tinypool override는 번들 내부 파일을 바꾸지 못한다. Rspack 1.7.11을 유지하고 번들 내부 tinypool을 공식 npm 2.1.2 배포 파일로 교체하는 pnpm patch를 추가했다. Dockerfile은 fetch 전에 patches를 복사한다. 근거: [tinypool run 옵션 권고](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr). 버전 표기만 바꾸거나 scanner 예외를 추가한 것이 아니라 실제 배포 JS를 교체한다.
- DB integration: `automation-sample.integration.spec.ts`와 `automation-start.integration.spec.ts`가 GLOBAL YouTube 정책이 없는 빈 DB에서 `POLICY_RULE_NOT_FOUND`로 실패했다. 두 suite가 정책 fixture를 직접 구성하도록 수정했다. 동시 suite 생성은 `createMany(skipDuplicates)`로 충돌을 막는다. 잘못된 길이 테스트는 정확히 `OUTPUT_DURATION_POLICY_CONFLICT`를 확인한다.

정책 gate, 보안 차단 기준, production DB schema와 앱 기능은 유지한다. 기존 보고서의 보안 PASS는 당시 검증 시점과 SHA의 결과이며 신규 공개 취약점에 대한 현재 결과가 아니다.

## 검증

전용 MySQL 8.4 컨테이너의 `postbot_ci_fix_test`를 사용하며 운영/기존 acceptance 데이터에는 접근하지 않는다. 세부 로컬 증거는 git 제외 경로 `.artifacts/ci-fix/`에 저장한다.

- `pnpm install --frozen-lockfile`: PASS.
- `pnpm audit --prod --audit-level=high`: PASS, 알려진 취약점 0건.
- 빈 테스트 DB의 12개 migration: PASS.
- api/worker/renderer lint·typecheck: PASS. 최종 Rspack patch 적용 후 renderer typecheck·unit 3개도 PASS.
- API DB 회귀: 95개 PASS, storage 환경 누락 1개 실패. CI와 동일하게 `STORAGE_PROVIDER=fake`를 지정한 해당 파일 재검증 1개 PASS. 합계 96개 PASS, 기존 환경 gate 3개 skip. 원격 실패의 두 automation suite는 모두 PASS.
- worker DB/unit 회귀: 21개 PASS, Redis 주소 누락으로 2개 timeout. 전용 Redis 주소를 지정한 해당 SCRIPT 파일 재검증 2개 PASS. 합계 23개 PASS.
- 전체 DB 회귀 명령에서 database 8개, optimization·provider·publisher·asset·policy·renderer·web의 실행된 테스트는 PASS. API/worker의 위 환경 수정 재검증을 합산한 결과이며 최초 전체 명령이 성공했다고 표기하지 않는다.
- Gitleaks 8.24.3 history scan: 44 commit, 노출 0건. Trivy 0.70.0 tracked source vulnerability/secret scan: HIGH/CRITICAL 0건.
- 최종 Rspack 1.7.11 + tinypool 2.1.2 bundle: PASS, 기본 캐시를 포함한 실제 Remotion Rspack bundle 성공.
- 최종 production image build: api/worker/renderer/web 모두 PASS. 최종 태그 `postbot-ci-fix-{app}:final`.
- 최종 production image scan: Trivy 0.70.0, 미패치 취약점을 포함한 HIGH/CRITICAL 각각 0건. 증거 `trivy-{app}-final.json`. 로컬 동시 scan의 공유 cache lock은 순차 재검증으로 해소했다.
- 최종 image의 실제 Rspack bundle/Chromium still: PASS. 1080×1920, 장면 이미지 픽셀 RGB `[199,5,205]`. Docker 배포 결과의 tinypool 2.1.2 포함을 별도 확인했다.
- 최종 image의 기본 webpack/Remotion/FFmpeg 3초 영상 smoke: PASS. ffprobe 1080×1920/3초/음성 있음, meanVolumeDb -21, blackFrameRatio 0, 장면 이미지 픽셀 RGB `[199,4,204]`.

최초 앱 병렬 unit 실행의 API HTTP test 3개는 hook/test timeout으로 실패했다. maxWorkers=2를 적용한 위 API DB 회귀에서는 모두 PASS했다. 로컬 Node는 20.19.4이고 production image/CI는 Node 24를 사용한다. 이 문서는 커밋 전 로컬 검증 기록이다. 커밋·push 뒤 GitHub의 실제 원격 CI 결과를 확인하고 완료 보고에 별도 명시한다.

## 범위와 위험

vendor patch는 upstream Rspack이 번들 내부 tinypool을 갱신하기 전까지 필요하다. Rspack/Remotion을 변경할 때 patch 적용과 bundle/render 및 scanner 결과를 다시 확인하고 upstream에서 해결되면 제거한다. 실제 외부 Provider, SNS 게시, 운영 배포는 이번 수정 범위에 포함하지 않는다.
