FROM node:24-trixie-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY patches ./patches
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

FROM node:24-trixie-slim AS runtime-node

FROM ubuntu:26.04 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG APP=api
COPY --from=runtime-node /usr/local/bin/node /usr/local/bin/node
RUN set -eu; groupadd --system node; useradd --system --gid node --create-home node; \
  apt-get -o Acquire::Retries=3 update; apt-get -o Acquire::Retries=3 upgrade -y; \
  apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates openssl libstdc++6; \
  if [ "${APP}" = "worker" ] || [ "${APP}" = "renderer" ]; then \
  apt-get -o Acquire::Retries=3 install -y --no-install-recommends ffmpeg fonts-noto-cjk \
  libasound2t64 \
  libatk-bridge2.0-0t64 \
  libatk1.0-0t64 \
  libcups2t64 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2; \
  fi; \
  node --version; \
  rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deploy --chown=node:node /deploy /app
ENV POSTBOT_APP=${APP}
USER node
CMD ["sh", "-c", "if [ \"${POSTBOT_APP}\" = \"web\" ]; then node scripts/serve.mjs; else node dist/main.js; fi"]
