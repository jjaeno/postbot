# 운영 안정성·콘텐츠 개선 후속 검증

요청일 2026-11-17, 시작 HEAD `7c0e638`, 브랜치 `fix/production-readiness`. 작업 트리 변경 없음에서 시작했다. 정적 분석 기준 `1717da8`의 후보를 최신 코드에서 재검증한다. 전체 v1 완료 선언과 별개인 19.9 후속 단계다. 유료 API, 실제 SNS, 운영 DB, push/merge/배포는 수행하지 않는다.

## 1단계: 중단 작업·게시

- 확인: RUNNING 재전달은 반환하며 기존 CLI만 startedAt/큐 상태로 판단했다. 자동 복구 및 살아 있는 실행자 구분이 없었다.
- 이미 해결: JobAttempt/ProductionJob/AutomationStep의 시작은 `7c0e638`에서 하나의 트랜잭션이다. 기존 회귀를 유지한다.
- 확인: 수동 예약→job 생성과 PUBLISHING→publishAttempt 생성은 분리되어 있었다.
- 수정: executionToken, 5초 heartbeat, 큐 active와 heartbeat 양쪽 확인, row lock 아래 복구 claim. 30초마다 자동 복구하고 CLI와 판정 공유. SCRIPT/ASSET/TTS/PUBLISH의 소유자 유실은 journal 누락 가능성까지 보수적으로 대사 보류한다. 안전한 작업만 같은 ID로 전달한다. 이전 token의 완료와 COLLECT 예약/RENDER manifest 커밋은 DB row lock 아래 차단한다.
- 수정: 수동 예약·durable ProductionJob·content 상태를 함께 저장한다. DB 작업을 outbox로 사용하며 Redis 실패 뒤 CLI/자동 스캔 또는 동일 요청이 재전달한다. 동일 요청은 예약 시간이 지난 뒤에도 소유권을 검증한 다음 기존 실행 연결을 복구한다. PUBLISHING과 시도 저장을 원자화한다. 고립 SCHEDULED에는 누락 job을 만들고 시도 없는 오래된 PUBLISHING은 HELD로 보낸다. 플랫폼 게시 기록이 있으면 재업로드하지 않는다.
- migration `202611170001_job_ownership`: nullable token/heartbeat, 기존 데이터 backfill 불필요. 기존 RUNNING은 startedAt을 참고하되 큐 active이면 유지한다. rollback은 신규 worker를 중지한 뒤 컬럼 제거가 가능하지만 보류된 유료 호출을 자동 재시도 상태로 돌리면 안 된다.
- 환경: 전용 `postbot-remediation-mysql`(13307), `postbot-remediation-redis`(16379), `postbot_remediation_test`. 실제/운영 DB를 사용하지 않는다.
- 검증 진행: 빈 DB의 전체 16 migrations 적용 성공. worker 게시/재전달/복구 9건, API 게시 6건 통과. 실제 worker 강제 종료를 추가한 경쟁 테스트에서 Prisma upsert의 unique-key 경쟁을 재현하여 중복 무시 insert로 수정했다. 최종 재검증 결과는 아래에 추가한다.

운영 복구: 먼저 `recover:queues`를 실행해 누락 전달을 복원한다. `RECONCILIATION_REQUIRED` 및 HELD는 Provider 사용/게시 결과를 확인한 후 기존 대사 절차로 처리한다. legacy PUBLISHING에 시도가 없으면 결과 확정 전 예약 상태로 되돌리지 않는다. 실 Provider 중단·외부 게시 확정은 자격 증명 없이 검증하지 않았다.

최종 1단계 검증: 강제 종료/경쟁/이전 token 완료 차단 2건, 기존 worker 게시·재전달 7건, 정책 1건, API 게시 6건 통과(총 16건). worker/API/database lint·typecheck 성공. 빈 DB migration 및 데이터가 있는 복제 DB의 추가 migration 적용과 작업 상태 보존 확인. 실제 강제 종료는 tsx worker 프로세스를 SIGKILL한 후 heartbeat 시각을 테스트에서 앞당겨 검증했다.

## 2단계: 지표 수집·게시 버전

- 확인: API 응답만으로 SUCCEEDED 처리했고 snapshot이 하나라도 있으면 해당 post 전체를 건너뛰어 부분 누락을 다시 수집하지 않았다. observedAt에도 요청 periodEnd를 넣었고 누적값을 요청 기간 값으로 표시했다.
- 수정: COLLECTING 원자 claim, WAITING/PARTIAL/SUCCEEDED/UNAVAILABLE/EXPIRED 구분. 다음 수집은 Provider delay와 지수 backoff 중 큰 값(최대 backoff 24시간), 최대 6회다. 최신 metric revision으로 완료 여부를 판단하며 이전 결과는 보존한다. 페이지 단위 DB 트랜잭션으로 실제 501개 batch 회귀의 성능을 유지한다. 빈 page와 NOT_RETURNED는 일시적, NOT_PROVIDED/별도 보고서/분모 0은 영구 또는 정의 불가로 구분한다.
- 자동 스케줄러는 게시 후 수집뿐 아니라 수동 sync의 지연·부분 실패도 재수집한다. production job은 수집 시도별 새 키를 사용하고 게시 작업을 변경하지 않는다. worker 유실 시 COLLECTING도 복구한다.
- migration `202611170002_analytics_observations`: collectionAttempts/nextAttemptAt와 관측 종류, 실제 collectedAt, 표현 기간, 게시 scene/script ID를 추가한다. 이전 snapshot은 LEGACY_UNKNOWN이며 기간/버전을 추정 backfill하지 않는다. 이전 row의 collectedAt 기본값은 migration 시각이므로 정확한 과거 수집 시각으로 사용하면 안 된다. 원본 지표·revision은 유지한다. 컬럼 삭제 rollback은 신규 관측 메타데이터를 잃는다.
- 실제 Provider: YouTube는 Pacific calendar 기간 보고서이며 날짜 양 끝을 포함하는 요청을 UTC 경계(종료 exclusive)로 변환한다. 집계 가능성을 고려해 보수적 72시간을 사용한다. Instagram/TikTok은 현재 누적 스냅샷으로 표시하고 요청한 과거 24시간 값이라고 하지 않는다. actualAgeSeconds를 원본 메타데이터에 별도 보존한다. 관측 정의/기간이 없는 legacy는 비교 근거에서 제외할 대상이다.
- 기존 SUCCEEDED 재검사: 기존 analytics sync 요청에 `recheck: true`를 명시한다. 해당 workspace 권한 검증 후 같은 sync에 한 번의 durable recheck를 만들고 원본을 보존하며 새 revision을 저장한다. 추가적인 새 관측 요청은 새 idempotencyKey를 사용한다. 같은 복구 요청의 반복은 중복 수집을 만들지 않는다.
- API 보고서는 실제 관측 기간과 collectedAt, 관측 종류, 게시 버전 ID를 반환한다. UI는 누적값과 기간 미확인을 구분한다.
- 공식 문서 확인일 2026-11-17: [YouTube dimensions](https://developers.google.com/youtube/analytics/dimensions), [YouTube reports.query](https://developers.google.com/youtube/analytics/reference/reports/query), [TikTok Query Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query). Meta 공식 media insights 문서는 접근 실패했으며 누적 지표의 실제 권한/응답과 변경 정책은 실 계정으로 별도 확인해야 한다. 실 요청은 하지 않았다.
- 검증: worker 수집 5건(501개 부분 실패 포함), 복구 2건, API 수집/동시 recheck 1건, Provider 3건, web 10건 통과. 변경 worker/API/web/providers/contracts/database lint·typecheck 성공. 기존 데이터 DB migration 적용 성공. 최초 501개 테스트는 개별 트랜잭션으로 제한시간을 초과하여 batch 저장으로 수정 후 통과했다. Redis 미지정으로 발생한 재검증 연결 실패도 격리 URL을 명시한 후 통과했다.

## 3단계: 주장별 근거·생성 비용

- 확인: 정책과 소유자 검수의 두 경로 모두 sourceUrl의 존재만으로 factsHaveSources를 설정했다. 새 검증은 공통 policy-engine을 사용한다.
- 자동 통과 조건: 수집 범위 FULL_TEXT, 실제 수집 문자열에서 찾은 근거, 주장·숫자·단위·날짜 일치, 대본의 새 진술까지 근거 연결, 출처 충돌 없음. 지원 근거/정규화 위치/수집 범위/대본 fingerprint/검토 사유를 policy 결과와 ScriptVersion에 보존한다. 대소문자가 다른 SI 단위(mW/MW)를 합치지 않는다. URL만 일치, RSS SUMMARY, 원문 미수집, 추론·가정, 수치 충돌은 검토 대상이다. 이는 원문 충실성 검사이며 독립적인 현실 사실 확인이나 인과 검증이 아니다. 별도의 LLM 검증 호출과 추가 비용은 도입하지 않았다.
- 수동 확인: 기존 소유자 대본 편집·출처 확인은 유지하며 현재 hook/body/CTA의 fingerprint에만 유효하다. 새 문장을 추가하면 기존 확인을 재사용하지 않는다. 이전 legacy 확인에는 fingerprint가 없으므로 재확인이 필요하다. RSS Provider는 원문을 내려받았다고 가장하지 않고 SUMMARY를 기록한다. 정상 원문 fixture는 실제 일치하는 본문과 FULL_TEXT를 명시한다.
- 비용: `LLM_MAX_OUTPUT_TOKENS` 기본 4096(256~32768), Responses 요청에 max_output_tokens를 전달한다. 실제 입력 UTF-8 바이트와 실제 출력 JSON schema·여유분으로 보수적 토큰 예약을 계산하고 최대 스키마 재생성 횟수를 포함한다. 매 유료 호출 journal STARTED 전에 같은 플랫폼의 미해제·미정산 예약 잔액과 이전 실제 토큰 기반 추정 비용을 확인한다. 다른 job의 미확정 STARTED가 있으면 호출하지 않는다. 복구된 응답은 비용을 중복 기록하지 않는다.
- 비용 의미: 입력 바이트 기반 값은 사전 예약 추정, API usage×설정 단가는 사용량 기반 추정, actualCost는 별도 대사된 금액이다. 절대 외부 청구 상한을 보장하지 않는다. 성공/실패에도 사용량 기반 추정만 있고 청구 대사가 없거나 외부 결과가 불명확하면 예약을 유지한다. 운영자는 기존 usage/ledger 대사 절차에서 실제 비용을 확인해야 한다. 단순 실패를 환불로 간주하지 않는다.
- DB 구조 추가 없음: 기존 JSON snapshot의 증거 메타데이터를 확장했다. 이전 원문/확인을 추정 backfill하지 않는다. 롤백하면 기존 코드의 약한 URL 판정이 다시 가능하므로 자동 운영을 재개하기 전에 주의가 필요하다.
- 공식 [Responses API max_output_tokens](https://developers.openai.com/api/reference/resources/responses/methods/create) 확인일 2026-11-17. OpenAI Docs 스킬 사용. 네트워크는 Mock이며 실제 유료 호출 없음.
- 검증: 관련 worker 17건, API 15건(동시 예산 예약 포함), policy-engine 9건, OpenAI Mock 5건, config 10건 통과. 긴 원문/최대 출력 예약, 스키마 오류 뒤 예약 축소 시 재호출 차단, 발생 비용 보존, 오래된 수동 확인 무효화를 포함한다. 변경 app/package lint·typecheck 성공. 기존 media fixture의 비정상 reservation key/누락 플랫폼은 실제 운영 계약에 맞게 수정하고 기존 불명확 호출 차단 테스트를 재검증했다.

## 4단계: 후보·스톡 선정

- 부분적으로 이미 해결: 저장된 후보에도 제외어·출처 필터를 적용했다. 확인: 과거 저장 점수 순서대로 선택했고 최신성은 감점만 했으며 예약 취소 해제와 사건 단위 비교가 없었다. 스톡은 등록 순서 순환 배정이었다.
- `collectionRule.selectionPolicy`: freshness=NEWS(기본)/EVERGREEN, keywordMatch=REQUIRED(기본)/PREFER, semanticDuplicateThreshold=0.65(0.2~1), recentTopicDays=30(1~365). 채널 생성/설정 API에서 지정 가능하다. NEWS는 publication date가 없거나 recencyHours 밖이면 제외하며 historical eventAt과 혼동하지 않는다. EVERGREEN은 발행 나이로 탈락시키지 않는다. 필수 키워드 비일치는 제외, PREFER는 낮은 적합도 점수로 남긴다.
- 선택 DB 트랜잭션 안에서 현재 active CollectionRule과 채널 제외 조건을 다시 읽고 저장 후보 모두를 재평가·재정렬한다. 활성 실행의 예약과 사용 완료 후보는 가져오지 않는다. 실패/취소/완료 실행의 미사용 예약은 불명확 SCRIPT가 없는 경우만 해제한다. 같은 실행의 유효한 예약은 재시도 멱등성을 위해 유지한다.
- 채널 적합도·최신성·출처 신뢰·설명 가치·영상화 적합도·본문량 기반 비용 proxy·최근 주제 중복 점수와 선택 사유를 저장한다. 실제 비용 예측이나 성공 확률로 표시하지 않는다. 비교 가능한 과거 성과가 없으면 null로 남긴다. Jaccard 텍스트 유사도의 임계값과 기간을 조정할 수 있고 공통 함수로 향후 matcher 확장이 가능하다. 다른 URL의 같은 사건을 줄이는 규칙이며 동의어·다국어 의미 전체를 판별하는 모델이라고 주장하지 않는다. 추가 API 호출 비용은 0이다.
- migration `202611170003_selection_policy`: nullable JSON. 기존 null은 위 기본 정책으로 해석하고 오래된 점수를 신뢰하지 않는다. 기존 후보의 evaluation은 다음 선택 시 다시 저장한다. 컬럼 제거 rollback은 사용자 정책을 잃으며 이전 느슨한 선정으로 돌아간다.
- 스톡: 권리·기간·채널 검사를 통과한 후보만 설명/태그와 visualPrompt를 비교한다. 최근 30일 사용 및 같은 영상 내 반복을 감점한다. 기준(0.25) 미달이면 `STOCK_MATCH_REQUIRED`와 장면 ID/메타데이터 부족 여부로 보류하며 무관한 이미지를 강제 배정하지 않는다. 모든 스톡 장면의 매칭을 유료 이미지 생성 전에 확인한다.
- 기존 자산 메타데이터 보완: 소유자가 업로드 화면에서 이미지 설명을 입력해 같은 파일을 다시 등록하거나 `PATCH /channels/:channelId/stock-assets/:assetId/metadata`에 `{description,tags}`를 보낸다. 기존 권리 증빙은 덮어쓰지 않는다. metadata PATCH 후 기존 보류 실행을 재시도한다. 재등록은 기존 보류 재개 흐름을 사용한다. AssetSource JSON 이력을 사용하므로 자산 테이블 migration은 없다.
- 검증: worker 선정/소재 3건, API 아이디어/스톡 권한/채널/자동화 23건, topic scoring 3건, asset-library 7건, web 10건(총 46건) 통과. 변경 app/package lint·typecheck 통과. 기존 데이터 DB에 selectionPolicy migration 성공. 테스트는 과거 점수 역전, 현재 rule 재조회, 유효한 다른 실행 예약 유지, 취소 예약 해제, 다른 기사 제목의 사건 중복, 메타데이터 없음/무관함에서 유료 작업 0건, 보완 후 재시도와 권리·채널 격리를 확인한다.

## 5단계: 장면 템플릿·기술 품질

- 확인: 제목이 전체 영상에 고정되고 첫 30프레임 fade-in, 첫 overlay만 표시, 제목/overlay의 overflow hidden, 자막 길이 단순 거부가 있었다.
- schema 1.0.0을 유지하며 선택적 role/visualMode/platform을 추가했다. Hook/두 대상 비교/번호 있는 과정/동일 단위 수치 막대/결론·CTA의 역할을 분리한다. Hook은 frame 0부터 제목을 표시하고 2.5초 뒤 제거한다. 지원하는 모든 overlay를 렌더하며 알 수 없는 overlay는 schema 오류다. overlay 최대 500자로 입력을 보존하고 수용 불가 길이는 검토로 보낸다. Fake 생성의 title.slice도 제거했다.
- CJK/Latin 폭 기반 폰트 조정·줄바꿈, 플랫폼별 보수적 안전 영역, TTS 전체 문자와 구간을 보존하는 긴 자막 분할을 사용한다. 실제 브라우저 bounds와 겹침을 추가 검사한다. Remotion metadata 단계의 zero-size offscreen tree는 실제 프레임 검사가 아니므로 제외한다. 유효 프레임에서는 텍스트를 자르지 않는다.
- missing image, 텍스트 넘침·총 배치 밀도, 자막 밀도/타이밍, 긴 정적 GRAPHIC 구간, 잘못된 비교 구조/수치 단위는 기술 QA 사유다. worker는 NEEDS_REVIEW로 보내고 이전 manifest와 오디오 길이를 덮어쓰지 않는다. renderer version 1.2와 technicalQuality를 manifest에 저장한다. 기술 QA를 조회수 예측으로 표시하지 않는다.
- 검증: renderer 7건, scene-schema 14건, worker 렌더/생성/journal 9건, Provider 5건 통과. 변경 renderer/worker/providers/scene-schema lint·typecheck 성공. 실제 Chromium 대표 프레임 9개를 직접 시각 확인했고 첫 frame, 전환, 20:100 동일 단위 막대 비율, CTA, 긴 한국어·영어 제목/자막 및 제목이 사라진 6초 프레임을 확인했다.
- 실제 2초 smoke 결과: 1080×1920, 출력 2.09초, audio 있음, 평균 -21.3 dB, black-frame 비율 0. 증거 `.artifacts/templates-2026-11-17/result.json`, PNG 9개, `templates-smoke.mp4`. Windows Remotion 내장 FFmpeg에는 volumedetect/blackdetect가 없어 해당 검사만 기존 renderer image의 full FFmpeg로 실행했다. 최종 `template-smoke.mjs` 전체 실행은 `TEMPLATE_SMOKE_QA_IMAGE=postbot-internal-renderer:20261020`으로 통과했고 기존 frame 재사용은 false다. 환경이 full FFmpeg이면 이 변수 없이 실행한다. 대표 frame만 재검사할 때 이미 검증된 출력은 `TEMPLATE_SMOKE_RESUME=1`로 재사용할 수 있다.
- DB migration 없음. 기존 JSON은 읽을 수 있고 기존 성공 manifest는 유지한다. 이미지 제작 문서에 이미지가 없으면 명시적인 GRAPHIC 전환이나 소재 준비가 필요하다. 문서의 sidechain ducking 표현과 실제 볼륨+amix 구현의 불일치를 발견해 실제 동작에 맞게 정정했다.

## 6단계: 게시 특성·성과 비교·실험 판정

- 확인: 현재 설정/대본을 과거 게시 특성처럼 읽고 서로 다른 관측 기간과 누적 나이를 섞었다. 기존 confidenceScore는 통계적 신뢰수준이 아닌 규칙 점수였다.
- 렌더 시 실제 측정 길이, script/scene ID, Hook 종류, 역할 템플릿, 전환 빈도, 자막 밀도/설정, 실제 TTS voice/model/provider를 manifest에 기록하고 게시 성공 트랜잭션에서 productionSnapshot으로 고정한다. 이후 편집과 채널 설정 변경은 과거 표본에 반영하지 않는다. 이전 게시물의 알 수 없는 특성은 추정하지 않는다.
- 비교 키는 플랫폼·지표·mapping·단위·집계 정의 및 실제 기간 경계 또는 실제 수집 당시 게시 나이(시간 단위, ±300초)다. 요청한 24시간과 실제 96시간 누적값을 같은 군으로 취급하지 않는다. 게시 버전과 지표 버전이 불일치하거나 legacy/미완료이면 제외한다. 가장 큰 관측군을 값과 무관하게 선택하고 제외 표본 수를 공개한다.
- 길이 제안은 최소 4개 동질 표본, 지표 변동과 실제 길이 차이가 있어야 한다. Hook/템플릿/전환/자막/음성별 기술적 비교도 저장하되 각 그룹 표본이 부족하면 보류한다. 인과관계나 조회수 보장을 주장하지 않는다. confidenceScore는 null이며 UI도 미산정으로 표시한다.
- 실험 목표와 허용 오차(기본 1초)는 제작 배정에 고정한다. TTS 반영 후와 최종 파일 측정 길이가 어긋나면 NEEDS_REVIEW로 보내며 음성을 자르거나 빠르게 하지 않는다. 실제 게시 특성의 목표 준수, 배정/게시 시각과 플랫폼, 관측군 일치, 표본 포함률 80%를 확인한다. 사전 기간 종료 또는 배정 상한 도달 전에 최종 판정을 허용하지 않는다.
- 평균·표준편차·중앙값·IQR 이상치·표본 균형과 평균차의 기술적 2-standard-error 범위를 제공한다. 작은 표본, 2:1 초과 불균형, 이상치, 큰 변동성, 0 대조군 기준값은 판정을 유보한다. 보정된 통계적 신뢰수준이나 인과 추론으로 표시하지 않는다.
- migration `202611170004_publication_features`: nullable JSON 추가, 기존 v1 confidenceScore를 evidence.legacyRuleScore에 보관하고 null 처리한다. 과거 게시 특성은 null로 유지한다. 이전 제안은 새 근거로 재생성해야 한다. rollback 전에 신규 스냅샷을 백업하고 컬럼을 제거해야 하며 점수 복원은 통계 신뢰도 복원이 아니다. 자동 down migration은 제공하지 않는다.

## 최종 경계 감사

- 이전 실행자의 늦은 완료는 유료 호출 시작·대본/자산 연결·분석 claim·게시 상태 저장 전에 소유권을 검사한다. 이미 발생한 유료 사용량과 외부 게시 영수증은 보존하여 비용/게시 대사에서 유실하지 않는다. 새 실행의 게시 상태를 이전 실행의 실패로 되돌리지 않는다.
- 렌더 파일 키에 실행 token을 포함하여 DB 저장 차단뿐 아니라 이전 실행의 늦은 업로드가 새 바이트를 덮어쓰는 문제도 막았다. 실제 MySQL에서 두 실행을 교차시켜 manifest와 파일 바이트 보존을 확인한다.
- 수집 본문이 10,000자에서 잘리면 FULL_TEXT 대신 SUMMARY로 저장하여 전체 원문을 검증했다는 잘못된 판정을 막는다.
- 추가 API 환경 계약: 실험 생성의 durationToleranceSeconds(0.1~3), 선택 정책 및 스톡 메타데이터 API는 위 단계 설명을 따른다. 운영 복구는 기존 recover:queues와 자동 스캔을 사용한다. 불명확 외부 결과는 먼저 Provider/플랫폼의 operation ID 및 비용 영수증을 대사한 뒤 수동 재개한다.

## 확인 범위와 남은 제한

| 단계 | 핵심 파일 | 후보 판정 |
| --- | --- | --- |
| 1 | worker/queue-recovery.ts, job-processor.ts, publish-processor.ts, API publishing.service.ts, database/job-execution.ts | 자동 복구·예약/시도 원자성 결함 확인. JobAttempt 시작 원자성은 이미 해결 |
| 2 | worker/analytics-processor.ts, automation-orchestrator.ts, providers/analytics*, API analytics | 부분 누락·지연·관측 종류·버전 결함 확인 |
| 3 | policy-engine/fact-evidence.ts, worker/script-generation-processor.ts, API generation·review, providers/openai* | URL만으로 근거 인정·최대 출력 예약 누락 확인 |
| 4 | providers/topic-scoring.ts, worker/collect-processor.ts, asset-preparation-processor.ts, asset-library/stock-matching.ts | 과거 점수·약한 최신성·스톡 순환 배정 확인. 일부 현재 필터·권리 검사는 이미 존재 |
| 5 | renderer/sample-composition.tsx, text-layout.ts, technical-quality.ts, scene-schema, worker/render-processor.ts | 고정 제목·fade-in·오버레이 누락·긴 텍스트 처리 결함 확인 |
| 6 | optimization/comparability.ts, API optimization.service.ts, worker/render-processor.ts·publish-processor.ts | 혼합 관측·현재 설정 소급·규칙 점수 오표시·최종 길이 누락 확인 |

최신 코드에서 전혀 성립하지 않는다고 결론낸 후보는 없다. 일부 이미 해결된 하위 경로와 실제 남은 결함을 구분한 결과다. 위 파일명은 각 app/package의 src 기준이며 migration은 단계 설명에 별도로 기록했다.

보고된 복구·예약 원자성/부분 지표 재수집/URL만 이용한 근거 판정/오래된 후보 점수/무관한 스톡 순환 배정/텍스트 잘림/혼합 관측 비교 문제는 현재 코드에서 확인하여 수정했다. 기존 중복 작업 ID, 권리·채널 격리, 사용량 journal과 부분적인 현재 후보 필터는 이미 존재하여 유지·강화했다. 독립적 진실 검증, 의미 모델 전체, 통계적 인과 추론과 실제 성과 개선 보장은 미구현 범위이며 성공으로 기록하지 않는다.

실제 Provider 과금·SNS 권한/지표 응답·외부 게시 결과와 운영 규모 부하 검증은 외부 확인이 필요하다. 요청에 따라 유료 호출·실제 게시·운영 DB 변경·배포·push·merge를 수행하지 않았다. 모든 DB/Redis 장애 검증은 별도 포트의 테스트 전용 컨테이너에서 수행했다.

## 최종 검증 결과

- 6단계 분석 unit 7건, API 분석/실험 6건, worker 렌더/게시/실제 호출 journal/부분 수집 21건, 복구/게시 7건, 대본/미디어 journal 6건, 자산 DB 3건 통과(중복 실행은 합산하지 않는다). DB 회귀는 실제 격리 MySQL/Redis, 외부 Provider는 Fake/Mock이다.
- 전체 lint와 typecheck/build 대상을 검사했다. lint의 미사용 import 1건을 제거하고 해당 API lint를 재실행했다. 전체 typecheck 27개 task와 build 15개 task 성공. 최종 자산 변경의 lint/typecheck 및 API fixture 수정의 lint/typecheck를 추가 확인하여 성공했다.
- 전체 test는 첫 실행에서 기본 DB 주소가 적용되어 database suite 연결에 실패했다. 격리 DB URL을 명시한 재실행은 database 8건을 포함해 성공했으나 API HTTP fixture 1건이 새 NEWS 정책에서 발행일 null로 거절됐다. fixture에 현재 발행일을 명시하고 실패한 HTTP 테스트를 재실행하여 통과했다. 나머지 코드는 바꾸지 않았다. 최종 합계 190건 통과이며 99건의 opt-in integration은 전체 실행에서 skip이다. 관련 필수 integration은 위 단계별 명시 환경에서 별도로 실행했다. 전체 명령의 실패 이력은 숨기지 않으며 최종 판정은 성공한 전체 대상 검사와 수정 대상 재검증을 합친 결과다.
- 빈 `postbot_blank_test`에서 19개 migration 적용 성공. 기존 데이터 복제 `postbot_upgrade_test`에서도 적용 성공: v1 confidenceScore 0.73은 null, evidence.legacyRuleScore=0.730000; 기존 게시 1건은 보존되고 productionSnapshot은 null이다. 초기 검증 SQL의 존재하지 않는 updatedAt 컬럼 오류를 고쳐 다시 수행했다.
- 병행 검사 중 API DB 테스트 기본 5초 timeout이 발생하여 30초 한도로 재실행했고 실제 검증이 통과했다. 실행 증거는 `.artifacts/stage6-*.log`, `.artifacts/final-*.log`, `.artifacts/migrate-*-final.log`에 보존한다. 렌더 증거는 5단계와 같다.
- 유료 결과는 자산 연결 소유권 확인/파일 저장보다 먼저 비용 영수증을 남겨 늦은 응답의 비용을 유실하지 않는다. Turbo dev/test 실행에도 새 출력 제한과 LLM 요율 환경 변수가 전달되도록 LLM_*를 허용한다.
- 기존 web 번들 500kB 경고와 Node 20에 대한 AWS SDK 향후 지원 종료 안내가 남는다. 이번 변경의 실패가 아니며 운영 런타임 업그레이드와 번들 분리는 별도 범위다.
