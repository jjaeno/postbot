# 직접 UX 점검 보완 — 19.4

기준일: 2026-10-06. 시작 코드 `137d3fa`; 이전 재현 결과는 [최초 UX 점검](ux-goal-audit-2026-10-06.md)이다. 이 문서는 실제 화면 보완과 지원 한계를 구분한다. 원래 DOCX의 모든 로드맵 기능을 완료한 것으로 해석하지 않는다.

최종 판정: **PASS_WITH_EXTERNAL_VERIFICATION_PENDING**. 19.4 지원 범위의 내부 필수 검증은 모두 통과했다. 아래 미구현 기능과 실 서비스/배포 검증은 별도이며 설정만으로 해결되는 것으로 안내하지 않는다.

## 수정과 직접 재검증

| 최초 점검 사항 | 보완·재검증 |
| --- | --- |
| 취소 후 재예약 P2002/500 | cancelled 이력을 보존하는 index migration, channel 잠금과 활성 계획 중복 검증. 실제 UI 취소→새 예약→Fake 게시 성공 |
| YT 제목이 다른 플랫폼에 전파 | reviewTitle을 선택 ScriptVersion에 격리. YT 수정 후 IG/TT 제목·승인 유지 |
| 채널 운영 설정 화면 누락 | 수집 키워드/제외/허용·제외 출처/최신성/주기, 일정 슬롯, 재고, 오류 처리와 플랫폼별 길이·훅·자막·언어·공개 설정 저장·DB 확인 |
| 분석·최적화 제어 없음 | 7/30/90일 동기화, 소유자 보호 설정, 지표별 제안 생성, 표본/근거/전략/위험 표시·작업 오류 표시 |
| 모바일 가로 넘침 | min-width/긴 자산명 줄바꿈/검수 header 조정. 실제 390px 문서 폭 390px, 편집·분석·영상 screenshot 확인 |
| AI 고지 복구/정책 안내 | 한국어 행동 안내, 고지 추가→저장→검사→승인 실제 조작. 권리·민감 주제·강제 검수는 고지 버튼으로 우회 불가 |
| 캘린더 플랫폼 무시 | 선택/예약 변경 시 콘텐츠와 플랫폼을 함께 복원. TikTok에서 YT 예약 변경 후 YT 탭 확인 |
| 중지 채널 제작 404 | 재생성 비활성화·재개 안내, 검수/예약은 유지 |
| access 만료 시 로그아웃 | refresh single-flight/CSRF 재취득/한 번 재시도/실패 시 인증 화면 복귀. 실제 access cookie 제거 후 세션 복구 |
| 키보드 탭·선택 상태 | roving tabIndex와 Arrow/Home/End, URL platform 유지, 새로고침 복원 |
| 완료 후 과거 오류 표시 | 샘플 완료 시 과거 오류 초기화, 완료/실패 표시 분리 |
| 실패한 SNS 연결 후 초안 안 보임 | 초안 생성 직후 channel cache 갱신, 복구 가능한 wizard draft 유지 |
| Provider 차단 복구 화면 없음 | owner-only 상태 조회/확인/차단/복구/감사. 실제 image 차단·복구, 전역 duplicate row 복구 회귀 |
| 유료 제작 후 길이 정책 차단 | 등록 정책 길이·음원 권리 preflight. 부적합 길이에서 job/run 생성 0 확인 |
| BGM/SFX/음성·자막 부분 편집 | 권리 확인 PCM WAV 업로드, 선택·볼륨 저장, 실제 합성. 자막은 기존 TTS/이미지 재사용, 음성은 새 TTS와 실제 렌더 |
| 대본 직접 수정 | 소유자 출처 확인 후 immutable 버전 생성. 타 플랫폼 보존, 재렌더·재검수 필요. hook/CTA 민감성 검사 유지 |
| 비용 필터/알림 이동 | 채널/콘텐츠/제공자/기간 필터, provider별 원장, 알림의 관련 화면 링크 |
| 추가 발견: 취소가 다시 RUNNING | queued 작업 취소·late worker/scheduler 상태 보존 회귀. 완료 결과는 보존하며 취소 run은 되살리지 않음 |
| 추가 발견: 재생성 뒤 예전 영상 | sceneVersion별 preview cache, 만료 전 URL 재취득. 새 1080×1920/33초 영상 실제 재생·오류 null 확인 |
| 추가 발견: wizard 음원 설정 후 다른 설정 고정 | 음원 override만 보존하고 최신 기본/플랫폼/수집 설정을 합성, Playwright 회귀 |

브라우저 증거: `.artifacts/ux-remediation-194/results.json` 및 PNG. 실제 Nest API/MySQL/BullMQ/MinIO/Chromium/FFmpeg를 사용하며 LLM·이미지·음성·SNS 외부 서비스만 Fake다. 화면 입력/클릭으로 실행하고 API 읽기는 저장 검증에만 사용했다. 미디어의 Docker DNS는 loopback QA 운반을 사용해 서명 Host를 유지했으므로 운영 public storage DNS 검증은 아니다. ID/비밀번호/쿠키/token/서명 URL은 보고서에 기록하지 않는다.

## 명세와 구현의 남은 차이

* 커버 직접 편집/플랫폼 커스텀 커버 게시, 자유 영상·오디오 타임라인, 자유 화면 비율은 제공하지 않는다. 자동 thumbnail만 생성한다. 이는 단순 API 키 설정으로 생기는 기능이 아니다.
* 외부 스톡 자동 구매·검색, 음원 자동 구매·검색 Provider는 선택·구현되지 않았다. 권리 확인된 사용자 이미지/WAV 등록은 지원한다.
* 최적화 제안/비교 실험은 durationSeconds만 지원한다. 훅·포맷·게시 시각의 고급 패턴, 고급 인과·통계 분석까지 구현됐다고 주장하지 않는다.
* 실제 Provider 과금·음성 동의·SNS OAuth 권한·앱 심사·실 게시·플랫폼별 공개/커버 제약·운영 도메인/스토리지/배포는 외부 검증이 필요하다. 저장된 정책은 운영자가 공식 최신 규칙과 대조/갱신해야 한다.
* 테스트의 source/이미지/음성/게시 링크는 합성 Fixture이며 한국어 제작 품질·수익화 승인·수익 발생을 보장하지 않는다.

## 검증 기록

| 항목 | 결과 |
| --- | --- |
| 변경 app/package lint·typecheck·build | API/worker/web/renderer/contracts/database/providers/scene-schema PASS. |
| API unit·DB integration | 31 files, 96/96 PASS. 별도 HTTP release 여정과 구분한다. |
| Worker unit·DB integration | 11 files, 23/23 PASS. 취소 run 재전달·정책·부분 재사용 회귀 포함. |
| Web unit·서버 | 10/10 PASS. 세션 회전·서버 접근 보호 포함. |
| 공통 패키지 | contracts 1/1, scene-schema 4/4, database 8/8, providers 14 PASS. 실 Provider 1개는 자격 증명이 없어 skip이며 성공으로 세지 않는다. |
| Renderer | unit 3/3, 실제 FFmpeg/ffprobe smoke 4모드 PASS. narration/BGM/SFX 합성, 무음, 볼륨 검증 포함. |
| Playwright | 18/18 PASS. API mock 기반 UI 회귀이며 실제 API 화면 조작과 구분한다. |
| 실제 API 브라우저 조작 | 중복 재실행을 제외한 21개 점검 PASS, page error 0. 390px 모바일, 실제 1080×1920/33초 새 영상 재생 포함. |
| Migration | 기존·빈 테스트 DB 및 별도 신규 acceptance DB에서 12개 migration 적용 PASS. |
| Fake 전체 HTTP 여정 | 신규 격리 환경 3/3 PASS. 수동 약 141초, APPROVAL 약 344초, FULL_AUTO 약 361초. 3플랫폼 제작/게시/분석, 버전·게시 수·중복 요청/비용 검증 포함. |

중간 테스트 환경 문제는 숨기지 않는다: 처음 Docker 중지 상태를 복구했고, 잘못 지정한 임시 DB credentials/storage endpoint 및 로컬 미실행 DB를 격리 테스트 환경으로 바로잡았다. 병렬 CPU 포화로 실험 DB test가 5초 timeout이었으나 동일 코드의 단독 재실행 3개와 이후 전체 API 96개는 통과했다. 렌더 대기 180초 초과는 완성 성공으로 간주하지 않고 완료 후 실제 재생으로 다시 확인했다. selector/fixture 오류도 수정 후 재실행했다. 전체 HTTP 여정의 첫 시도는 테스트 전용 DB 이름 보호 장치가 거절했고, 기존 acceptance DB로 재시도했을 때는 과거 자산의 MinIO key가 없어 실패했다. 기존 데이터/스토리지를 삭제하거나 보호 장치를 완화하지 않고 `postbot-acceptance-194` 신규 Compose 프로젝트로 DB와 저장소를 함께 격리했다.

신규 격리 전체 여정의 FULL_AUTO 단계에서는 `automationRun.updateMany` DB deadlock이 한 번 발생했고 BullMQ 재시도로 복구됐다. 실패 attempt를 삭제하지 않고 보존하며 최종 성공·플랫폼별 버전 수·게시 수·멱등성 검증과 구분한다.

실행 환경은 기존 검증된 Node 24/Ubuntu 이미지에 최종 빌드 artifact를 read-only mount한 것이다. 최종 production 이미지 재빌드·push·운영 배포·원격 CI·실 Provider/SNS 검증은 이번 실행에 포함되지 않는다. 의존성/컨테이너 설정은 변경하지 않았다. 웹 build의 500kB 초과 chunk 경고(약 512kB, gzip 151kB)는 남아 있으며 실패로 숨기거나 해소됐다고 주장하지 않는다. 최종 diff whitespace와 변경 코드의 비밀값/금지 TypeScript 패턴 점검도 PASS. 완료 후 테스트용 신규 Compose 서비스와 직접 실행한 브라우저/웹 서버는 중지하고 DB·스토리지·증거 파일은 보존한다. 최종 commit은 `git log -1 --format=%H`로 확인한다. push는 수행하지 않는다.
