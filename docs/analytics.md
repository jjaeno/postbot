# Postbot Analytics

분석 데이터는 플랫폼 원본 응답(`rawSnapshot`)과 정규화 metric snapshot을 분리해 저장한다. 원본은 덮어쓰지 않으며 같은 post·metric·관측 시각의 수정값은 revision으로 보존한다.

## Metric mapping v2 (2026-10-21)

`average_view_ratio`는 YouTube 평균 시청 비율이며 `completion_rate`와 다르다. Instagram `reach`도 `impressions`와 다르다. 기존 혼동 매핑은 미제공으로 격리하며 raw 응답을 유지한다. snapshot은 sync·post·metric·관측 시각·revision으로 구분한다. 영상 식별자·제목·조회 기간·최신/이전 관측을 함께 반환하고 합산하지 않는다.

`ANALYTICS_COLLECTION_HOURS`의 기본은 `24,72,168`이다. 수동 게시도 정기 수집 대상이며 부분 실패는 성공한 게시물을 제외하고 재개한다. 상세 복구·migration·공식 문서 확인 범위는 [운영 보완 보고서](image-motion-mvp-2026-10-21.md)를 따른다.

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

worker factory는 `YOUTUBE_ANALYTICS_PROVIDER`, `INSTAGRAM_ANALYTICS_PROVIDER`, `TIKTOK_ANALYTICS_PROVIDER`를 각각 선택한다. Fake는 local/contract 전용이며 real selector는 저장된 OAuth credential을 복호화·refresh한 뒤 플랫폼 API pagination을 수행한다. 한 page/metric 실패는 partial failure로 기록하고 이미 저장한 snapshot을 삭제하지 않는다.
