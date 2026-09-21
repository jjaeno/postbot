# YouTube Shorts 게시 운영 설정

확인일: 2026-09-22

실제 게시에는 Google OAuth 동의 화면과 YouTube Data API 사용 설정이 필요하다. `YOUTUBE_OAUTH_PROVIDER=google`을 설정하고 `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `OAUTH_ENCRYPTION_KEY`를 배포 비밀 저장소에서 주입한다. 업로드 권한은 `https://www.googleapis.com/auth/youtube.upload`이며, 계정 연결 후 이 scope가 credential에 존재해야 한다.

Google Publisher는 resumable upload를 사용하며, 예약 게시 시 metadata의 `privacyStatus=private`과 `publishAt`을 전달한다. 개발·테스트 환경은 `YOUTUBE_OAUTH_PROVIDER=fake`를 사용하며 실제 플랫폼 게시로 간주하지 않는다.

실제 배포 전에는 다음을 확인한다.

* OAuth 동의 화면과 redirect URI가 배포 API URL과 일치한다.
* YouTube Data API quota와 앱 심사·테스트 사용자 제한을 확인한다.
* 새 access token, refresh token, token 만료, scope 거부, resumable upload timeout을 운영 계정에서 검증한다.
* `PlatformPost`의 external ID와 URL을 YouTube API로 재확인한 뒤에만 ambiguous timeout을 수동 복구한다.
