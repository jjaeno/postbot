# 콘텐츠 최적화

성과 최적화는 원인 단정이 아닌 비교 가능한 cohort에서 나온 가설을 관리한다. 같은 채널·플랫폼·metric·기간의 최신 스냅샷만 비교하며, 결측값은 제외하고 평균에서 두 표준편차를 넘는 이상치는 cohort에서 제거한다. 유효 표본은 최소 4개이고, 결측·이상치 처리 뒤에도 표본이 부족하면 제안은 `insufficient_sample_or_incomplete_data` 가설로만 표시된다.

제안에는 원본 snapshot ID, metric mapping 버전, 규칙 버전, cohort, baseline, 표본과 신뢰도, 위험 및 rollback 방법이 보존된다. 플랫폼이나 의미가 다른 metric은 같은 cohort로 합치지 않는다. 현재 v1에서 제안할 수 있는 변경은 `durationSeconds`뿐이며, 채널 설정의 자동 적용 허용 필드 및 최대 변화 폭(기본 20%, 최대 50%) 안에 있어야 한다.

보호 주제·브랜드 문구·금지 패턴에 일치하는 콘텐츠는 분석 입력에서 제외한다. 정책, 권리, 예산, 자동화 gate는 이 기능이 수정하거나 우회하지 않는다. `PENDING → APPROVED → APPLIED` 전이가 필요하며, `REJECTED`와 `EXPIRED`는 terminal 상태다. 적용은 기존 전략을 바꾸지 않고 새 immutable `StrategyVersion`을 만들며, rollback은 지정된 이전 버전을 복제해 새 현재 버전으로 만든다.

실험은 control/variant, 가설, target metric, 최소 표본과 종료·중단 조건을 기록한다. 채널당 하나의 `RUNNING` 실험만 허용한다. 콘텐츠 배정은 `sha256(experimentId:contentItemId)`로 계산되고 최초 저장 뒤 변경되지 않는다. 안전 지표가 악화되거나 운영자가 중단하면 `STOPPED`로, 증거가 모자라면 승자를 강제하지 않고 `INCONCLUSIVE`로 종료한다.
