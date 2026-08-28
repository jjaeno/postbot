# Postbot

Postbot is an AI-assisted short-form content automation product for YouTube Shorts, Instagram Reels, and TikTok.

This repository is currently at **1단계: 모노레포와 로컬 인프라 구축**. The codebase contains only the executable foundation: workspace layout, minimal app entry points, shared package boundaries, local infrastructure, and validation commands. Product features start in later steps.

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

Check health:

```bash
docker compose ps
```

Local endpoints:

- MySQL: `localhost:3307`
- Redis: `localhost:6379`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

Stop local infrastructure:

```bash
docker compose down
```

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
- Renderer Studio: `http://localhost:3001`

The API exposes:

```text
GET /health
```

The web app displays the API health response.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
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
