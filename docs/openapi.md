# Postbot OpenAPI

The NestJS API exposes the generated OpenAPI UI at:

```text
http://localhost:3000/openapi
```

Current v1 endpoint summary (the generated Swagger document is authoritative for schemas):

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | API health check |
| GET | `/ready` | No | MySQL, Redis, and storage readiness |
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
| POST | `/platform-accounts/instagram/connect` | Access cookie + CSRF | Start Meta Instagram OAuth |
| GET | `/platform-accounts/instagram/callback` | OAuth state | Complete Instagram OAuth and profile validation |
| POST | `/platform-accounts/tiktok/connect` | Access cookie + CSRF | Start TikTok PKCE OAuth |
| GET | `/platform-accounts/tiktok/callback` | OAuth state | Complete TikTok OAuth and scope validation |
| POST | `/platform-accounts/:platformAccountId/disconnect` | Access cookie + CSRF | Revoke provider tokens when possible and disconnect the account |
| POST | `/ideas/collect` | Access cookie + CSRF | Collect and deduplicate manual, fixture, or configured RSS ideas |
| POST | `/generation/script-scene` | Access cookie + CSRF | Validate an owned idea and enqueue a `SCRIPT` generation job; returns the job immediately |
| POST | `/jobs` | Access cookie + CSRF | Enqueue a validated production stage job |
| GET | `/jobs/:jobId` | Access cookie | Read current generation job state and result |
| GET | `/jobs/:jobId/events` | Access cookie | Subscribe to generation progress via SSE |
| GET | `/content/:contentItemId/review` | Access cookie | Read a workspace-scoped content preview, sources, asset rights, and latest policy result |
| POST | `/content/:contentItemId/review/policy-check` | Access cookie + CSRF | Evaluate the effective versioned policy rule and preserve an immutable snapshot |
| POST | `/content/:contentItemId/review/action` | Access cookie + CSRF | Approve, hold, discard, or mark content scheduled; approval requires a passing policy check |
| PATCH | `/content/:contentItemId/review/metadata` | Access cookie + CSRF | Create a new platform metadata version |
| POST | `/content/:contentItemId/review/asset-license` | Owner + CSRF | Record human-reviewed HTTPS rights proof, commercial/derivative permission and VERIFIED/REJECTED status; invalidate approval/policy and hold affected reservations |
| GET | `/content/:contentItemId/review/preview` | Access cookie | Return a short-lived render preview/direct recovery URL |
| GET | `/content` | Access cookie | List up to 100 workspace-scoped content items for operational status and calendar workflows |
| POST | `/publishing/plans` | Access cookie + CSRF | Create or return an idempotent YouTube publish plan after policy, account, and render gates pass |
| GET | `/publishing/plans` | Access cookie | List workspace-scoped publish plans and outcomes for the calendar |
| POST | `/publishing/plans/:id/cancel` | Access cookie + CSRF | Atomically cancel only an unstarted scheduled plan and its queued publish job; reschedule explicitly with a new plan |
| GET | `/automation/runs` | Access cookie | List workspace-scoped automation runs and step states |
| GET | `/automation/runs/:runId` | Access cookie | Read one automation run, heartbeat, error, and checkpoints |
| POST | `/automation/runs` | Access cookie + CSRF | Start an idempotent automation run; optional `ideaId` and `platforms` start the full pipeline from a selected idea and costs are estimated server-side |
| POST | `/automation/runs/:runId/control` | Access cookie + CSRF | Pause, resume, drain, kill, retry, hold, or skip an automation run step |
| POST | `/automation/budgets` | Access cookie + CSRF | Configure workspace or channel daily/monthly soft and hard limits |
| GET | `/automation/budgets` | Access cookie | List workspace and channel budget limits |
| POST | `/automation/switches` | Access cookie + CSRF | Set workspace or provider kill switches |
| POST | `/analytics/sync` | Access cookie + CSRF | Create an idempotent ANALYTICS sync job for one channel/platform/period |
| GET | `/analytics/report` | Access cookie | Return normalized metrics, availability, mapping version, and latest sync state |
| POST | `/optimization/suggestions/generate` | Access cookie + CSRF | Generate an evidence/sample-aware optimization suggestion |
| GET | `/optimization/channels/:channelId/strategies` | Access cookie | List owned-channel versioned strategy history |
| POST | `/optimization/channels/:channelId/rollback/:version` | Owner + CSRF | Restore a historical strategy for future generation without altering scheduled snapshots |
| GET | `/operations/costs` | Access cookie | Return usage/cost reconciliation |
| GET | `/operations/notifications` | Access cookie | List deduplicated in-app notifications |
| POST | `/operations/data-lifecycle` | Access cookie + CSRF | Enqueue retention, workspace deletion, or current-user deletion |
| GET | `/operations/data-lifecycle/:requestId` | Access cookie | Read asynchronous deletion/retention status |

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

Each `POST /platform-accounts/<youtube|instagram|tiktok>/connect` accepts an optional `channelId` and returns:

- `authorizationUrl`
- `stateExpiresAt`
- `provider`: the configured Fake or real provider
- `requiredScopes`

The callback validates OAuth `state`, consumes it once, uses the stored PKCE verifier where supported, validates platform scopes, encrypts access/refresh tokens at application level, records the encryption key version, and links the external account within one workspace/channel.

Real selectors fail closed when credentials or scopes are missing. Fake selectors remain explicit local/test providers.

For callbacks accepting HTML, the server redirects with HTTP 303 to the configured trusted frontend and original channel. Success/failure indicators contain no OAuth codes, tokens or provider error detail. JSON clients retain the existing callback response.

## Pre-release automation and review changes

`POST /automation/runs` supports `ideaId`, `platforms` and `partial`. Clients do not supply stage prices. Scheduler and manual starts share server estimation; absent real-provider pricing holds with `COST_PRICING_REQUIRED`. A channel row lock reuses active non-idea runs when scheduler/manual requests race. Responses expose `createdAt` and terminal `finishedAt` for elapsed-time display.

Approval, policy and metadata are platform-scoped. Editing metadata preserves the rendered SceneVersion and rights evidence, creates a new ScriptVersion, requires recheck/reapproval and holds old scheduled plans. Reservations enforce actual occupied slots and channel daily platform limits within a channel lock. A worker claims a scheduled plan atomically before upload, so cancellation cannot race an already-started publish.

Experiment completion is rejected with `EXPERIMENT_RESULT_ANALYSIS_NOT_IMPLEMENTED`: automatic production assignment/result comparison is not a supported feature. Stored experiment state alone is not a completed analysis.

## Generation Contract

`POST /generation/script-scene` accepts `ideaId`, optional `platform`, `idempotencyKey`, and `partial` (`full`, `hook`, `body`, `metadata`, or `scene`). It verifies CSRF, workspace ownership, and idea ownership, then creates or returns the idempotent `SCRIPT` job. The API does not call an LLM in this request; completion is available through the job REST and SSE endpoints.
