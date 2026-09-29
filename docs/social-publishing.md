# YouTube·Instagram Reels·TikTok 게시 운영 설정

확인일: 2026-09-22. `INSTAGRAM_OAUTH_PROVIDER=fake`, `TIKTOK_OAUTH_PROVIDER=fake`는 로컬 계약 검증 전용이며 실제 게시 완료를 의미하지 않는다.

실운영 전 Google OAuth/YouTube Data API, Meta Instagram Content Publishing, TikTok Content Posting API의 앱 심사·게시 권한을 각각 승인받아야 한다. client ID/key와 secret은 비밀 저장소로 주입하고, scope 거부·token 만료·resumable timeout은 PlatformPost와 provider status 확인 없이 자동 재게시하지 않는다.

세 플랫폼은 독립 Provider/credential/PublishPlan으로 실행된다. 한 플랫폼 실패는 다른 플랫폼의 게시 상태를 변경하지 않는다. worker 시작 시 만료 임박 token을 refresh하고 새 refresh token과 만료 시각을 암호화해 저장한다.

- Instagram은 OAuth code를 장기 token으로 교환하고 professional account/profile을 확인한 뒤 media container 생성, status polling, publish 순서로 실행한다.
- TikTok은 PKCE OAuth와 `video.publish` scope를 확인하고 Direct Post init/upload, publish status polling 순서로 실행한다.
- 동일 `PublishPlan`은 한 idempotency key만 사용한다. timeout이 업로드 이후 발생한 경우 `PublishAttempt`는 ambiguous 상태를 보존하며 상태 확인 전 새 업로드를 시작하지 않는다.

실제 계정 점검 절차는 `external-verification-checklist.md`를 따른다.
