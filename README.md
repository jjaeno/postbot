# Postbot

Postbot is an AI-assisted short-form content automation product for YouTube Shorts, Instagram Reels, and TikTok.

This repository is currently at **5단계: SNS OAuth 기반과 YouTube 연결**. The codebase contains the monorepo foundation, Prisma data model, secure email/password authentication, channel configuration workflow, and YouTube account connection through OAuth/Fake OAuth providers.

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

OAuth-related variables:

```text
OAUTH_ENCRYPTION_KEY=replace-with-32-byte-base64-key
OAUTH_ENCRYPTION_KEY_VERSION=1
YOUTUBE_OAUTH_PROVIDER=fake
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
WEB_BASE_URL=http://localhost:5173
```

Use `YOUTUBE_OAUTH_PROVIDER=fake` for local E2E without real Google credentials. Use `google` only with a real client ID, client secret, and registered redirect URI.

## Local Infrastructure

Start MySQL, Redis, and MinIO:

```bash
docker compose up -d
```

Apply the Prisma schema:

```bash
pnpm --filter @postbot/database exec prisma migrate dev --schema prisma/schema.prisma
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
GET /platform-accounts/youtube/callback
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
POST /platform-accounts/youtube/connect
POST /platform-accounts/:platformAccountId/disconnect
```

Authentication uses short-lived JWT access tokens and rotating refresh tokens in `HttpOnly`, `SameSite=Lax` cookies. Mutating authenticated requests must send `x-csrf-token` with the value from the `postbot_csrf` cookie. In production, cookies are also marked `Secure`.

YouTube OAuth uses state + PKCE, required scope validation, encrypted access/refresh token storage, and one-time callback state consumption. Uploading videos is intentionally not implemented in this stage.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @postbot/web e2e
pnpm build
```

For stage 5, the focused validation set is:

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
