# syntax=docker/dockerfile:1.7

# ============================================================
# Base
# ============================================================
FROM node:24-alpine AS base

RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app


# ============================================================
# Dependencies – rebuilt only if manifests / lockfile change
# ============================================================
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/foundation/package.json packages/foundation/package.json

RUN --mount=type=cache,id=insura-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile


# ============================================================
# Build
# ============================================================
FROM base AS build

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/turbo.json ./turbo.json

COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY eslint.config.mjs ./eslint.config.mjs

RUN --mount=type=cache,id=insura-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm exec prisma generate && \
    pnpm run build


# ============================================================
# Runtime
# ============================================================
FROM node:24-alpine AS runner

RUN corepack enable && \
    corepack prepare pnpm@11.17.0 --activate && \
    apk add --no-cache postgresql16-client

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/turbo.json ./turbo.json

COPY --from=build /app/prisma ./prisma

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json

COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json

COPY --from=build /app/packages ./packages

ENV CI=true

RUN mkdir -p /app/node_modules/@insura && \
    ln -sfn /app/packages/foundation /app/node_modules/@insura/foundation && \
    ln -sfn /app/apps/api /app/node_modules/@insura/api && \
    ln -sfn /app/apps/worker /app/node_modules/@insura/worker && \
    ln -sfn /app/apps/web /app/node_modules/@insura/web && \
    node /app/node_modules/prisma/build/index.js generate --schema=/app/prisma/schema.prisma

COPY docker/start.sh ./start.sh

RUN chmod 755 ./start.sh && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000 3001

ENTRYPOINT ["/app/start.sh"]
