# 출시 전 기능·UX 정합성 보완

기준일: 2026-10-05  
범위: `implementation-plan.md` 19.1~19.2단계

19.4 직접 UX 보완(2026-10-06)의 현재 결과는 [UX 보완 추적](ux-remediation-2026-10-06.md)을 우선한다. 아래는 이전 단계 기록이다.

## 19.2 최종 명세 점검 보완

19.1 인계 이후 읽기 전용 점검에서 발견한 다음 5개 문제를 보완한다. 아래 19.1 검증 수치는 당시 기록이며 19.2 결과는 최신 acceptance report를 따른다.

| 점검 사항 | 보완 |
| --- | --- |
| 실제 이미지 권리 승인 뒤 ASSET 정지·재생성 | 최신 권리를 확인해 같은 SceneVersion의 저장된 이미지를 재사용하고 보류 step/job을 자동 재개 |
| 한 에셋 증빙 변경이 모든 플랫폼을 무효화 | 현재 버전에서 실제 사용하는 플랫폼만 승인/정책/예약 무효화, 다른 예약/성공 상태 유지 |
| neutral-ko가 ElevenLabs 실제 voice ID로 전송 | 기본 별칭을 ELEVENLABS_VOICE_ID로 매핑, custom ID 유지, 미설정 fail-closed |
| 제한형 실험이 상태 기록만 제공 | 실제 전체 제작 배정·기간/최대 배정 중단·범위/보호 항목 확인·가용 게시 성과 비교·부족 표본 완료 거부 |
| 마법사/브랜드/비율이 요약·설정 저장만 제공 | 마법사 실제 연결·샘플 제작/미리보기/정책 승인, sample 게시 차단, renderer 직접 스타일/로고 반영, 검증 스톡 업로드와 실제 혼합 선택 |

## 문제별 처리 결과

| 문제 | 원인 | 처리 | 상태 |
| --- | --- | --- | --- |
| 자동화 비용이 없어 scheduler가 보류됨 | API가 요청 본문의 `estimatedCostsUsd`를 신뢰했고 scheduler는 값을 보내지 않음 | Provider·모델·예상/실제 작업량 기반 서버 비용 추정기와 예산 조회 UI 추가. 실 Provider 단가 미설정은 `COST_PRICING_REQUIRED`로 보류 | 내부 완료, 실제 청구 대사 외부 검증 대기 |
| 채널 설정이 생성물에 반영되지 않음 | generation job이 채널 template/profile/strategy를 읽지 않음 | 언어, 대상, 톤, hook, CTA, 길이, caption, 최신 적용 전략을 LLM 요청과 quality snapshot에 전달 | 완료 |
| 생성 이미지가 영상에 나타나지 않음 | ASSET은 단일 이미지였고 renderer props에 이미지가 없었음 | 장면별 `visualPrompt`로 이미지를 만들고 SceneVersion 사용 관계를 저장한 뒤 Remotion 배경으로 합성 | 완료 |
| 아이디어에서 제작을 시작할 수 없음 | UI가 script job만 호출하거나 내부 content ID 입력을 요구함 | 아이디어 카드에 플랫폼 선택과 ‘영상 만들기’를 추가하고 동일 자동화 pipeline을 `ideaId`로 시작 | 완료 |
| 여러 플랫폼 예약이 서로 오염됨 | 최신 scene/policy를 플랫폼과 무관하게 선택하고 전체 콘텐츠 상태로 승인 판단 | 플랫폼별 최신 script의 reviewStatus와 scene/policy를 검사하며 다른 플랫폼의 예약·보류·성공과 독립 처리 | 완료 |
| 편집한 제목/설명이 게시 계획에 반영되지 않음 | PublishPlan이 ContentItem 원본 메타데이터 사용 | 선택 플랫폼 최신 ScriptVersion의 review metadata를 snapshot으로 저장 | 완료 |
| 오래된 정책 검사로 승인/게시 가능 | 정책 check와 최신 script/scene 시간 비교가 없음 | 승인·자동/수동 예약 모두 최신 버전보다 새로운 PASS check와 render manifest 요구 | 완료 |
| 승인 후 자동화가 숨은 재시작 API를 요구함 | `AWAITING_APPROVAL` branch를 UI 승인과 연결하지 않음 | 승인 플랫폼의 보류된 PUBLISH step을 PENDING으로 바꾸고 run을 QUEUED로 재개 | 완료 |
| 같은 계정·시각 중복 예약 | 수동 예약 충돌 조회가 없음 | `SCHEDULED`/`PUBLISHING` plan 충돌을 `PUBLISH_SLOT_OCCUPIED`로 거부 | 완료 |
| 예산·캘린더·분석 채널을 UI에서 제어하기 어려움 | API 일부만 존재하거나 첫 채널로 고정 | workspace/channel 예산 편집, 실제 PublishPlan 캘린더, 분석/최적화 채널 선택 추가 | 완료 |
| `datetime-local`이 UTC로 잘못 표시됨 | ISO UTC 문자열을 그대로 잘라 input에 사용 | 기기 로컬 시간으로 표시하고 전송 시 UTC ISO로 변환 | 완료 |
| wizard 마지막 화면이 raw JSON이고 입력 중 crash 가능 | form 값을 매 입력마다 완전 schema parse | 제출 시 검증으로 변경하고 마지막 단계를 사용자용 요약 카드로 교체 | 완료 |
| scheduler·수동 시작이 경합해 중복 제작 | script 생성 전에는 콘텐츠 재고가 없어 양쪽에서 별도 run 생성 | 채널 row lock 아래 활성 run을 재사용하고 소재를 명시한 재생성만 별도 실행 허용 | DB 동시성 테스트 PASS |
| 예약 한도·실제 점유 미반영 | 반복 규칙만 보고 첫 미래 시각 선택 | 현지 날짜의 플랫폼별 daily limit과 실제 예약을 검사, 자동 예약은 점유 후보를 건너뛰고 생성 시 다시 잠금 검증 | DB 동시성 테스트 PASS |
| 메타데이터 편집이 권리 증거를 끊음 | 새 scene에 기존 render만 복사 | 메타데이터만 새 script로 저장하고 scene·asset usage는 재사용, 기존 플랫폼 예약 보류 | 완료 |
| 실제 음성 권리 임의 승인 | 모든 TTS 출력을 verified로 저장 | Fake만 verified, 실 출력은 unknown. 소유자가 증빙을 검토·기록하고 재검사/재승인 | unit PASS, 실 권리 검토 외부 대기 |
| OAuth 이후 API JSON에 머묾 | callback에 browser redirect 없음 | HTML browser 요청은 trusted frontend와 원래 채널로 복귀, 실패 안내; JSON client 계약 유지 | controller unit·browser PASS |
| 자동 조회가 검수 입력을 덮어씀 | review 객체 전체가 effect 의존성 | 콘텐츠·플랫폼·version·실제 메타데이터 변경에만 form 초기화 | browser PASS |
| 부분 재생성 영상·대본 불일치 | script만 바꾸거나 새 장면 narration까지 함께 대체 | 선택 범위 merge 후 전체 제작 pipeline, 훅 narration 동기화·장면 재생성의 narration/timing 보존 | worker unit PASS |
| 최적화 적용 불가·되돌리기 미연결 | 생성 suggestion의 maxChangeRatio를 거부, UI 이력 없음 | 허용 duration 전략 적용, 최초 baseline 저장, 이력·rollback UI와 generation context 연결 | 구현·unit 검증, 실 성과 외부 대기 |
| fallback 재사용이 이전 사용 이력을 덮어씀 | 기존 unique purpose 키에 SceneVersion 없음 | 기존 schema 안에서 장면별 hash 키와 originalPurpose snapshot으로 이력을 보존, renderer가 논리 목적 복원 | asset/worker DB PASS |
| 이전 권리 승인으로 fallback 허용 | 과거 VERIFIED 레코드의 존재만 검사 | 같은 채널의 최신 license와 상업/파생 허용·유효 기간 검사 | revoked-license DB PASS |
| 예약 멱등 키의 workspace 격리 누락 | duplicate 응답이 소유권 확인보다 먼저 반환됨 | 소유권을 확인하고 다른 content/account key 재사용을 충돌 처리 | unit·예약 경합 DB PASS |

## 최종 사용자 흐름

1. 사용자가 8단계 wizard에서 채널, 수집, 템플릿, 플랫폼 출력, 게시 시간, 자동화 방식을 설정한다.
2. 아이디어 화면에서 채널과 후보를 고르고 대상 플랫폼을 선택해 ‘영상 만들기’를 누른다.
3. 서버가 동일한 `COLLECT → SCRIPT → ASSET → TTS → RENDER → POLICY → PUBLISH` 자동화 run을 만들며, 기존 아이디어는 COLLECT 결과로 재사용한다.
4. 각 유료 단계 직전에 서버가 비용을 추정해 workspace/channel 예산에 예약한다. 단가 또는 예산이 없으면 작업과 알림에 구체적인 보류 사유가 남는다.
5. 생성기는 채널 설정과 최신 전략을 반영하고, 장면별 이미지·음성·영상은 정확한 플랫폼 SceneVersion에 귀속된다.
6. 승인형 사용자는 콘텐츠 목록에서 제목으로 결과를 열고 플랫폼 탭별 미리보기, 출처, 권리, 정책 결과, 메타데이터를 검수한다. 내부 ID를 입력하지 않는다.
7. 메타데이터 수정 또는 재생성 뒤에는 새 정책 검사가 필요하다. PASS 후 승인하면 해당 플랫폼 자동화 branch가 재개된다.
8. 연결된 플랫폼 계정과 로컬 예약 시각을 선택해 게시 계획을 만든다. 캘린더에서 실제 예약, 진행, 성공 URL, 실패 사유와 반복 규칙을 구분해 본다.
9. 분석과 최적화는 사용자가 고른 채널 기준으로 조회한다.

## 내부 검증 증거

* Provider unit: 채널 생성 context와 비용 계산 경로
* API unit: 비용 추정, 플랫폼별 scene/policy/metadata 선택과 예약
* Worker/renderer unit: SceneVersion별 이미지 목적과 렌더 입력
* Playwright: wizard, OAuth, 새로고침, 검수 승인, 완전 자동 채널, 아이디어→제작, 예산, polling 입력 유지, 잘못된 시간대/modal Escape, OAuth 실패·조회 실패 총 10개 여정
* 실제 Remotion Chromium still: 장면 asset의 색·도형이 1080×1920 프레임 배경에 합성됨 (`pnpm --filter @postbot/renderer smoke:asset`)

Docker Desktop을 복구해 테스트 전용 MySQL·Redis·MinIO를 기동했다. 운영 DB를 초기화하지 않았다. 전체 lint/typecheck/build 42/42가 통과했고 전체 test의 API timeout 한 건은 낮은 동시성 재실행으로 70/70 통과했다. worker DB integration 18/18, asset 5/5, API budget/branching/start race/slot race DB 8/8도 통과했다. 최종 멱등 키 소유권 보완의 관련 검증은 acceptance report에 별도로 기록한다.

FFmpeg/ffprobe가 포함된 production runtime image에서 15초·60초 MP4 smoke를 실행했다. 각각 15.001/60.001초, 1080×1920, audio stream 존재, 평균 음량 -21.1dB, black frame 비율 0, 테스트 이미지 RGB [199,4,205]를 확인했다. Chromium cleanup의 Target closed 경고가 있었지만 두 실행 모두 exit 0과 유효 파일·QA 결과를 반환했다.

실제 HTTP→BullMQ→worker→Remotion→MinIO→Fake 게시 수동 여정은 최종 baked image에서 121.869초, 37.5초 영상 렌더 96.752초로 통과했다. 승인형·완전 자동 3-platform 여정도 각각 567.997/365.709초로 통과했다. 중간 실행에서 scheduler/manual 중복을 발견해 수정했으며, 별도 테스트 DB의 미완료 fixture 실행을 취소했다. 원본 사용자 데이터나 DB는 삭제하지 않았다. 각 실행 환경과 최종 image ID는 acceptance report를 따른다.

승인형·완전 자동형 종단간 실행은 production runtime image에 최신 로컬 compile 결과와 contracts/asset-library dist를 read-only mount한 격리 Compose 환경이다. 이후 최종 소스로 API/worker/acceptance 이미지를 빌드했고 수동 여정은 mount 없이 baked image에서 실행했다. 브라우저 mock 테스트와 실제 DB/queue/render 여정을 동일 증거로 혼동하지 않는다. 모바일 390×844에서도 동일 브라우저 여정 10/10을 확인했다.

## 남은 외부·환경 의존 검증

지원 범위·제한은 `feature-ux-pre-release-addendum.md`를 따른다. 제한형 실험과 브랜드/자막 스타일은 19.2에서 구현했으며 자유 출력 비율/해상도·편집기·외부 스톡 구매 자동화는 제공하지 않는다. 권리 증빙의 진위, 실제 Provider 청구 대사, production capacity와 실제 SNS 권한은 로컬 Fake 테스트로 확정할 수 없다. 전체 로드맵의 100% 완료나 근거 없는 blocker 0을 선언하지 않는다.

실제 유료 호출, SNS 게시, production 배포는 이번 작업에서 수행하지 않았다. 자격 증명을 비밀 저장소에 넣은 staging에서 다음 순서로 smoke한다.

1. OpenAI: 짧은 source fixture로 script/scene 1건 생성, token usage와 estimated/actual 청구 대사를 확인한다.
2. Google Image: 장면 1개 생성, bytes/MIME/storage/license snapshot과 configured unit price ledger를 확인한다.
3. ElevenLabs: 짧은 문장 1건 합성, playable audio, timing, 문자 수 기반 estimate와 청구 대사를 확인한다.
4. Renderer: FFmpeg/ffprobe가 포함된 production image에서 15초·60초 MP4, 장면 이미지, TTS audio, caption safe area, duration/resolution/black-frame 검사를 실행한다.
5. YouTube/Instagram/TikTok: 각 sandbox 또는 검증 계정으로 OAuth scope를 확인하고 비공개/테스트 게시 1건, 상태 polling, URL, analytics sync, 삭제/정리까지 확인한다.
6. Budget: 실제 단가 환경 변수와 낮은 hard limit을 적용해 허용 1건과 차단 1건을 확인한다.
7. Production: registry digest 고정, migration, readiness, secret/KMS, callback URL, backup/restore, rollback/forward-fix rehearsal을 완료한다.

상세 자격 증명과 플랫폼 조건은 `external-verification-checklist.md`를 따른다. 키, 토큰, 계정 식별자는 결과 문서나 로그에 기록하지 않는다.
