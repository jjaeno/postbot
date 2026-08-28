# Postbot

Postbot is an AI-assisted short-form content automation product for YouTube Shorts, Instagram Reels, and TikTok.

This repository is currently at **4단계: 채널·템플릿·일정 설정 Vertical Slice**. The codebase contains the monorepo foundation, Prisma data model, secure email/password authentication, and the first authenticated channel configuration workflow.

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
```

Authentication uses short-lived JWT access tokens and rotating refresh tokens in `HttpOnly`, `SameSite=Lax` cookies. Mutating authenticated requests must send `x-csrf-token` with the value from the `postbot_csrf` cookie. In production, cookies are also marked `Secure`.

Channels store one clear topic, target audience, language, collection rule, common video template, platform output profiles, schedule rules, minimum inventory, and automation safety settings. OAuth is not implemented in this stage; selected platforms without credentials are returned as `PLANNED` and shown as `연결 예정`.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @postbot/web e2e
pnpm build
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
