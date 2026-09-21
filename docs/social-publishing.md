# Instagram Reels·TikTok 게시 운영 설정

확인일: 2026-09-22. `INSTAGRAM_OAUTH_PROVIDER=fake`, `TIKTOK_OAUTH_PROVIDER=fake`는 로컬 계약 검증 전용이며 실제 게시 완료를 의미하지 않는다.

실운영 전 Meta 앱의 Instagram Content Publishing 권한과 TikTok Content Posting API 앱 심사·게시 권한을 각각 승인받아야 한다. client ID/key와 secret은 비밀 저장소로 주입하고, scope 거부·token 만료·resumable timeout은 PlatformPost 상태 확인 없이 자동 재게시하지 않는다.

Instagram과 TikTok은 독립 Provider/credential/PublishPlan으로 실행된다. 한 플랫폼 실패는 다른 플랫폼의 게시 상태를 변경하지 않는다.
