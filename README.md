# Postbot

Postbot is an AI-assisted short-form content automation product for YouTube Shorts, Instagram Reels, and TikTok.

The v1 implementation covers the stage 0–19 local/Fake scope: source collection, generation, assets/TTS, rendering, policy/review, approval and full automation, scheduled social publishing, analytics/optimization, operations, backup/recovery, and production containers. Real-provider credentials, platform app review, and a selected production infrastructure remain external verification work; Fake success is not presented as real-provider success.

## Requirements

- Node.js 20.x
- Corepack
- Docker Desktop or a compatible Docker engine

Enable the pinned pnpm version:

```bash
corepack enable
corepack prepare pnpm@10.34.5 --activate
```

## Install

```bash
pnpm install
```

## Environment

Copy the example file for local development:

```bash
cp .env.example .env
```

The example values are local placeholders only. Do not commit real API keys, OAuth tokens, or secrets.

Provider selection is explicit. The complete, validated list is in `.env.example`; common local selectors are:

```text
OAUTH_ENCRYPTION_KEY=replace-with-32-byte-base64-key
OAUTH_ENCRYPTION_KEY_VERSION=1
YOUTUBE_OAUTH_PROVIDER=fake
INSTAGRAM_OAUTH_PROVIDER=fake
TIKTOK_OAUTH_PROVIDER=fake
YOUTUBE_ANALYTICS_PROVIDER=fake
INSTAGRAM_ANALYTICS_PROVIDER=fake
TIKTOK_ANALYTICS_PROVIDER=fake
LLM_PROVIDER=fake
IMAGE_PROVIDER=fake
TTS_PROVIDER=fake
STORAGE_PROVIDER=s3
TOPIC_SOURCE_PROVIDER=fixture
```

Use real selectors only with credentials and registered callback URIs. See `docs/external-verification-checklist.md`.

## Local Infrastructure

Start MySQL, Redis, and MinIO:

```bash
docker compose up -d
```

Apply migrations and seed data:

```bash
pnpm --filter @postbot/database exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @postbot/database db:seed
```

Local endpoints:

- MySQL: `localhost:3307`
- Redis: `localhost:6379`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

## Development

Run all apps through Turborepo:

```bash
pnpm dev
```

Or run each app separately:

```bash
pnpm --filter @postbot/api dev
pnpm --filter @postbot/web dev
pnpm --filter @postbot/worker dev
pnpm --filter @postbot/renderer dev
```

Default ports:

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- API OpenAPI UI: `http://localhost:3000/openapi`
- Renderer Studio: `http://localhost:3001`

## API

Public:

```text
GET /health
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET /platform-accounts/{youtube|instagram|tiktok}/callback
```

Authenticated:

```text
GET /auth/me
GET /auth/workspaces/:workspaceId/access-check
GET /channels
POST /channels
GET /channels/:channelId
PATCH /channels/:channelId
POST /channels/:channelId/pause
POST /channels/:channelId/resume
PUT /channels/:channelId/platform-accounts/:platformAccountId
GET /platform-accounts
POST /platform-accounts/{youtube|instagram|tiktok}/connect
POST /platform-accounts/:platformAccountId/disconnect
```

Generation, jobs/SSE, review, automation, publishing, analytics, optimization, operations and data lifecycle endpoints are listed in `docs/openapi.md` and generated at `/openapi`.

Authentication uses short-lived JWT access tokens and rotating refresh tokens in `HttpOnly`, `SameSite=Lax` cookies. Mutating authenticated requests must send `x-csrf-token` with the value from the `postbot_csrf` cookie. In production, cookies are also marked `Secure`.

OAuth uses one-time state, PKCE where supported, required scope validation, encrypted access/refresh token storage, refresh rotation and provider revoke where available. Publishing is always driven by a gated `PublishPlan` and protects ambiguous retries from duplicate upload.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @postbot/web e2e
pnpm build
```

Full local acceptance and performance baseline use the isolated Docker stack:

```bash
docker compose -f docker-compose.acceptance.yml build api worker migrate acceptance
docker compose -f docker-compose.acceptance.yml up -d --wait api worker
docker compose -f docker-compose.acceptance.yml run --rm acceptance
pnpm baseline:local
```

The baseline output is `LOCAL_BASELINE`, not a production SLO.

Example focused validation set:

```bash
pnpm --filter @postbot/publishers lint
pnpm --filter @postbot/publishers typecheck
pnpm --filter @postbot/api lint
pnpm --filter @postbot/api typecheck
pnpm --filter @postbot/api test
pnpm --filter @postbot/api build
pnpm --filter @postbot/web lint
pnpm --filter @postbot/web typecheck
pnpm --filter @postbot/web build
pnpm --filter @postbot/web e2e
```

## Workspace Layout

```text
apps/
  web/       React + Vite management console
  api/       NestJS REST API
  worker/    NestJS standalone worker process
  renderer/  Remotion project
packages/
  config/
  contracts/
  database/
  logger/
  providers/
  scene-schema/
  publishers/
  policy-engine/
  asset-library/
infra/
```

Apps must depend on packages through public package exports. Apps must not import another app's internal source.

## Production and recovery

`Dockerfile` builds production-only, non-root images for `web`, `api`, `worker`, and `renderer`. The worker/renderer images include FFmpeg/ffprobe and the pinned Remotion browser at build time. `docker-compose.production.yml` runs migrations before application rollout and separates render queues from the general worker.

Use `pnpm backup:mysql`, `pnpm backup:verify -- <dump.sql>`, `pnpm backup:restore -- <dump.sql>`, and `pnpm recover:queues` according to `docs/deployment-runbook.md`. Never run restore against an unverified production target.
