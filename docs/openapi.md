# Postbot OpenAPI

The NestJS API exposes the generated OpenAPI UI at:

```text
http://localhost:3000/openapi
```

Current stage 5 endpoints:

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
| GET | `/platform-accounts` | Access cookie | List platform accounts for the authenticated workspace |
| POST | `/platform-accounts/youtube/connect` | Access cookie + CSRF | Create a YouTube OAuth state with PKCE and return the provider authorization URL |
| GET | `/platform-accounts/youtube/callback` | OAuth state | Consume a YouTube OAuth callback and connect the platform account |
| POST | `/platform-accounts/:platformAccountId/disconnect` | Access cookie + CSRF | Revoke provider tokens when possible and disconnect the account |
| POST | `/generation/script-scene` | Access cookie + CSRF | Validate an owned idea and enqueue a `SCRIPT` generation job; returns the job immediately |
| GET | `/jobs/:jobId` | Access cookie | Read current generation job state and result |
| GET | `/jobs/:jobId/events` | Access cookie | Subscribe to generation progress via SSE |
| GET | `/content/:contentItemId/review` | Access cookie | Read a workspace-scoped content preview, sources, asset rights, and latest policy result |
| POST | `/content/:contentItemId/review/policy-check` | Access cookie + CSRF | Evaluate the effective versioned policy rule and preserve an immutable snapshot |
| POST | `/content/:contentItemId/review/action` | Access cookie + CSRF | Approve, hold, discard, or mark content scheduled; approval requires a passing policy check |
| GET | `/content` | Access cookie | List up to 100 workspace-scoped content items for operational status and calendar workflows |
| POST | `/publishing/plans` | Access cookie + CSRF | Create or return an idempotent YouTube publish plan after policy, account, and render gates pass |
| GET | `/automation/runs` | Access cookie | List workspace-scoped automation runs and step states |
| GET | `/automation/runs/:runId` | Access cookie | Read one automation run, heartbeat, error, and checkpoints |
| POST | `/automation/runs` | Access cookie + CSRF | Start an idempotent automation run; optional stage cost estimates enable reserved-cost processing |
| POST | `/automation/runs/:runId/control` | Access cookie + CSRF | Pause, resume, drain, kill, retry, hold, or skip an automation run step |
| POST | `/automation/budgets` | Access cookie + CSRF | Configure workspace or channel daily/monthly soft and hard limits |
| POST | `/automation/switches` | Access cookie + CSRF | Set workspace or provider kill switches |
| POST | `/analytics/sync` | Access cookie + CSRF | Create an idempotent ANALYTICS sync job for one channel/platform/period |
| GET | `/analytics/report` | Access cookie | Return normalized metrics, availability, mapping version, and latest sync state |

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

Selected platforms without OAuth credentials are returned in `platformConnections` as `PLANNED`.

## Platform Account Contract

`GET /platform-accounts` returns:

- `id`, `workspaceId`, `channelId`
- `platform`
- `externalAccountId`, `handle`, `displayName`
- `status`: `PLANNED`, `CONNECTED`, `EXPIRED`, `SCOPE_MISSING`, or `DISCONNECTED`
- granted `scopes`
- `expiresAt`, `connectedAt`, `disconnectedAt`

`POST /platform-accounts/youtube/connect` accepts an optional `channelId` and returns:

- `authorizationUrl`
- `stateExpiresAt`
- `provider`: `fake` or `google`
- `requiredScopes`

The callback validates OAuth `state`, consumes it once, uses the stored PKCE verifier, validates required YouTube scopes, encrypts access/refresh tokens at application level, records the encryption key version, and links the external account to at most one workspace/channel.

The stage 5 API does not upload videos and does not fake successful Google behavior when real credentials or scopes are missing.

## Generation Contract

`POST /generation/script-scene` accepts `ideaId`, optional `platform`, `idempotencyKey`, and `partial` (`full`, `hook`, `body`, `metadata`, or `scene`). It verifies CSRF, workspace ownership, and idea ownership, then creates or returns the idempotent `SCRIPT` job. The API does not call an LLM in this request; completion is available through the job REST and SSE endpoints.
