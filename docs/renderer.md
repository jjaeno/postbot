# Renderer

`RENDER` 작업은 versioned `SceneDocument`를 Remotion composition으로 렌더하고 FFmpeg로 후처리한다. 입력은 항상 1080x1920이며, safe area와 TTS word/sentence timing은 frame 단위 caption으로 변환된다.

각 작업은 OS 임시 폴더 아래에 독립 디렉터리를 사용한다. 완료 또는 실패 후 디렉터리는 삭제된다. 최종 MP4와 JPEG thumbnail은 Storage Provider에 업로드되고, `SceneVersion.renderManifest`에 schema/renderer version, storage key, caption 수, ffprobe QA 결과를 저장한다. 같은 idempotency key로 다시 실행하면 기존 manifest를 반환한다.

`tts-narration` AssetUsage의 timing은 caption에 사용한다. `bgm`/`sfx` AssetUsage가 있으면 FFmpeg가 narration을 sidechain ducking한 뒤 mix한다. 렌더 timeout은 `RENDER_TIMEOUT_MS`(기본 15분)이며, BullMQ의 기존 retry/cancel 상태 전이를 그대로 사용한다.

QA는 1080x1920, duration 오차, audio stream, 무음/손상 audio, black-frame 비율, caption safe-area, ffprobe/FFmpeg 오류를 검사한다. 실패와 성공 모두 임시 디렉터리를 정리한다. `apps/renderer/scripts/smoke.mjs`는 15초와 60초 fixture를 렌더하고 ffprobe 결과를 검증한다.

Production worker/renderer image에는 고정 Remotion 버전의 Chrome Headless Shell을 build 시점에 내려받아 포함한다. 따라서 런타임 네트워크에 의존해 브라우저를 설치하지 않는다. image에는 `ffmpeg`와 `ffprobe` 및 Chromium shared libraries가 있고 non-root `node` 사용자로 실행된다.
