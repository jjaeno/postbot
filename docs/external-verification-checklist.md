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

- 계정/권한: Meta app, 연결된 Instagram professional account와 Facebook Page
- 환경 변수: `INSTAGRAM_OAUTH_PROVIDER=meta`, `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_GRAPH_VERSION`, `INSTAGRAM_ANALYTICS_PROVIDER=instagram`
- redirect URI: `${API_BASE_URL}/platform-accounts/instagram/callback`
- 앱 심사: Instagram basic/profile 및 content publishing/insights 관련 권한 검토 필요
- smoke: connect→Reels container 생성→상태 polling→publish→insights→disconnect 순서로 수행한다.
- 성공 기준: scope/profile 일치, container 완료 후 단일 게시, ambiguous retry 시 재게시 없음

## TikTok

- 계정/권한: TikTok developer app와 Direct Post 승인 계정
- 환경 변수: `TIKTOK_OAUTH_PROVIDER=tiktok`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ANALYTICS_PROVIDER=tiktok`
- redirect URI: `${API_BASE_URL}/platform-accounts/tiktok/callback`
- 앱 심사: Login Kit/Content Posting 및 `video.publish` 승인 필요
- smoke: connect→Direct Post init/upload→status polling→analytics→refresh/disconnect 순서로 수행한다.
- 성공 기준: scope 검증, 단일 PlatformPost, 처리 상태 수렴, 만료 token refresh, 중복 게시 없음

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
