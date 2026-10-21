# Renderer

## 19.8 음성 타이밍

실제 ffprobe 음성 길이와 TTS 단어 정렬로 장면 경계를 확정하며 전체 대본과 narration 텍스트를 맞춘다. 최대 길이 초과/텍스트 불일치/겹친 자막/빈 장면 구간/중복 ID는 오류로 멈추고 문장을 자르지 않는다. Remotion 프레임 동시성의 기본값은 2로 제한한다. 로컬 미디어 검증과 부분 재사용·권리 절차는 [운영 보완 보고서](image-motion-mvp-2026-10-21.md)를 따른다.

## 19.2 브랜드·자막 snapshot

SCRIPT worker는 현재 template의 스타일·AI 비율을 SceneDocument에 기록한다. Remotion은 이 snapshot의 brand/background 색상, Arial/sans-serif/serif, watermark, caption color/background/fontSize(32~64)를 직접 적용한다. logoAssetId는 channel-owned GRAPHIC의 현재 권리를 검사하고 storage bytes를 data URL로 전달하며 SceneVersion usage로 기록한다. 임의 외부 logo URL을 renderer에서 불러오지 않는다. 기존 예약의 style은 설정 변경으로 덮어쓰지 않는다.

`smoke:asset`는 장면 이미지뿐 아니라 녹색 로고, 노란 브랜드 워터마크, serif 글꼴, 노란 자막/파란 배경을 실제 Chromium still에 합성한다. 전체 MP4 QA와 브라우저 API mock은 서로 다른 검증이다.

## Renderer 1.1 scene image contract

`RenderInput.sceneAssets`는 scene ID와 storage에서 내려받은 image data URL의 배열이다. Remotion composition은 해당 scene 시간 구간에 이미지를 `object-fit: cover` 배경으로 표시하고, 가독성 overlay와 caption을 그 위에 합성한다. render manifest에는 사용한 scene asset ID와 목적이 기록된다.

`pnpm --filter @postbot/renderer smoke:asset`는 외부 FFmpeg 없이 실제 Remotion Chromium으로 1080×1920 still을 렌더하고 fixture 이미지가 배경에 나타나는지 확인한다. 전체 MP4/audio/ffprobe 검증은 `smoke`로 수행하며 FFmpeg와 ffprobe 또는 production renderer image가 필요하다.

`RENDER` 작업은 versioned `SceneDocument`를 Remotion composition으로 렌더하고 FFmpeg로 후처리한다. 입력은 항상 1080x1920이며, safe area와 TTS word/sentence timing은 frame 단위 caption으로 변환된다.

각 작업은 OS 임시 폴더 아래에 독립 디렉터리를 사용한다. 완료 또는 실패 후 디렉터리는 삭제된다. 최종 MP4와 JPEG thumbnail은 Storage Provider에 업로드되고, `SceneVersion.renderManifest`에 schema/renderer version, storage key, caption 수, ffprobe QA 결과를 저장한다. 같은 idempotency key로 다시 실행하면 기존 manifest를 반환한다.

`tts-narration` AssetUsage의 timing은 caption에 사용한다. `bgm`/`sfx` AssetUsage가 있으면 FFmpeg가 narration을 sidechain ducking한 뒤 mix한다. 렌더 timeout은 `RENDER_TIMEOUT_MS`(기본 15분)이며, BullMQ의 기존 retry/cancel 상태 전이를 그대로 사용한다.

QA는 1080x1920, duration 오차, audio stream, 무음/손상 audio, black-frame 비율, caption safe-area, ffprobe/FFmpeg 오류를 검사한다. 실패와 성공 모두 임시 디렉터리를 정리한다. `apps/renderer/scripts/smoke.mjs`는 15초와 60초 fixture를 렌더하고 ffprobe 결과를 검증한다.

Production worker/renderer image에는 고정 Remotion 버전의 Chrome Headless Shell을 build 시점에 내려받아 포함한다. 따라서 런타임 네트워크에 의존해 브라우저를 설치하지 않는다. image에는 `ffmpeg`와 `ffprobe` 및 Chromium shared libraries가 있고 non-root `node` 사용자로 실행된다.

19.2 runtime에는 `fonts-noto-cjk`를 포함한다. Arial/serif 등 선택한 글꼴에 한글 글리프가 없으면 CJK fallback으로 표시한다. 한글 overlay/caption은 브랜드 still smoke에서 실제 화면으로 확인한다.
