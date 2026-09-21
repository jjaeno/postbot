# Postbot 대본과 Scene JSON 생성

8.5단계 생성 파이프라인은 `ContentIdea`를 입력으로 받아 `ContentItem`, `SourceReference`, `ScriptVersion`, `SceneVersion`을 만든다. 이미지, TTS, 실제 렌더링은 9~10단계에서 구현되었다.

## Provider

LLM 호출은 `LlmProvider` 인터페이스 뒤에 둔다.

- `FakeLlmProvider`: deterministic 테스트와 로컬 개발용
- `OpenAiLlmProvider`: Structured Output을 사용해 실제 OpenAI API를 호출한다. 유효한 `OPENAI_API_KEY`가 없는 이 환경에서는 통합 검증을 실행하지 않았다.

모델명은 `LLM_MODEL` 환경 변수로 주입한다. 기본값은 `gpt-5-mini`이며 도메인 코드에 모델명을 고정하지 않는다.

`LLM_PROVIDER=openai`를 선택하면 `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`로 실제 Provider를 설정한다. Provider는 Responses API의 JSON Schema Structured Output을 요청하고, 응답은 저장 전에 기존 Zod/SceneDocument 검증을 통과해야 한다. API 키는 로그 또는 DB snapshot에 저장하지 않는다.

## API

- `POST /generation/script-scene`

요청:

- `ideaId`
- `platform`
- `idempotencyKey`
- `partial`: `full`, `hook`, `body`, `metadata`, `scene`

The endpoint validates CSRF and workspace-scoped idea ownership, then returns a `SCRIPT` `ProductionJob` immediately. The worker executes the Provider request, validation, version persistence, usage, and cost-ledger write. Job state is available at `GET /jobs/:jobId` and `GET /jobs/:jobId/events`.

Partial regeneration preserves the latest version's unselected script, metadata, facts, and SceneDocument fields. First-time partial generation uses the provider result as a complete initial version.

The worker records retry attempts through `ProductionJob`/`JobAttempt`. A cancellation requested while a job is running is checked before generation persistence; it ends as `CANCELLED` without creating ProviderUsage, CostLedger, or generated versions.

## Verification status

The Fake Provider integration path is verified against local MySQL and Redis: `SCRIPT` work is enqueued through BullMQ, completed by the worker, and persists one script/scene version, ProviderUsage, and CostLedger record. The cancellation path is also verified without creating generation records.

Real OpenAI Provider verification is pending because this environment does not have `OPENAI_API_KEY`. To run it, set `LLM_PROVIDER=openai`, a valid `OPENAI_API_KEY`, and optionally `OPENAI_BASE_URL`, `LLM_TIMEOUT_MS`, and `LLM_MAX_RETRIES`; do not add the key to a tracked `.env` file.

중복 요청은 `ProviderUsage.idempotencyKey`로 감지하고 기존 결과 snapshot을 반환한다.

## Structured Output

LLM output은 저장 전에 Zod schema로 검증한다.

- planning: title, summary, metadata
- script: hook, body, callToAction, language, durationSeconds
- facts: claim과 sourceUrl
- sceneDocument: `packages/scene-schema`의 `SceneDocumentSchema`

사실과 scene narration은 제공된 source URL을 반드시 참조해야 한다. 누락된 출처, 잘못된 JSON 구조, 길이 초과 output은 저장하지 않는다.

## 저장

성공 시 다음 데이터를 저장한다.

- `ContentItem`: 아이디어 기반 콘텐츠 항목
- `SourceReference`: 원본 소재 URL과 fact snapshot
- `ScriptVersion`: hook/body/CTA, prompt version, quality snapshot
- `SceneVersion`: versioned SceneDocument
- `ProviderUsage`: prompt/model/token/idempotency/result snapshot
- `CostLedger`: LLM 예상 비용

아이디어는 `USED`로 전이하고 콘텐츠는 `REVIEW_REQUIRED`로 전이한다.
