# Postbot 대본과 Scene JSON 생성

8단계 생성 파이프라인은 `ContentIdea`를 입력으로 받아 `ContentItem`, `SourceReference`, `ScriptVersion`, `SceneVersion`을 만든다. 이미지, TTS, 실제 렌더링은 9~10단계 범위다.

## Provider

LLM 호출은 `LlmProvider` 인터페이스 뒤에 둔다.

- `FakeLlmProvider`: deterministic 테스트와 로컬 개발용
- `OpenAiLlmProvider`: 실제 OpenAI 연결 지점. 현재 단계에서는 인터페이스 자리만 제공하고 외부 호출은 수행하지 않는다.

모델명은 `LLM_MODEL` 환경 변수로 주입한다. 기본값은 `gpt-5-mini`이며 도메인 코드에 모델명을 고정하지 않는다.

## API

- `POST /generation/script-scene`

요청:

- `ideaId`
- `platform`
- `idempotencyKey`
- `partial`: `full`, `hook`, `body`, `metadata`, `scene`

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
