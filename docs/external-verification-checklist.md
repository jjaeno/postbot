# 외부 검증 체크리스트

내부 Fake/contract 검증과 실제 provider 검증을 분리한다. 아래 값은 secret store에서만 주입하고 저장소·로그·issue에 기록하지 않는다. 모든 OAuth callback은 `${API_BASE_URL}/platform-accounts/<platform>/callback` 형식이다.

## OpenAI

- 계정/권한: 사용 가능한 API project와 결제 한도
- 환경 변수: `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`
- 앱 심사/redirect: 없음
- smoke: staging 채널에서 `/generation/script-scene`을 1회 실행하고 job, ScriptVersion, SceneVersion, ProviderUsage, CostLedger를 확인한다.
- 성공 기준: schema-valid script/scene, 단일 비용 기록, secret 비노출, timeout/retry 정상

## Google Image

- 계정/권한: 선택 모델을 사용할 수 있는 Google AI project/API key
- 환경 변수: `IMAGE_PROVIDER=google`, `GOOGLE_API_KEY`, `IMAGE_MODEL`, `IMAGE_TIMEOUT_MS`
- 앱 심사/redirect: 없음
- smoke: ASSET job 1회를 실행해 이미지 object, license metadata, usage와 cost를 확인한다.
- 성공 기준: 유효 이미지 저장, rights gate 입력 존재, 멱등 재요청에서 중복 비용 없음

## ElevenLabs

- 계정/권한: API key, 상업 사용 가능한 voice
- 환경 변수: `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `TTS_MODEL`, `TTS_TIMEOUT_MS`
- 앱 심사/redirect: 없음
- smoke: TTS job 후 오디오와 character/word alignment를 확인하고 renderer를 실행한다.
- 성공 기준: 재생 가능한 오디오, 실제 timestamp 기반 caption, renderer audio QA 통과

## YouTube

- 계정/권한: Google Cloud OAuth client, YouTube Data/Analytics API, 업로드 가능한 채널
- 환경 변수: `YOUTUBE_OAUTH_PROVIDER=google`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_UPLOAD_PRIVACY`, `YOUTUBE_ANALYTICS_PROVIDER=youtube`
- redirect URI: `${API_BASE_URL}/platform-accounts/youtube/callback`
- 앱 심사: 공개 운영과 민감 scope 사용 시 Google OAuth 검증 필요
- smoke: connect→callback→비공개 업로드→status→analytics backfill→disconnect 순서로 수행한다.
- 성공 기준: 필수 scope 검증, 단일 PlatformPost, 실제 URL/status, token refresh, analytics snapshot

## Instagram

- 계정/권한: Meta app의 Instagram Login 설정과 Instagram professional account (이 로그인 방식에 Facebook Page 연결을 전제로 하지 않음)
- 환경 변수: `INSTAGRAM_OAUTH_PROVIDER=meta`, `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_GRAPH_VERSION`, `INSTAGRAM_ANALYTICS_PROVIDER=instagram`
- redirect URI: `${API_BASE_URL}/platform-accounts/instagram/callback`
- 앱 심사: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`의 실제 승인/Advanced Access 검토 필요
- smoke: connect→Reels container 생성→상태 polling→publish→insights→disconnect 순서로 수행한다.
- 성공 기준: scope/profile 일치, container 완료 후 단일 게시, ambiguous retry 시 재게시 없음

## TikTok — 실제 Direct Post 보류

- `ENABLED_PLATFORMS`에서 `tiktok`을 제외한다. 실제 Direct Post는 코드에서 `TIKTOK_DIRECT_POST_HELD`로 거절하며 YouTube 운영은 독립적으로 진행한다.
- `video.list`가 분석 query에 필요하다. user info는 `user.info.basic` 범위인 open_id/union_id/display_name만 요청한다. username이 필요하면 별도 `user.info.profile` 승인과 코드 변경이 필요하다.
- 공식 [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)는 관리 계정의 내부/개인용 업로드 유틸리티를 허용하지 않으며, per-video preview·creator info의 길이/공개범위·기본값 없는 공개범위 선택·댓글/듀엣/스티치·상업 고지·명시적인 전송 동의를 요구한다. 현재 FULL_AUTO 흐름은 이 조건을 충족하지 않는다(확인일 2026-10-13).
- 서버 보관 영상은 도메인 소유권 검증을 거친 PULL_FROM_URL 및 승인된 public-use client 설계가 필요하다. 현재 FILE_UPLOAD 자동 게시 경로는 제거했다.
- publish ID를 post ID로 대체하거나 @postbot 공유 URL을 추측하지 않는다. status API가 post ID를 제공하지 않으면 reconciliation 보류다.
- 현재 대안은 TikTok 출력 프로필로 수동 제작/미리보기/영상 다운로드 후 앱에서 직접 게시하는 것이다. 실제 Direct Post를 재활성화하려면 제품 적합성·개별 동의 UX·앱 심사·도메인 검증·실 contract 회귀를 먼저 완료해야 한다. 코드에 우회 enable 스위치를 두지 않았다.

## Sentry

- 계정/권한: backend project와 DSN
- 환경 변수: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`
- 앱 심사/redirect: 없음
- smoke: staging 전용의 의도된 익명 오류를 1회 발생시키고 correlation ID로 조회한다.
- 성공 기준: event 수신, 환경 구분, cookie/token/password/provider 원문 미포함

## Production deployment

- 계정/권한: image registry, runtime/cluster, managed MySQL/Redis/object storage, secret/KMS, DNS/TLS, alert/on-call
- 환경 변수: `.env.example`의 production 값 전부. secret은 secret manager로 주입한다.
- 배포: commit SHA로 네 이미지를 한 번 build/scan/push하고 동일 digest를 승격한다. `migrate` 성공 뒤 API/worker/renderer/web을 rollout한다.
- smoke: `/health`, `/ready`, worker/renderer health, Fake canary, backup→격리 restore, alert 전달
- 성공 기준: 동일 artifact digest, migration 성공, readiness 통과, rollback/forward-fix rehearsal, 측정된 RPO/RTO와 담당자 기록

## 소량 실제 AI smoke 순서 (현재 BLOCKED / 실행하지 않음)

1. staging secret manager에 실제 모델/voice/API key와 계약 단가를 입력하고 결제 한도·상업 이용 권리를 확인한다. `STAGING_FAKE_CANARY=false`를 사용한다.
2. `pnpm --filter @postbot/worker... build`, `pnpm preflight`, `pnpm preflight -- --network`를 통과시킨다.
3. 기본 dry 명령은 `pnpm smoke:provider -- llm`, `pnpm smoke:provider -- image`, `pnpm smoke:provider -- tts`다. 모두 NOT_RUN이며 실제 호출하지 않는다.
4. 별도 승인 후 위 명령에 `--execute-paid`를 붙여 **하나씩** 수행한다. LLM 1회, 이미지 1개, 한국어 짧은 음성 1개이며 실패 자동 재호출은 없다. TTS decode 검증에는 FFmpeg가 필요하다. 비용은 입력된 단가·실 token 사용량/이미지 1개/실 문자 수를 기준으로 계산한다. LLM token 수는 호출 전 확정할 수 없으므로 사업자 사용 한도를 함께 설정한다.
5. 생성된 `.artifacts/provider-smoke-*` 결과를 검토한다. 이것은 Provider 계약 증거이며 DB 저장/권리 승인/최종 renderer/게시 성공 증거가 아니다. staging APPROVAL 채널에서 API→queue→DB→권리 증빙→렌더→정책 재검사→승인까지 추가 수행한다.
6. YouTube는 별도 게시 승인 후 private 출력으로 영상 1개를 예약하고 실제 채널의 Data API 처리 상태와 URL을 확인한다. 미검증 API 프로젝트의 private 제한, OAuth testing token 만료, 업로드 quota·정책 심사와 Analytics 지연을 Google Console에서 확인한다. 실패/timeout은 기존 attempt와 provider session을 대조하기 전 재예약하지 않는다.
7. Instagram은 granted permissions/refresh/revoke, 현재 선택 Graph 버전의 실제 응답·metric, container→publish→permalink→insights를 test role 계정으로 검증한 뒤 public-use app review를 완료한다. Meta 공식 문서 일부는 비로그인 접근이 제한되므로 운영자 계정으로 최신 계약을 다시 확인한다.

실제 smoke의 비용은 `.env.example`의 placeholder가 아니라 사용자의 계약 단가에 따른다. 검증일 이후 정책/모델/버전/단가 갱신 책임은 운영자이며 변경 계약이 드러나면 Codex가 contract test와 구현을 갱신한다.
