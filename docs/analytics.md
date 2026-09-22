# Postbot Analytics

분석 데이터는 플랫폼 원본 응답(`rawSnapshot`)과 정규화 metric snapshot을 분리해 저장한다. 원본은 덮어쓰지 않으며 같은 post·metric·관측 시각의 수정값은 revision으로 보존한다.

## Metric mapping v1

| 공통 metric | 단위 | 집계 | 미지원 처리 |
| --- | --- | --- | --- |
| `views` | count | sum | `UNAVAILABLE`, 사유 기록 |
| `impressions` | count | sum | `UNAVAILABLE`, 사유 기록 |
| `average_watch_seconds` | seconds | average | 플랫폼별 분모가 검증된 경우만 표시 |
| `completion_rate` | ratio | ratio | 0으로 대체하지 않음 |
| `engagement_rate` | ratio | ratio | 분모 정의가 같은 플랫폼 내에서만 비교 |

서로 다른 unit 또는 aggregation을 가진 metric은 합산하지 않는다. `AVAILABLE`의 값 `0`은 실제 관측값이고, `UNAVAILABLE`은 `value: null`과 사유로 표현한다.

## 동기화와 backfill

`POST /analytics/sync`는 즉시 외부 호출을 하지 않고 `ANALYTICS` BullMQ job을 만든다. worker가 pagination을 끝까지 처리하고 `AnalyticsSync`에 sync 시각·data delay·부분 실패를 기록한다. 과거 기간을 같은 방식으로 요청하면 backfill이며, 동일 idempotency key는 같은 sync를 재사용한다. 저장은 UTC이고, 요청 timezone은 기간 경계와 UI 표시를 위해 보존한다.

`GET /analytics/report`는 channel, UTC period, 선택 platform으로 조회하며 원본 snapshot에서 정규화 metric까지 mapping version을 추적할 수 있다.
