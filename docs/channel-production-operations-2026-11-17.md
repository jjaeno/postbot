# 채널별 제작·운영 개선 기록

기준 커밋: `31d0564a1d44711f830e44de0b6563c39cff6ca2`. 브랜치: `feat/channel-production-operations`. 시작 시 작업 트리는 깨끗했다. 이번 요청은 20단계 전체를 승인하며 push/merge/배포는 금지한다. 2026-11-20 현재 요청된 20.1–20.10의 로컬 구현과 필수 검증을 완료했다. 실제 Provider·운영 환경의 확인과 의도적 미지원 범위는 마지막 상태표에 구분했다. 아래 초기 상태표와 단계별 당시 기록은 작업 경과를 보존한다.

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

## 20.4 자산 캐시와 권리 정책 (11월 18일 재개)

GRAPHIC 장면은 이미지 수량·스톡 선택·유료 이미지 호출에서 제외한다. 채널의 공통 visualGuide와 장면별 subject/setting/continuity/avoid 요구사항을 저장하고 생성 프롬프트에 함께 전달한다. 참조 자산은 같은 채널과 유효 권리를 검사한다. 현재 이미지 어댑터는 텍스트 설명만 지원하며 실제 이미지 참조 conditioning을 구현했다고 표시하지 않는다.

호출 전 캐시는 채널별 입력 키를 MySQL 행 잠금으로 선점한다. 키에는 Provider·모델·계정/계약 범위·이미지 프롬프트·크기·가이드/설정 버전 또는 음성·전체 낭독문·정규화/설정 버전을 포함한다. 다른 플랫폼에서 동일 입력을 재요청해도 실제 Provider 호출과 비용 기록은 한 번이다. 진행 중 호출은 대기로, 불명확 호출은 원래 journal/캐시 키를 보존한 검토로 처리한다. 캐시와 이미 준비된 자산 모두 실제 파일을 확인하며 누락을 ready로 취급하거나 자동 재과금하지 않는다. 캐시 조회는 현재 license를 다시 평가한다. 비밀 키는 저장하지 않으며 미설정 계정은 비밀 키의 비가역 fingerprint로 캐시를 구분하되 권리 승인 근거로 사용하지 않는다.

권리 API는 `GET/POST /channels/:channelId/provider-rights`, `POST /channels/:channelId/provider-rights/:policyId/revoke`다. 생성은 OWNER의 확인, 증빙 URL/문서 해시/약관 버전/검토 메모, 정확한 Provider·모델·계정 참조·계약 버전 및 유효 기간을 요구한다. 해당 범위에서 생성한 자산만 정책 FK와 기간을 가진 license를 얻는다. 미확정 계정/계약, 다른 모델, 만료/철회된 정책은 검토가 필요하다. Provider 이름만 보고 VERIFIED로 승격하지 않는다. 철회 시 연결 자산의 권리 이력을 추가하고 관련 SCHEDULED 예약을 HELD로 전환한다. 이미 진행 중이거나 완료한 외부 게시를 취소했다고 보고하지 않는다.

환경 변수: `IMAGE_PROVIDER_ACCOUNT_REF`, `IMAGE_PROVIDER_CONTRACT_VERSION`, `TTS_PROVIDER_ACCOUNT_REF`, `TTS_PROVIDER_CONTRACT_VERSION`. 계정 참조는 운영자가 관리하는 비밀이 아닌 식별자다. 실제 API 키나 계약 원문을 넣지 않는다. Google/ElevenLabs의 최신 공식 약관과 계정별 계약을 운영자가 확인한 후 증빙을 등록한다.

Migration `202611170006_generation_cache_rights`: generation cache와 versioned rights policy, asset license의 nullable policy FK 추가. 새 테스트 DB 및 기존 테스트 DB 업그레이드 통과. 기존 자산/권리는 backfill이나 자동 승인 없이 유지한다. rollback은 이전 앱과 추가 DB 구조를 유지하는 방식이며, 캐시/journal 삭제는 유료 호출 중복 위험 때문에 복구 방법으로 제공하지 않는다. workspace 명시 삭제 시 관련 신규 FK 순서를 반영했다.

검증: asset-library 10개(실제 DB 동시 선점, 플랫폼 간 이미지·음성 재사용, 음성 변경, 파일 누락 포함), API 권리/검수 회귀 7개, worker GRAPHIC·기존 불명확 호출 journal 회귀 5개, scene-schema 16개 통과. 변경 asset-library/config/database/scene-schema/API/worker lint·typecheck 통과. 실제 유료 호출이나 외부 게시 없음. 실제 시각 연속성은 이미지 참조 미지원 한계를 포함해 후속 renderer smoke와 외부 확인을 구분한다.

## 20.5 발화·자막·오디오·렌더 중단

대본 원문과 Provider에 전달하는 발화를 speech-v1으로 분리하고 UTF-16 위치 매핑을 보존한다. 한국어/영어의 숫자·날짜·단위와 한국어 약어, 명시적 고유명사 발음을 정규화한다. 다른 언어의 숫자는 원문을 유지한다. 자동 제작은 대본 언어를 전달한다. Provider의 실제 발화 alignment와 일치하는 타임스탬프만 원문 표시 자막으로 투영하며, 일치하지 않는 증거는 검토로 보낸다. 단어 내부 위치는 제공된 시간 구간의 선형 추정이며 음소 정렬을 보장하지 않는다. 음성 캐시는 원문 매핑과 정규화 버전을 포함한다.

자막은 짧은 단어 단위 대신 읽을 수 있는 구절로 묶고 원문 숫자와 단위 사이의 공백을 보존한다. 최소 노출 0.3초와 최대 밀도 30 text units/초를 기술 QA로 검사한다. 한글 제목은 어절을 유지하고 균형 있게 줄바꿈한다. 실제 FFmpeg로 음성 -16 LUFS, BGM/SFX -23 LUFS 정규화 후 사용자 볼륨을 적용하고 혼합 피크를 제한한다. 동적 ducking은 지원하지 않는다. 짧은 음성의 loudness 수치는 자연 음성의 청감이나 장기 콘텐츠 품질 보장이 아니다.

Remotion은 AbortSignal을 취소 신호와 직접 소유한 Chromium 종료에 연결한다. FFmpeg/ffprobe는 종료 요청 후 실제 close를 기다리고 지연 시 강제 종료한다. 작업 취소/시간 초과/소유권 상실은 하위 작업이 끝난 뒤 반환하고 임시 파일을 정리한다. bundle 도중 즉시 취소는 지원하지 않으며 bundle 완료를 기다린 뒤 중단한다. manifest 저장 전 취소와 실행 소유권을 재검사한다. rendererVersion은 1.3.0이다.

검증: renderer lint/typecheck/build와 unit 9개, scene-schema unit 11개, providers unit 29개(자격 증명 필요 1개 skip), worker 관련 실제 MySQL/Redis 통합 14개 통과. 숫자 발화→원문 자막, 불일치 검토, 취소 중 shutdown 완료 전 임시 파일 보존, 오래된 소유권 차단을 포함한다. DB의 신규 FK cleanup 순서를 보완하고 기존 data-model 8개를 통과했다. 변경 packages/API lint/typecheck를 통과했다. scene-schema 테스트를 src에 한정해 dist의 중복 실행을 제거했다. 앞 단계 16개 표기는 당시 dist 중복을 포함한 실행 집계다.

실제 Docker Chromium/FFmpeg의 1080×1920, 6초 영상과 HOOK/COMPARISON/PROCESS 대표 프레임 3장을 출력해 직접 확인했다. 합성 음성과 BGM fixture이며 실제 유료 TTS가 아니다. QA: audio=true, mean -15.3dB, peak -10.4dB, blackFrameRatio=0. 첫 프레임에서 발견한 한글 어절 분리를 수정하고 재출력해 확인했다. 산출물은 로컬 .artifacts/production-qa-2026-11-18에 있으며 Git에는 포함하지 않는다. 넓게 실행된 worker 검사에서 병렬 부하에 의한 5초 timeout과 서로 다른 메모리 저장소를 사용한 fixture 결함을 발견했다. 저장소를 주입해 동일 Fake 객체를 사용하도록 고친 뒤 관련 4파일 14개를 단일 worker로 재검증했다. 객체 누락 검사는 완화하지 않았다. migration 없음. 실제 Provider 청감/타임스탬프 검증은 외부 확인 필요다.

## 20.6 제작 수요와 운영 대기

제작 수요는 채널 행 잠금 안에서 다시 계산하고 run 생성과 후보 예약을 함께 선점한다. 생성 중 콘텐츠/실행, 승인된 재고, 설정된 시간 안의 가까운 예약을 준비 재고로 계산한다. 검수 대기는 별도 상한으로 관리하며 멀리 있는 예약은 준비 버퍼를 채우지 않는다. 렌더를 마친 승인·정책·게시 대기는 producer slot을 점유하지 않는다. 제작 중 보류는 slot을 유지해 불명확 유료 작업을 우회하지 않는다. 명시적 pause/drain은 새 제작으로 우회하지 않으며 비활성 채널의 이미 큐에 있던 작업도 시작 전에 검토 보류한다. 사용자가 명시적으로 요청한 PAUSED 채널의 샘플 제작 예외는 유지한다.

프로필 production에 producerConcurrency(기본 1), reviewCap(기본 5), scheduledBufferHours(기본 24)를 추가하고 운영 화면에서 편집한다. 기존 JSON은 읽을 때 기본값을 적용하며 DB 강제 backfill은 없다. run 응답의 productionState는 DISCOVERY/NOT_REQUIRED/PRODUCING/REVIEW_REQUIRED/READY/FAILED/CANCELLED로 제작 책임을 표시하고 기존 status는 운영 실행 상태로 유지한다. READY는 게시 성공을 의미하지 않는다.

프로필 채널은 DISCOVER(외부 수집), RANK(저장 후보 재평가), SELECT(제작용 원자적 후보 선점)를 구분한다. 수집·선정·제작 주기는 각각 독립된 durable 멱등 키를 사용한다. 수집과 후보 평가만 하는 run에는 유료 제작 단계를 만들지 않는다. 선정은 원격 소스를 재호출하지 않으며 현재 규칙과 중복·예약 상태를 재검사한다. 시각 자료 확보 조건은 실제 HTTPS 참고 자료가 있는 후보만 통과시키며 권리 승인을 대신하지 않는다. 후보가 없으면 다음 수집 시각까지 기다리고 새 빈 제작 run을 매 tick 생성하지 않는다. 프로필 없는 기존 채널은 기존 수집+선정 경로를 유지한다.

검증: API 기존 자동화/분기/시뮬레이터/복구와 새 실제 MySQL·Redis 수요 테스트 총 25개 통과. 7일 뒤 실제 예약 3개와 승인 대기를 유지하면서 보충, 다른 키의 동시 요청에서 2개 producer 상한, 검수 5개 상한, 수집/RANK 키 경쟁과 Redis waiting 상태를 확인했다. worker 기존 생성/Redis 재전달 회귀 6개와 후보 평가/경쟁/빈 선정/채널 정지 3개 통과. 새 fixture의 필수 점수·workspaceId 누락을 수정 후 재검증했다. 모바일 Playwright로 동시 제작 2·검수 7·가까운 예약 12시간 저장과 기존 플랫폼 설정 보존 통과. 변경 contracts/API/worker/web lint·typecheck 통과. migration 없음. 전역 보존·사용량 정산·게시 결과 대사는 후속 단계다.

## 20.7 사용량 정산과 안전한 복구

비용 예약은 호출되지 않음/캐시 재사용이면 해제하고, 사용량과 설정 단가가 확인되면 KNOWN_USAGE_BILLING_PENDING으로 정산한다. 청구서가 아직 없다는 이유로 같은 예약을 영구 유지하지 않는다. 실제 청구가 확정된 INVOICE_CONFIRMED와 구분한다. STARTED journal·불명확 Provider 결과는 계속 위험 예약을 유지한다. 과거 사용량만 있고 단가·청구액이 모두 없는 기록은 USAGE_KNOWN_RATE_PENDING으로 보존하며 금액을 지어내 정산하지 않는다. 스케줄러의 cursor/batch 100개 재검사로 완료 직후 알림이 유실된 예약도 정산한다.

예산은 같은 사용의 추정액과 실제액을 더하지 않으며, 진행 중 예약에서는 이미 비용으로 기록한 사용분을 뺀 나머지 위험만 계산한다. UTC 일/월 예약 창을 분리하고 이전 날 호출되지 않은 예약을 오늘의 일별 상한에 넣지 않는다. 오래된 예약의 새 호출은 현재 창의 예산을 재승인해야 한다. 재승인 후에도 accountedActual로 이전 확정 비용을 중복 반영하지 않는다. 원래 journal과 호출 키는 유지한다. GRAPHIC은 이미지 비용 추정에서 제외하고 TTS 예상 글자 수는 정규화 발화를 기준으로 한다. 프로필 제작 상한은 대본 외 제작 단계에도 적용하며 상한 추정 때문에 캐시 적중 전 보수적 보류가 발생할 수 있다.

OWNER 전용 `POST /operations/usage/:usageId/reconcile`은 expectedRevision, 멱등 키, 실제 금액 문자열, 증빙 SHA-256, 비밀이 아닌 외부 참조를 받는다. 수동으로 확인한 증빙을 등록하는 경로이며 실 청구 API 조회나 증빙 내용의 독립 검증을 수행한 것으로 표시하지 않는다. 이전 금액/새 금액/수정 revision/주체를 영구 영수증으로 저장하고 ACTUAL ledger에는 차액만 기록한다. 증빙 해시·참조와 감사 이력은 원시 인증정보를 포함하지 않아야 한다. 같은 키의 다른 금액/증빙, stale revision, 다른 workspace, 비 OWNER 요청은 거절한다. 제작 조회에 billingState/billingRevision을 노출하며 청구 미확정 사용이 있는 비용 보고서는 reconciled=true로 표시하지 않는다.

`POST /operations/jobs/:jobId/provider-outcome`은 OWNER가 원래 callKey와 증빙을 고정해 NOT_ACCEPTED 또는 RESULT_AVAILABLE을 확인한다. 원래 STARTED 값은 별도 불변 receipt에 남기며 journal을 삭제하거나 새로운 요청 키로 우회하지 않는다. 복구된 LLM 응답은 원래 요청 키/토큰 수/크기를 검사한 뒤 기존 구조·근거·품질 검증으로 다시 처리한다. 미디어는 같은 job·channel·scene·purpose·원래 cache/provider 사용 영수증을 갖춘 자산만 연결한다. 현재 파일/권리 검사는 재개 시에도 유지한다. 사용 금액 증거와 모순되는 NOT_ACCEPTED는 거절한다. 기존 callKey NULL 캐시는 단일 미확정 호출과 캐시를 유일하게 대응할 수 있을 때만 OWNER 증빙으로 연결하고, 모호한 과거 기록은 LEGACY_CALL_SCOPE_REVIEW_REQUIRED로 남긴다. 외부 결과를 확보하지 못하면 검토를 유지한다.

HTTP 오류는 VALIDATION/AUTH/RATE_LIMIT/TRANSIENT/AMBIGUOUS와 로컬 BUDGET/QUALITY를 구분한다. 400·인증·가격 설정 오류는 반복 자동 호출하지 않는다. 429/503은 공식 응답의 Retry-After와 지수 backoff/jitter를 적용하고 한도 후 검토한다. timeout/응답 유실/불명확 5xx는 자동 재과금하지 않는다. 거절된 cache/journal은 REJECTED로 보존하며 재개해도 원래 키를 사용한다. 공유 캐시 진행 중은 제한된 대기, 객체 유실은 복원 검토로 처리한다. 렌더 시간 초과는 RENDER_TIMEOUT으로 구분한다. HTTP 503의 재시도 분류는 공식 unavailable 응답 계약을 따른 것이며 개별 계정 청구 결과 보장은 아니다.

Migration `202611180001_billing_reconciliation`, `202611180002_generation_call_scope`, `202611180003_reservation_actual_accounting`: 청구 상태/revision과 immutable 청구 영수증, nullable cache callKey, 예약 정산 근거·반영 actual 추가. 기존 actualCost가 있는 행만 INVOICE_CONFIRMED로 backfill하며 그 외 비용을 실제 청구로 승격하지 않는다. 기존 정산된 예약은 연결된 stage/platform 사용량의 actual 합계를 accountedActual로 채운다. 빈 격리 DB의 24개 migration 및 기존 데이터 DB 업그레이드 통과. actual 3.000000을 가진 기존 예약에서 accountedActual=3.000000, run budgetActual=3.000000을 확인했다. 이전 앱으로 rollback할 때 제작을 정지하고 추가 DB/영수증을 유지한다. 이전 회계 로직의 중복·보류 결함까지 안전하게 되돌리는 down migration은 제공하지 않는다.

검증: API 예산/청구/대사/조회 실제 MySQL 회귀 12개, worker Mock HTTP·원래 키 재개·음성·렌더 회귀 20개, 자산 공유 캐시 10개, Provider 계약/오류 14개, 기존 data-model 8개, 명시 삭제 FK 회귀 2개 통과. 관련 contracts/database/providers/asset-library/API/worker lint·typecheck 통과. 예전 LLM 테스트의 청구 미확정 예약을 계속 유지한다는 기대는 새 정산 계약으로 바꾸었고, 모든 재시도 토큰·비용 기록 검증은 유지했다. 새 통합 fixture의 JSON 타입과 lint 오류는 수정 후 재검증했다. 실제 유료 호출·청구 API·SNS·외부 알림은 실행하지 않았다.

오류 계약 확인일 2026-11-18: [Gemini API errors](https://ai.google.dev/gemini-api/docs/api-errors?hl=en), [ElevenLabs errors](https://elevenlabs.io/docs/eleven-api/resources/errors), [ElevenLabs 429](https://elevenlabs.io/docs/help-center/technical/api-error-code-429). 갱신 책임은 Provider 어댑터 유지보수자다.

## 20.8 계정 갱신과 게시 결과 확인

OAuth 갱신은 DB lease와 credentialVersion 비교로 프로세스 간 단일 실행한다. 갱신 중 연결 해제·새 인증·키 교체가 발생하면 이전 응답은 저장하지 않는다. 확정 권한 철회는 EXPIRED로 반영하며 일시 오류와 구분한다. 제작 전 알려진 계정 장애는 해당 플랫폼만 보류한다.

게시 결과는 UPLOADED/PROCESSING/SCHEDULED/PUBLISHED/FAILED와 결과 불명확 검토를 구분한다. 외부 ID 수신만으로 공개 완료나 현재 시각을 기록하지 않는다. YouTube의 native 처리 상태·공개 설정·실제 시각을 조회하고, 확인된 공개 결과만 분석 대상으로 삼는다. 의도한 비공개 업로드는 비공개 완료로 표시한다. Instagram 어댑터가 지원하지 않는 비공개 설정과 TikTok 보류는 유지한다. 상태 조회는 재업로드하지 않으며 실패·재인증·조회 미지원은 검토로 남긴다. resumable session은 키 버전과 함께 암호화해 비공개 attempt 증거로 보관하고 조회 응답에서 제외한다.

OWNER의 POST /publishing/plans/:id/reconcile은 알려진 외부 ID와 증빙 SHA-256을 원래 계획에 연결하는 조회 작업을 만든다. 모바일 화면은 증빙을 로컬에서 해시하며 파일 내용은 전송하지 않는다. 자동 재확인 outbox는 cursor/batch 100개로 복구된다. 외부 게시가 시작된 계획을 로컬 취소만으로 취소 완료로 표시하지 않는다. 놓친 시각 정책은 IMMEDIATE/NEXT_SLOT/REVIEW와 유예 시간을 지원하며 다음 슬롯은 시간대·채널 상한·슬롯 충돌을 검사한다. durable 멱등 키는 원래 요청 fingerprint를 보존해 runtime journal이나 재시도 시각 변경이 동일 요청을 충돌시키지 않게 했다.

Migration 202611180004~006: 갱신 fencing, nullable 실제 게시 시각·확인 상태·비공개 증거, 과거 게시 상태 backfill을 추가한다. 과거 시각은 보존하되 LEGACY_UNCONFIRMED로 표시하고 PUBLISHED 계획/콘텐츠를 HELD로 전환하며 이전 상태와 시각을 감사 기록에 보존한다. 기존 24개 migration 데이터 DB와 빈 DB에서 시작한 검증 DB 모두 27개까지 적용 성공. 기존 credentialVersion=0/lease=NULL, 과거 시각 보존·HELD 전환 확인. rollback은 제작·게시를 중지한 뒤 확장 schema와 증거를 유지해야 하며 이전의 업로드=공개 완료 로직으로 되돌리는 down migration은 제공하지 않는다.

검증: 실제 두 OS 프로세스 OAuth 경쟁·늦은 응답 fencing·권한 철회 4개, publishers Mock 계약 18개, worker 게시/미디어 journal/Redis 복구 24개, API 확인 outbox·권한·멱등 2개와 자동화 시작 10개 통과. 관련 API 예약·분석 회귀와 변경 package/app lint·typecheck 통과. 모바일 Playwright 운영 설정 저장·보류 예약 복구·외부 ID/증빙 해시 확인 3개 통과. Fake 비공개 업로드를 공개 완료로 잘못 표시하던 계약을 수정했고, 격리 acceptance 환경만 공개 Fake 설정을 명시했다. 실제 SNS 공개 설정 기본값을 변경하지 않았다. 추가 transaction에 맞춰 DB 실패 주입 지점을 PUBLISHING 단계로 지정하고 반복 DB fixture의 외부 ID를 유일하게 수정했으며 실패·중복 업로드 검증은 유지했다. 실제 SNS/OAuth/유료 호출은 하지 않았다.

공식 계약 확인일 2026-11-18: [YouTube videos](https://developers.google.com/youtube/data/reference/rest/v3/videos), [videos.list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), [OAuth 갱신](https://developers.google.com/identity/protocols/oauth2/web-server). 갱신 책임은 플랫폼 어댑터 유지보수자다. 실제 계정의 처리 지연·게시 시각·권한 철회 응답은 외부 확인 필요다.

## 20.9 관측 목적과 정기 분석

비교 요청은 RELATIVE_AGE/CALENDAR_PERIOD를 구분한다. YouTube 자동 관측은 게시 당일의 부분일을 제외한 태평양 시간대 전체 달력 하루이며, API의 inclusive endDate와 내부 exclusive end를 변환한다. 일광절약 전환의 23/25시간을 정확한 24시간 관측이라고 표시하지 않는다. 서로 다른 게시일이라도 확인된 전체 상대 달력 일과 플랫폼·지표·mapping·단위·집계 정의가 같으면 같은 cohort로 묶는다. 달력 기간 비교는 절대 기간을 유지한다. 누적 snapshot은 실제 수집 경과시간의 제한된 오차 범위만 비교하며 달력 기간 값과 섞지 않는다. 여러 날 native 합계의 실제 일별 coverage를 확인하지 못하면 상대 비교에서 제외한다. 원래 수집 직후 7일 보고서를 요청하던 게시 완료 부수 작업은 제거하고 durable 게시 후 관측 스케줄러가 수집을 담당한다.

활성 채널 cursor/batch 50, 최근 유효 snapshot 최대 1000개에서 버전 고정·관측 정의가 같은 서로 다른 게시물 4개 이상의 새 증거가 모이면 ANALYTICS 큐의 analysis 작업을 예약한다. 동시 스케줄러는 증거 ID fingerprint와 기존 DB 멱등 키로 하나의 작업을 만든다. 공통 packages/optimization 엔진을 API·worker가 함께 사용하며 중복 생성·소비된 증거의 반복 예약을 막는다. 표본 부족 제안은 증거를 소비하지 않는다. GET /optimization/channels/:id/analysis-status와 모바일 화면에 필요한 표본·현재 비교 가능 수·다음 확인 시각을 표시한다. bounded 최근 1000개/90일 범위 밖의 과거 전체 데이터 분석은 이 자동 경로의 대상이 아니다.

2026-11-18 [YouTube Developer Policies III.E.4.h](https://developers.google.com/youtube/terms/developer-policies), [Analytics day 정의](https://developers.google.com/youtube/analytics/dimensions#day)를 확인했다. 현재 정책에 따라 YouTube API 관측으로 평균·자체 점수·효과·실험 승자·자동 전략을 계산하지 않는다. 원래 native 관측과 Postbot의 불변 제작 특성·자체 사용량 비용 영수증은 출처를 구분해 기록한다. YouTube 제안은 YOUTUBE_DERIVED_DATA_RESTRICTED/HELD, baseline/변경안/예상 효과 없음으로 남기며 과거 제안 승인·적용과 실험 완료 계산도 차단한다. 범용 비 YouTube 비교의 훅·장면·자막·음성 분석은 설명적 가설이며 신뢰도·인과·성과 향상을 보장하지 않는다. 기존 명시 허용 필드·변경 폭·종료 기준·rollback을 유지한다. 주제·비용을 포함한 추가 편집 전략의 효과 검증은 원래 지표와 혼합하지 않으며, 정책상 미지원 기능을 완료한 것으로 표시하지 않는다. 갱신 책임은 분석/플랫폼 어댑터 유지보수자다.

검증: optimization unit 8개, Provider Mock 4개(25시간 DST·inclusive 날짜 포함), API MySQL/Redis·scope 회귀 7개, worker 수집/분석 dispatch·멱등 회귀 5개와 기존 복구 회귀 통과. 모바일 표본/다음 확인/정책 경계 Playwright 통과. 변경 packages/API/worker/web lint·typecheck/build 통과. 비용 증거의 실제 DB 필드 operation과 불필요 import를 수정해 재검증했다. 기존 YouTube 승자 계산 fixture는 제한을 회피하지 않고 Instagram 기반 범용 계산 회귀로 옮겼으며, 별도 YouTube 정책 차단 테스트를 추가했다. migration 없음. 실제 API 수집·권한 승인·법률상 해석·성과 개선 효과는 외부 확인 필요다.

## 20.10 보존·업무 감시·백업

보존은 `StorageDeletion`의 MARKED/DELETING/FILES_DELETED/DONE으로 재개한다. FAILED 콘텐츠의 오래된 렌더도 예약·검토·활성 작업·자동화 참조가 있으면 지우지 않는다. 자산은 사용·생성 캐시·브랜드·템플릿·권리 근거를 재검사한다. 파일 삭제 전에 manifest를 준비 상태에서 제외하고, 삭제 시작 전 새 참조가 생기면 취소한다. workspace 삭제는 먼저 계정·채널을 정지하고 실행 작업의 취소 완료를 기다린다. 실패한 같은 maintenance 요청은 같은 ID와 멱등 키로 재개한다. 비용·호출 journal·durable 작업 키와 후보 예약 근거는 기간만으로 삭제하지 않는다.

수집 캐시 만료와 미사용 후보 보존은 정지 채널도 cursor로 순회한다. 사용·선정·예약·생성 근거가 있는 후보는 보호하고 호출 영수증은 당일 예산 우회가 없도록 유지한다. Redis terminal 보존과 DB 증거 보존을 분리했다. 이미 저장된 원래 결과/비용 영수증이 완전한 작업만 원래 키로 복구하고, STARTED 또는 불명확한 유료 호출은 계속 검토한다.

저장소 재사용은 실제 객체 존재를 확인하며 검사 장애를 유실로 단정하지 않는다. 유실 시 원래 manifest와 체크섬을 보존한다. 원래 체크섬이 없는 과거 렌더는 자동 복원하지 않는다. 사용자 보존 요청은 해당 workspace 참조만 검사하고 전역 고립 객체 목록은 운영자 CLI에서만 확인한다. 소유권 미확인 객체는 해시로 보고하며 자동 삭제하지 않는다. 임시 파일은 경로 범위·소유 marker·같은 호스트의 종료된 PID·24시간 경과·DB 실행 소유권 부재가 확인된 경우만 정리한다.

`GET /operations/channels/:channelId/business-health`와 설정 화면은 마지막 수집·렌더·실제 게시, 누락 슬롯, 장기 대기, 반복 실패, 재인증, 예산 보류와 UTC 일별 결과/비용을 표시한다. 프로세스 생존과 업무 진행을 구분한다. 로컬 디스크 부족을 검사하고 S3 전체 용량은 미제공으로 표시한다. 외부 알림 기본값은 disabled이며 Mock만 구현·실행했다. DB claim, 중복 억제, 실패 재시도, 재알림과 확인 후 전달 중지를 실제 DB로 검증했다.

기존 덤프/검증/복원에 AES-256-GCM archive, 인증·체크섬 재검증, 보관 기간, 원자적 상태 파일과 systemd 일정 예시를 연결했다. 외부 저장소가 없으면 LOCAL_TEST_ONLY로 표시한다. 2026-11-20 격리 원본의 30개 migration, workspace 7개, channel 7개, content 5개를 암호화 백업에서 새 빈 `_restore` DB로 복원했고 Prisma schema diff가 없었다. 실제 외부 mount의 복제·가용성, 운영 키 보관, 주기 복원과 on-call은 운영자가 별도 검증해야 한다. 운영 백업이나 서비스 활성화는 실행하지 않았다.

최종 계약 감사에서 Instagram 게시 ID와 계정 소유자를 함께 확인하고, 인증 철회를 재인증으로 전파하며, YouTube 미래 공개/예정 premiere를 공개 완료로 오인하지 않도록 보완했다. 전략 적용은 채널·제안 잠금과 현재 허용 필드/변경 폭 재검사로 한 번만 적용하며 동시 rollback도 한 버전만 만든다. 승인 뒤 운영 설정이 바뀌어 허용을 취소하면 과거 제안 적용을 거절한다. 필수 시각 자료 검사는 저장 후보와 수동 선택 모두에 적용하며 HTTPS 문자열·객체 URL 형식을 함께 지원한다.

2026-11-20 [Instagram Media 공식 계약](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/v21.0/)에서 owner 확인 범위를 대조했다. 앱 사용자에게 귀속되는 owner가 응답하지 않거나 예상 계정과 다르면 공개 확정을 보류한다. 프로젝트에 고정된 API 버전을 자동 변경하지 않았다.

핵심 파일:

- [보존 처리](../apps/worker/src/retention.ts), [삭제/보존 작업](../apps/worker/src/data-lifecycle-processor.ts), [저장소 감사](../apps/worker/src/storage-audit.ts), [임시 파일 정리](../apps/worker/src/temp-cleanup.ts)
- [후보 보존](../packages/database/src/discovery-retention.ts), [복구 증거 판정](../packages/database/src/recoverable-result.ts), [큐 복구](../apps/worker/src/queue-recovery.ts)
- [업무 상태](../apps/api/src/operations/business-health.ts), [운영 API](../apps/api/src/operations/operations.service.ts), [전략 적용](../apps/api/src/optimization/optimization.service.ts), [게시 어댑터](../packages/publishers/src/index.ts)
- [백업 일정 실행](../scripts/scheduled-backup.mjs), [암호화 복원](../scripts/restore-archive.mjs), [운영 절차](operations.md), [systemd 일정](../ops/postbot-backup.timer)

추가 migration은 `202611180007_resumable_retention`, `202611180008_operational_scan_indexes`, `202611180009_discovery_retention_cursor`다. nullable cursor와 ACTIVE 기본 보존 상태를 사용하며 기존 결과를 자동 삭제하는 backfill은 없다. 전체 요청은 기준 19개에서 총 30개 migration으로 확장됐다. 기존 데이터 업그레이드와 빈 DB 적용을 검증했다. 운영 rollback은 제작/게시를 중지한 뒤 확장 schema와 원래 증거를 유지해야 한다. 삭제된 파일은 DB rollback으로 되살아나지 않으며 원래 체크섬이 있는 백업 복원이 필요하다. 첫 로컬 migration의 UTF-8 BOM 오류는 DDL 실행 전에 실패했고 BOM 제거·failed migration 정리 후 재적용했다. 이미 적용된 migration을 변경하지 않았다.

## 최종 검증과 남은 확인

전체 lint 27개 task, typecheck 27개 task, unit test 27개 task, build 15개 task와 desktop/mobile Playwright 26개가 통과했다. 전체 unit 검사의 첫 실행은 잘못된 기본 DB port로 실패했고 격리 DB URL을 명시해 통과했다. 관련 변경 이후에는 해당 범위만 추가 검증했다. 실제 MySQL/Redis 통합은 고유 테스트 157개(database 10, jobs 6, asset-library 6, API 62, worker 73)가 통과했다. 이후 저장소 감사 권한 범위 수정도 해당 실제 DB 테스트를 재실행해 통과했다. 게시 Provider Mock unit 20개, contracts src unit 3개와 Node 백업 unit 5개도 통과했다. contracts 검사는 src만 대상으로 하여 dist 중복 집계를 제거했다. 누락된 테스트 파일명으로 실행된 검사는 성공으로 세지 않았다.

기존 수동/승인 Fake 전체 여정은 2026-11-18 Docker에서 통과했다. 완전 자동 여정은 실행 중 호스트 절전으로 약 39시간의 wall-clock 점프와 Redis lock 만료가 발생하여 실패했다. 2026-11-20 assertion과 제한 시간을 완화하지 않고 최종 이미지·새 DB/Redis/MinIO 환경에서 해당 여정만 재검증해 통과했다(1 passed, 기존 통과 2개는 선택 실행에서 제외, 전체 484.58초). 플랫폼 3개의 렌더·정책·실제 Fake 공개 확인, analytics 작업 9개와 최적화 검사가 성공했다. 수동·승인·완전 자동 세 경로의 검증이 모두 확보됐다.

최종 Docker build도 성공했고 이미지 안의 소스 365개가 현재 파일의 SHA-256과 일치했다. 새 격리 acceptance DB에 migration 30개를 빈 DB부터 적용했다. 로컬 증거는 `.artifacts/final-validation-2026-11-18/`의 전체 검사 로그와 `.artifacts/final-validation-2026-11-20/`의 `docker-final-scoped-audit.log`, `source-hash-verification.log`, `acceptance-full-auto.log`에 보관한다. archive 키·덤프·렌더 산출물과 로그는 Git에 포함하지 않는다. 원격 CI나 PR의 성공을 주장하지 않으며 push/PR/merge/배포하지 않았다.

테스트 fixture 변경 이유: Fake 공개 확인은 실제 공개 계약에 맞춰 격리 환경만 public으로 설정했다. 미래 게시와 게시 후 관측은 테스트에서 명시적으로 시각을 진행시켰다. YouTube 파생 전략 성공 fixture는 정책을 우회하지 않고 Instagram 범용 분석으로 옮기고 YouTube 차단 검사를 추가했다. 동시성 fixture의 workspace/필수 필드·공유 Fake 객체·고유 외부 ID를 수정했으며 실제 실패/중복/권리 gate는 유지했다. 시각 자료의 문자열 URL 회귀는 객체와 문자열 모두에 대한 검사를 추가해 수정했다.

| 요구사항 | 최종 구현 범위 | 외부 확인 또는 의도적 미지원 |
|---|---|---|
| 1 제작/운영 경계 | 버전 고정 제작 결과와 별도 운영 상태 | 실제 공개는 native 확인 시에만 확정 |
| 2 채널 수집 | 편집 가능한 프로필·공식/RSS 소스·원문·질문·분리 주기 | 실제 API quota/권한·항목별 출처 권리 |
| 3 기획/장면 | 근거와 기획 보존, 의미별 낭독 정렬·검토 | 원문 진실성이나 모델의 내용 적합성 보장 없음 |
| 4 자산/권리 | 공통 가이드·호출 전 공유 캐시·GRAPHIC 분리·증빙 정책 | 참조 이미지 conditioning은 TEXT_DESCRIPTION_ONLY, 미확인 권리는 검토 |
| 5 음성/렌더 | 정규화 매핑·구절 자막·오디오 QA·실제 취소/회수 | 실제 유료 TTS의 자연스러움과 Provider 계정 검증 |
| 6 재고 | 원자적 수요/예약, 제작·검토·게시 수명 분리 | 운영 채널별 한도/주기 선택 필요 |
| 7 비용/복구 | 사용/청구/불명확 구분·대사·원래 호출 증거 복구 | 실제 청구서 확인, 불명확 호출은 자동 재과금 금지 |
| 8 계정/게시 | DB 갱신 fencing·native 상태/계정 확인·대사 | 실제 OAuth/공개 처리 확인, TikTok Direct Post 보류 |
| 9 성과 | 상대 달력 관측·주기 분석·멱등 전략/rollback | YouTube API 파생 점수/승자/전략은 HELD, 성과 향상 보장 없음 |
| 10 운영 | 재개 가능한 보존·업무 감시·Mock 알림·암호화 복원 | 외부 알림/오프사이트/운영 키·S3 용량 모니터·정기 복원 미설정 |

제작 계층은 원문·대본·장면·자산·QA 영상과 청구 근거를 제공한다. 운영 계층은 정책/권리/승인, 재고와 일정, 계정, 게시 확인, 성과 수집과 안전한 복구를 담당한다. READY는 PUBLISHED가 아니다. Fake/Mock 통과는 실 Provider·계정·정책 승인이나 운영 배포 완료를 의미하지 않는다.

수집 예시: 역사 초기값은 LoC, 과학은 NASA, IT는 운영자가 지정한 RSS를 사용한다. 초기 수집/선정/제작 주기는 각각 360/60/120분, 일 호출 상한 100, 검색 페이지 2, 캐시 60분, 후보 7일, 목표 20개다. 모두 편집 가능하며 채널 이름으로 강제 추론하지 않는다. 선정/제작 주기는 별도 설정이며 미설정 기존 채널에 초기 프로필을 몰래 backfill하지 않는다.

실 API·유료 생성·실 SNS 게시·실제 외부 알림·운영 DB·push/merge/배포는 실행하지 않았다. 정책 문서 확인은 계정별 계약/법률 승인과 다르다. 보호된 증거의 운영 보존/삭제 정책, 원래 체크섬이 없는 과거 렌더와 소유권 미확인 고립 객체는 검토가 필요하다. 외부 설정 없는 백업은 운영 성공으로 표시하지 않는다.

## 공식 문서 확인

확인일 2026-11-17. 구현 단계별로 해당 사양·정책을 다시 대조하며 고정 가격/과거 할당량을 근거 없이 넣지 않는다. 갱신 책임: 해당 Provider/connector 유지보수자.

- [YouTube search](https://developers.google.com/youtube/data/reference/rest/v3/search/list), [playlistItems](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list), [정책](https://developers.google.com/youtube/terms/developer-policies), [정책 가이드](https://developers.google.com/youtube/terms/developer-policies-guide)
- [LoC JSON API](https://www.loc.gov/apis/json-and-yaml/requests/)
- [NASA API](https://api.nasa.gov/), [이미지 API 명세](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf)
- 2026-11-18 재확인: [Gemini API 약관](https://aistudio.google.com/docs/terms), [ElevenLabs TTS 문서](https://elevenlabs.io/docs/overview/capabilities/text-to-speech). 소유권·계정 요금제·상업 사용·제한 조건을 각각 검토해야 하며 일반 약관 링크만으로 개별 자산 권리를 확정하지 않는다.
