# syntax=docker/dockerfile:1.7

# ============================================================
# Worker Service - Production Build
# ============================================================
# AP-20: The runner gets production dependencies only,
# built via `pnpm deploy --prod` (no dev tools).
# BugFix-07 (Q6): The Prisma CLI + schema engines are NO LONGER part of the
# runtime images – migrations run exclusively via the compose service
# "migration". The runner only contains the generated @prisma/client
# including the query engine.
# BugFix-10 (#4): `prisma` is a devDependency (API, worker, foundation);
# the complete CLI graph (~134 MB) is no longer copied into the deploy
# output by `pnpm deploy --prod`. The generated client comes from the
# build stage.

# ---- Base Stage ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---- Dependencies Stage (all deps, build only) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/foundation/package.json packages/foundation/package.json

# Dedicated store cache per service: CI builds api/web/worker in parallel
# and a shared store (same cache mount ID) leads to racy/incomplete
# installs (TS2307: Cannot find module ...).
RUN --mount=type=cache,id=versigo-pnpm-store-worker,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @versigo/worker... --prod=false

# ---- Build Stage ----
FROM base AS build
# `pnpm install --filter @versigo/worker...` places the dependencies into the
# node_modules of the respective workspace packages (apps/worker/node_modules,
# packages/foundation/node_modules) and links them into the store
# (node_modules/.pnpm). Copying only the root node_modules would omit the
# package node_modules; the build would then depend solely on NODE_PATH
# hoisting (.pnpm/node_modules), which is not guaranteed. Therefore the
# package node_modules are copied explicitly (self-contained build).
# Invariant: both directories are always materialized by the deps install
# (worker and foundation have dependencies); the COPYs are unguarded.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/foundation/node_modules ./packages/foundation/node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/turbo.json ./turbo.json

COPY apps/worker ./apps/worker
COPY packages/foundation ./packages/foundation
COPY prisma ./prisma

# Generate Prisma Client for TypeScript compilation
RUN pnpm exec prisma generate --schema=prisma/schema.prisma && \
    pnpm run build --filter @versigo/worker

# ---- Production Dependencies Stage (runtime deps only, no dev tools) ----
# See apps/api/Dockerfile: `pnpm deploy` instead of `pnpm install --prod`
# (pnpm-11 regression with install --prod: no top-level links).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
# Built foundation package (dist) for packing during deploy
COPY --from=build /app/packages/foundation ./packages/foundation
# BugFix-10 (#4): The Prisma client generated in the build stage is copied
# here and transferred into the store path of the deploy output during RUN
# (for a directory source, Docker copies its CONTENT).
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /app/prisma-generated/

RUN --mount=type=cache,id=versigo-pnpm-store-worker,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm deploy --filter @versigo/worker --prod --legacy /app/out && \
    # BugFix-10 (#4): TypeScript is no longer in the deploy output (it was only an
    # optional peer of the Prisma CLI) – the cleanup is defensive.
    rm -rf /app/out/node_modules/.pnpm/typescript@* /app/out/node_modules/typescript && \
    # BugFix-10 (#4): Copy the generated client from the build stage into the
    # store path. The store entry comes from the packed foundation package
    # (worker has no direct @prisma/client dependency);
    # .pnpm/@prisma+client@*/node_modules/.prisma/client is the ONLY path
    # @prisma/client loads at runtime. The runner additionally links the store
    # path top-level (symlink further below).
    PRISMA_STORE_DIR="$(ls -d /app/out/node_modules/.pnpm/@prisma+client@*/node_modules | head -1)" && \
    mkdir -p "$PRISMA_STORE_DIR/.prisma" && \
    cp -a /app/prisma-generated/. "$PRISMA_STORE_DIR/.prisma/" && \
    # Runtime copy WITHOUT the Prisma CLI + schema engines (cleanup BEFORE the
    # COPY into the runner – otherwise the image size would not shrink).
    cp -a /app/out /app/out-runtime && \
    # BugFix-10 (#1): defensive – the CLI graph is devOnly and missing from
    # the deploy output; a re-introduction would otherwise grow unnoticed.
    rm -rf /app/out-runtime/node_modules/.pnpm/prisma@* \
           /app/out-runtime/node_modules/prisma \
           /app/out-runtime/node_modules/.bin/prisma \
           /app/out-runtime/node_modules/.bin/prisma.cmd \
           /app/out-runtime/node_modules/@prisma/engines \
           /app/out-runtime/node_modules/.pnpm/@prisma+engines@* \
           /app/out-runtime/node_modules/.pnpm/effect@* \
           /app/out-runtime/node_modules/.pnpm/@prisma+config@*

# ---- Runner Stage ----
FROM node:24-alpine AS runner
# BugFix-15: curl for the shell-based compose healthchecks (the previous
# `node -e` healthchecks were unreliable and curl was missing from the
# published images).
RUN apk add --no-cache curl postgresql16-client
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

# Production dependencies (runtime only) – cleaned copy WITHOUT the Prisma CLI
# and schema engines (BugFix-07 Q6, cleanup happened in prod-deps).
# --chown instead of a later `chown -R`: this saves a huge metadata layer in
# the image (chown -R over node_modules creates a layer the size of the
# content).
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/package.json ./package.json

# Prisma schema
COPY --chown=appuser:appgroup --from=build /app/prisma ./prisma

# Built application code (no source code)
COPY --chown=appuser:appgroup --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --chown=appuser:appgroup --from=build /app/apps/worker/package.json ./apps/worker/package.json

# @prisma/client is only available in the worker deploy via the packed
# foundation package (no top-level link, since there is no direct
# dependency) – the store path is therefore linked top-level at runtime.
# The generated client (query engine) was already copied from the build
# stage into the store in prod-deps (BugFix-10 #4).
RUN mkdir -p /app/node_modules/@prisma && \
    ln -sfn "$(ls -d /app/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client | head -1)" /app/node_modules/@prisma/client

COPY --chown=appuser:appgroup docker/start.sh ./start.sh

RUN chmod 755 ./start.sh

# BugFix-11: Create the uploads mount point as appuser before the container
# starts. Without this, a fresh named volume mounted at /data/uploads is
# auto-created by the container runtime as root:root, so the appuser cannot
# write to it (EACCES on uploads triggered by the worker). Docker/Podman
# copy-up preserves the image ownership for fresh named volumes. Existing
# deployments whose volume was already created as root must run a one-time
# chown (see docs/docker-image-guide.md section 5).
RUN mkdir -p /data/uploads && chown -R appuser:appgroup /data/uploads

USER appuser

EXPOSE 3100

CMD ["node", "apps/worker/dist/apps/worker/src/main.js"]

ENTRYPOINT ["/app/start.sh"]
