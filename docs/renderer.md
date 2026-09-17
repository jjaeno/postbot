# Renderer

`RENDER` 작업은 versioned `SceneDocument`를 Remotion composition으로 렌더하고 FFmpeg로 후처리한다. 입력은 항상 1080x1920이며, safe area와 TTS word/sentence timing은 frame 단위 caption으로 변환된다.

각 작업은 OS 임시 폴더 아래에 독립 디렉터리를 사용한다. 완료 또는 실패 후 디렉터리는 삭제된다. 최종 MP4와 JPEG thumbnail은 Storage Provider에 업로드되고, `SceneVersion.renderManifest`에 schema/renderer version, storage key, caption 수, ffprobe QA 결과를 저장한다. 같은 idempotency key로 다시 실행하면 기존 manifest를 반환한다.

`tts-narration` AssetUsage의 timing은 caption에 사용한다. `bgm`/`sfx` AssetUsage가 있으면 FFmpeg가 narration을 sidechain ducking한 뒤 mix한다. 렌더 timeout은 `RENDER_TIMEOUT_MS`(기본 15분)이며, BullMQ의 기존 retry/cancel 상태 전이를 그대로 사용한다.

운영 환경에는 `ffmpeg`와 `ffprobe` 실행 파일이 PATH에 있어야 한다. 현재 로컬 개발 환경에는 두 실행 파일이 없어 실제 Remotion+FFmpeg smoke render는 실행하지 않았다.
