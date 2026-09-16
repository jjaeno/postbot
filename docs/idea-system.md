# Postbot 소재 수집과 아이디어 관리

7단계는 외부 소재를 바로 콘텐츠로 생성하지 않고 `ContentIdea` 후보로 저장한다. 대본과 Scene JSON 생성은 8단계에서 처리한다.

## Provider

소재 수집은 `TopicSourceProvider` 인터페이스 뒤에 둔다. 현재 구현은 `FixtureTopicSourceProvider`를 사용하며 RSS, 공식 URL, 허용 공개 소스를 흉내내는 deterministic fixture를 반환한다. 실제 외부 RSS/URL 수집기는 후속 확장 시 같은 인터페이스 뒤에 추가한다.

## Canonicalization과 중복 제거

수집 URL은 fragment와 tracking query를 제거하고 hostname을 소문자로 정규화한다. 중복 제거는 다음 키로 수행한다.

- `ContentIdea(channelId, urlHash)`
- `ContentIdea(channelId, contentHash)`

같은 소재라도 채널이 다르면 별도 후보로 저장할 수 있다.

## 점수와 필터

각 후보는 저장 전에 다음 점수를 계산한다.

- suitability: 채널 수집 키워드와 후보 텍스트의 매칭
- freshness: `publishedAt`과 채널 `recencyHours`
- reliability: provider가 제공한 출처 신뢰도
- expected value: suitability, freshness, reliability를 합성한 예상 시청 가치

금지 주제, 채널 제외 주제, 제외 키워드가 포함된 후보는 저장하지 않고 rejected count로 기록한다.

## 상태

아이디어 상태는 다음 값만 사용한다.

- `CANDIDATE`
- `SHORTLISTED`
- `REJECTED`
- `USED`
- `EXPIRED`

관리 UI와 API는 상태 필터와 상태 변경을 제공한다.

## API

- `POST /ideas/collect`: fixture 자동 수집 또는 수동 후보 저장
- `GET /ideas/channels/:channelId`: 채널 아이디어 목록
- `PATCH /ideas/:ideaId/status`: 후보 상태 변경

모든 API는 인증된 workspace에 속한 채널과 아이디어만 다룬다.
