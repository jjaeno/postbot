# 콘텐츠 최적화

성과 최적화는 원인 단정이 아닌 비교 가능한 cohort에서 나온 가설을 관리한다. 같은 채널·플랫폼·metric·기간의 최신 스냅샷만 비교하며, 결측값은 제외하고 평균에서 두 표준편차를 넘는 이상치는 cohort에서 제거한다. 유효 표본은 최소 4개이고, 결측·이상치 처리 뒤에도 표본이 부족하면 제안은 `insufficient_sample_or_incomplete_data` 가설로만 표시된다.

제안에는 원본 snapshot ID, metric mapping 버전, 규칙 버전, cohort, baseline, 표본과 신뢰도, 위험 및 rollback 방법이 보존된다. 플랫폼이나 의미가 다른 metric은 같은 cohort로 합치지 않는다. 현재 v1에서 제안할 수 있는 변경은 `durationSeconds`뿐이며, 채널 설정의 자동 적용 허용 필드 및 최대 변화 폭(기본 20%, 최대 50%) 안에 있어야 한다.

보호 주제·브랜드 문구·금지 패턴에 일치하는 콘텐츠는 분석 입력에서 제외한다. 정책, 권리, 예산, 자동화 gate는 이 기능이 수정하거나 우회하지 않는다. `PENDING → APPROVED → APPLIED` 전이가 필요하며, `REJECTED`와 `EXPIRED`는 terminal 상태다. 적용은 기존 전략을 바꾸지 않고 새 immutable `StrategyVersion`을 만들며, rollback은 지정된 이전 버전을 복제해 새 현재 버전으로 만든다.

제한형 실험은 채널당 하나의 RUNNING 실험만 허용하며 시작 경합을 채널 잠금으로 직렬화한다. 선택 플랫폼·기간(1~90일)·목표 지표·그룹별 최소 표본·대조/변경 durationSeconds·성공 방향/상대 개선 임계치·선택적 최대 배정 수를 저장한다. 기간/배정 상한 이후에는 새 배정을 중단한다. 운영자는 pause/stop/inconclusive로 중단할 수 있다. 예산·정책 악화는 기존 제작 gate에서 보류되며 실험이 안전 설정을 완화하지 않는다.

`packages/optimization`의 공통 배정기를 전체 SCRIPT 제작 worker가 호출한다. 배정은 sha256(experimentId:contentItemId)로 결정해 최초 저장 후 유지하며, 채널의 보호 주제/브랜드/금지 패턴은 제외한다. 현재 출력 프로필과 최대 변화 폭도 제작 시 다시 확인하고 LLM 결과 길이가 배정과 맞지 않으면 거부한다. 부분 재생성은 새 실험 배정을 하지 않으며 기존 예약·전략은 덮어쓰지 않는다.

`complete`는 게시 SceneVersion의 ScriptVersion에 실제 배정 키가 남아 있는 콘텐츠만 사용한다. 같은 플랫폼/목표 지표/실험 기간의 최신 AVAILABLE observation을 콘텐츠당 하나 선택하며 결측을 0으로 바꾸지 않는다. 최소 표본은 각 그룹에 필요하다. 부족하면 `EXPERIMENT_INSUFFICIENT_SAMPLES`로 완료를 거부한다. 평균·상대 변화·판정·근거 snapshot IDs를 저장하고 완료 재요청은 기존 결과를 반환한다. 대조 평균 0 또는 변화가 임계치 미만이면 결론을 유보한다. 결과는 hypothesisOnly/causalClaim:false이며 통계적 유의성/인과 효과를 주장하거나 승자를 자동 적용하지 않는다.
