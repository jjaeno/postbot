FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
RUN pnpm fetch
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @postbot/database exec prisma generate --schema prisma/schema.prisma
RUN pnpm build

FROM build AS deploy
ARG APP=api
RUN TARGET_APP="${APP}"; \
  if [ "${TARGET_APP}" = "renderer" ]; then TARGET_APP="worker"; fi; \
  pnpm --filter "@postbot/${TARGET_APP}" deploy --prod --legacy /deploy; \
  PRISMA_SOURCE="$(find /app/node_modules/.pnpm -type d -path '*/node_modules/.prisma' -print -quit)"; \
  PRISMA_CLIENT="$(find /deploy/node_modules/.pnpm -type d -path '*/node_modules/@prisma/client' -print -quit)"; \
  if [ -n "${PRISMA_SOURCE}" ] && [ -n "${PRISMA_CLIENT}" ]; then \
    cp -R "${PRISMA_SOURCE}" "$(dirname "$(dirname "${PRISMA_CLIENT}")")/"; \
  fi
RUN set -eu; \
  if [ "${APP}" = "worker" ] || [ "${APP}" = "renderer" ]; then \
    REMOTION_RENDERER="$(find /deploy/node_modules/.pnpm -type d -path '*/node_modules/@remotion/renderer' -print -quit)"; \
    test -n "${REMOTION_RENDERER}"; \
    cd /deploy && node --input-type=module -e "import('${REMOTION_RENDERER}/dist/esm/index.mjs').then(({ensureBrowser}) => ensureBrowser({logLevel: 'info'}))"; \
  fi

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
  ffmpeg \
  openssl \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deploy --chown=node:node /deploy /app
ARG APP=api
ENV POSTBOT_APP=${APP}
USER node
CMD ["sh", "-c", "if [ \"${POSTBOT_APP}\" = \"web\" ]; then node scripts/serve.mjs; else node dist/main.js; fi"]
