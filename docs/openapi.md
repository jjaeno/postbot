# Postbot OpenAPI

The NestJS API exposes the generated OpenAPI UI at:

```text
http://localhost:3000/openapi
```

Current 4단계 endpoints:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | API health check |
| POST | `/auth/register` | No | Create user, default workspace, and secure session cookies |
| POST | `/auth/login` | No | Verify email/password and issue secure session cookies |
| POST | `/auth/refresh` | CSRF cookie/header | Rotate refresh token and issue a new access token |
| POST | `/auth/logout` | CSRF cookie/header | Revoke current refresh token and clear cookies |
| GET | `/auth/me` | Access cookie | Return the current user and default workspace |
| GET | `/auth/workspaces/:workspaceId/access-check` | Access cookie | Guarded workspace access check for later domain APIs |
| GET | `/channels` | Access cookie | List channels in the authenticated workspace |
| POST | `/channels` | Access cookie + CSRF | Create a channel with collection, template, output, schedule, and automation settings |
| GET | `/channels/:channelId` | Access cookie | Return one channel scoped to the authenticated workspace |
| PATCH | `/channels/:channelId` | Access cookie + CSRF | Update channel identity, settings, status, and automation configuration |
| POST | `/channels/:channelId/pause` | Access cookie + CSRF | Pause channel automation |
| POST | `/channels/:channelId/resume` | Access cookie + CSRF | Resume channel automation |
| PUT | `/channels/:channelId/platform-accounts/:platformAccountId` | Access cookie + CSRF | Assign an existing platform account to one channel |

Authenticated mutating requests must include:

```text
x-csrf-token: <postbot_csrf cookie value>
```

Access and refresh JWTs are stored only in `HttpOnly` cookies. API responses never return token values.

## Channel Contract

`POST /channels` accepts:

- `name`, `description`, `topic`, `targetAudience`, `language`
- `platforms`: one or more of `YOUTUBE`, `INSTAGRAM`, `TIKTOK`
- `collectionRule`: keywords, excluded keywords, allowed/excluded sources, recency, collection frequency
- `template`: common video template name, tone, voice profile, subtitle style, visual style, AI stock ratio
- `outputProfiles`: platform-specific duration, hook, caption, metadata, and public setting
- `scheduleRules`: platform, day of week, local time, timezone, max posts
- `automation`: `APPROVAL` or `FULL_AUTO`, minimum inventory, daily publish limit, and failure actions

Selected platforms without OAuth credentials are returned in `platformConnections` as `PLANNED`. This stage does not create fake OAuth success states.
