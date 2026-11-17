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

## 20.2 채널 수집과 조사 경로

구현: `collectionRule.profile`은 선택적 버전 JSON이며 기존 채널에는 강제 기본 프로필을 넣지 않는다. 채널 운영 화면에서 역사/과학/IT 초기값을 선택하고 언어·지역·출처·세부 주제·예산·주기·반복·제작 조건을 편집한다. `TOPIC_SOURCE_PROVIDER=profile`일 때 채널 프로필을 사용하며 미설정이면 `CHANNEL_COLLECTION_PROFILE_REQUIRED`로 중단한다. 기존 fixture/rss 모드는 유지한다. YouTube 공개 탐색에는 서버 전용 `YOUTUBE_DISCOVERY_API_KEY`가 필요하다. 값이 없으면 해당 소스만 실패한다.

지원 커넥터: RSS/Atom, YouTube search 및 channels→uploads playlist→playlistItems→videos, LoC JSON 검색, NASA 이미지 검색 메타데이터. IT 초기값에는 구현되지 않은 IT API를 표시하지 않으며 사용자가 RSS를 지정한다. NASA/LoC 메타데이터는 SUMMARY이며 항목별 미디어 권리 검토가 필요하다. 타인 영상·음성·자막을 다운로드하지 않는다. YouTube 공개 통계는 원본 메타데이터로 분리하며 점수화하지 않는다. Shorts 판정/시청자 지역 통계로 검색 조건을 표시하지 않는다.

외부 읽기: 허용 도메인, HTTPS, DNS 전체 주소 검사와 검증 주소 고정, 리다이렉트별 재검사, 제한 시간·응답 바이트·형식 검사를 적용한다. HTML article/main 추출에 실패하거나 잘린 경우 FULL_TEXT로 승격하지 않는다. 정규화 원문·URL·수집 시각·fingerprint·위치·단일 출처 범위를 보존한다. LLM 지시문에는 외부 본문과 질문이 신뢰할 수 없는 데이터임을 명시한다. 외부 본문의 진실성이나 독립적 교차 검증을 보장하지 않는다.

`SourceFetch`는 채널 행 잠금으로 UTC 일별 호출을 선점하고 시간 구간별 요청 캐시를 공유한다. 실패/진행 중 호출도 예산에 포함하며 같은 구간에서 새 호출로 우회하지 않는다. 만료 응답은 제거하고 예산 영수증은 최소 2일 유지한다. 다른 소스의 성공을 개별 실패가 막지 않는다. NEWS/EVERGREEN/MIXED를 RSS와 최종 점수에 적용한다. 제목 유사도와 발행일 근접성에 따른 사건 묶음은 편집상 연결이며 주장/본문 레코드를 합치지 않는다. 반복 제한은 저장된 출처의 인물/세부 주제/사건 식별 근거가 있는 경우 적용하며 인물 인식 NLP를 가장하지 않는다.

질문 API:

- `GET /channels/:channelId/research/presets`
- `GET/POST /channels/:channelId/research/questions`: AUDIENCE/EDITORIAL/AI_HYPOTHESIS를 구분하고 처음에는 INVESTIGATE로 저장한다. 같은 멱등 키의 다른 입력은 거절한다.
- `POST /channels/:channelId/research/questions/:questionId/recheck`: 다음 수집에서 재조사한다.

세부 주제의 조사 질문을 만들고 공식 컬렉션 검색에 반영한다. 원문을 찾으면 SUPPORTED(조사 자료 확보, 사실 검증 통과와 다름), 없으면 NEEDS_REVIEW로 남긴다. 공개 영상 발견만으로 제작 후보를 승인하지 않는다. 수집/선정/제작 주기와 제작 조건의 스케줄러 적용은 20.6, 후보·API 데이터의 전역 보존 스케줄은 20.10에서 완성한다.

Migration `202611170005_collection_profiles`: nullable profile 추가와 source_fetches/research_questions 생성. 격리 최신 기존 DB(채널 7개) 업그레이드 통과. 신규 테스트 DB는 이전 19개 migration부터 적용 후 20번째를 적용했다. 기존 규칙은 profile NULL로 유지하며 backfill은 사용자가 초기값을 선택해 저장한다. 운영 rollback은 앱을 이전 버전으로 돌리고 추가 컬럼/테이블을 유지한다. 데이터 삭제 rollback은 질문·호출 근거 손실을 수반하므로 자동 down migration을 제공하지 않는다.

검증: Provider 계약/SSRF/RSS/점수 11개, API 질문 격리/멱등 1개, 실제 MySQL 호출 경쟁/캐시/기존 후보 재평가 2개 통과. Config 기존 10개 통과. 모바일 Playwright 프로필 초기값·다국어·여러 줄 주제 저장/플랫폼 설정 보존 통과. 첫 브라우저 검사에서 textarea의 명시적 접근성 이름 누락을 발견해 수정 후 통과했다. 변경 contracts/providers/config/database/API/worker/web lint·typecheck 통과. 실 API 호출·유료 호출·게시·외부 알림은 실행하지 않았다.

## 20.3 기획 보존과 장면 의미

기획 title/summary를 script qualitySnapshot과 content의 기획 제목에 저장한다. sourceReference 제목은 원본 제목, sceneDocument.title/screenTitle은 화면 제목, reviewTitle 및 version metadata는 게시 제목이다. 부분 재생성은 저장된 기획과 수동 게시 제목을 보존하며 metadata 재생성만 게시 메타데이터를 교체한다. 게시 메타데이터 편집은 원래 영상을 재사용하는 새 장면/대본 FK와 재사용 사유를 만들고 해당 플랫폼 예약을 HELD로 전환한다. 형제 플랫폼이나 이미 게시한 버전은 변경하지 않는다.

`alignSceneNarration`은 균등 분할을 제거했다. 순서대로 정확히 대응하는 기존 낭독문을 고정하고 사이의 단일 변경 장면만 갱신한다. 여러 장면의 대응을 결정할 수 없으면 `SCENE_NARRATION_SEMANTIC_ALIGNMENT_REQUIRED`로 새 장면 기획을 요구한다. 한 장면 영상은 전체 낭독문을 그 장면에 배치한다. 정규화 대본 위치 scriptRange와 완전 결합 일치를 검사하며 실제 음성 정규화/시간 매핑은 20.5에서 확장한다.

문장이 바뀐 장면은 시각 프롬프트/오버레이를 새 문장으로 교체하고 기존 이미지를 복사하지 않는다. 변경 없는 장면은 의미/시각 입력 비교와 사유를 저장해 재사용한다. 원래 음성과 설정이 확인되는 부분 작업에서는 음성도 재사용한다. 승인/정책 결과는 새 버전에서 재검사한다. 영향이 모호한 전체 수정에 기존 그림을 붙여 성공으로 처리하지 않는다.

최대 3개 Hook 후보의 본문 연결/과장/길이를 평가해 기록하며 선택한 Hook이 실패하면 원인 코드를 다음 생성 입력에 전달한다. 한국어/CJK/영문 혼합 낭독량의 보수적 시간 추정으로 긴 대본을 제한한다. 이는 실제 TTS 길이나 성과 예측이 아니며 최종 음성 검사를 유지한다. 채널 상한과 기존 workflow 비용 예약으로 재생성 비용을 제한한다. 원문 수집 시각/fingerprint/근거 위치를 sourceReference로 전달한다.

검증: scene-schema 16개, worker 생성/Hook unit 및 실제 MySQL·Redis 생성/중복 전달/취소 회귀 7개, API 권리·플랫폼 격리·메타데이터·변경 장면 이미지 무효화 회귀 6개 통과. 첫 worker integration 실행의 테스트 Redis 주소 누락을 중단하고 격리 16379 포트로 다시 실행했다. 변경 scene-schema/providers/API/worker lint·typecheck 통과. migration 없음. Provider의 이미지 참조·공유 캐시·실제 음성 시간·렌더 중단은 후속 단계 범위다.

## 공식 문서 확인

확인일 2026-11-17. 구현 단계별로 해당 사양·정책을 다시 대조하며 고정 가격/과거 할당량을 근거 없이 넣지 않는다. 갱신 책임: 해당 Provider/connector 유지보수자.

- [YouTube search](https://developers.google.com/youtube/data/reference/rest/v3/search/list), [playlistItems](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list), [정책](https://developers.google.com/youtube/terms/developer-policies), [정책 가이드](https://developers.google.com/youtube/terms/developer-policies-guide)
- [LoC JSON API](https://www.loc.gov/apis/json-and-yaml/requests/)
- [NASA API](https://api.nasa.gov/), [이미지 API 명세](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf)
