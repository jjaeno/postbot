# 채널별 제작·운영 개선 기록

기준 커밋: `31d0564a1d44711f830e44de0b6563c39cff6ca2`. 브랜치: `feat/channel-production-operations`. 시작 시 작업 트리는 깨끗했다. 이번 요청은 20단계 전체를 승인하며 push/merge/배포는 금지한다. 현재 상태는 구현 중이며 아래 항목 전체가 완료된 것은 아니다.

## 기준 코드 재검증

| 요청 | 초기 상태 | 코드 근거와 남은 작업 |
|---|---|---|
| 제작·운영 경계 | 신규 기능 | 버전 고정 공통 제작 결과가 없음. 새 조회 계약 구현 중 |
| 채널 수집 프로필·커넥터 | 신규 기능/수정 필요 | 기존 RSS와 원문 scope는 있으나 질문·공식 소스·안전한 HTML·분리 주기는 부족 |
| 기획·의미 정렬 | 수정 필요 | ScriptGenerationProcessor.save가 planning을 버리고 alignSceneNarration이 균등 분배 |
| 가이드·공유 캐시·권리 | 신규 기능/수정 필요 | AssetPreparationProcessor는 장면별 재사용이며 GRAPHIC도 이미지 루프에 진입 |
| 음성·렌더 | 수정 필요 | ElevenLabs normalized_alignment와 원문 비교, RenderProcessor Promise timeout 후 실제 작업 종료 보장 없음 |
| 재고·생산 수명 | 수정 필요 | AutomationService.start의 활성 run이 승인·예약 대기 중 보충을 막음 |
| 예산·재개 | 수정 필요 | 실제 청구 미확정과 사용량 미확정을 구분하는 정산 및 오류 분류 보완 필요 |
| 계정·게시 | 수정 필요 | oauth-token의 refresh DB fencing 없음. PublishProcessor 업로드 반환을 공개 완료로 처리 |
| 성과 | 이미 해결/수정 필요 | 지연/부분/영구 미제공·게시 버전은 구현됨. 상대 달력 관측·정기 분석·YouTube 정책 경계 보완 필요 |
| 보존·감시·백업 | 수정 필요/신규 기능 | DataLifecycleProcessor가 오래된 장면의 현재 참조를 보장하지 않고 파일부터 삭제. durable 키 및 예약 근거 보존 필요 |
| 실 Provider·SNS·외부 알림·운영 배포 | 외부 환경 필요 | 이번 범위에서는 실행하지 않음. Fake/Mock 검증과 구분 |

기존 UX 명세의 공통 기획/플랫폼별 출력/승인 재고/비용·알림 방향과 일치한다. 업로드 성공을 게시 완료로 취급하는 기존 구현은 이번 요청의 실제 공개 확인과 충돌하므로 20.8에서 변경한다. 새 명세가 요구하는 세분화가 기존 coarse 상태보다 우선한다.

## 20.1 제작 결과 경계

공통 계약 `production-result-v1`은 원문·근거·대본·장면·자산·영상·QA·청구 요약·검토 사유를 제공한다. 승인·예약·게시 성공은 영상 생성 상태로부터 추론하지 않는다.

- `GET /content/:contentItemId/production?sceneVersionId=...`: 현재 플랫폼별 최신 장면 또는 지정 장면과 해당 장면이 참조하는 대본을 조회한다. workspace 격리를 적용한다.
- `GET /automation/runs/:runId/production`: 해당 run의 생성 작업이 반환한 버전으로 제작 결과를 조회한다. 기존 run polling 응답/큐 payload/UI 계약은 유지한다.
- 비용은 content 전체 사용 이력이며 플랫폼별 배분을 의미하지 않는다. raw provider 응답/journal은 노출하지 않는다.
- 기존 데이터에 저장되지 않은 planning·원문·근거는 null/UNKNOWN으로 보고하며 복원한 것처럼 표시하지 않는다. 원문 fingerprint는 저장된 텍스트의 SHA-256이며 외부 진실성의 인증이 아니다.

검증: contracts build/lint/typecheck 및 기존 unit 2개 통과. API lint/typecheck 통과. 격리 MySQL `postbot_channel_ops_test`에 기존 migration 19개를 빈 DB부터 적용하고 신규 통합 회귀 1개 통과(과거 대본 FK·run 버전·workspace/scene 격리·원시 응답/내부 메시지 제외). 최초 fixture에서 필수 topicKey 누락으로 실패한 뒤 fixture를 수정하고 재검증했다. migration: 이 단계에는 없음. 다음 단계 및 외부 확인 항목은 아직 미완료다.

## 공식 문서 확인

확인일 2026-11-17. 구현 단계별로 해당 사양·정책을 다시 대조하며 고정 가격/과거 할당량을 근거 없이 넣지 않는다. 갱신 책임: 해당 Provider/connector 유지보수자.

- [YouTube search](https://developers.google.com/youtube/data/reference/rest/v3/search/list), [playlistItems](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list), [정책](https://developers.google.com/youtube/terms/developer-policies), [정책 가이드](https://developers.google.com/youtube/terms/developer-policies-guide)
- [LoC JSON API](https://www.loc.gov/apis/json-and-yaml/requests/)
- [NASA API](https://api.nasa.gov/), [이미지 API 명세](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf)
