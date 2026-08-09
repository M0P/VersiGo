# syntax=docker/dockerfile:1.7

# ============================================================
# API Service - Production Build
# ============================================================
# AP-20: The runner gets production dependencies only,
# built via `pnpm deploy --prod` (no dev tools such as typescript,
# eslint, vitest, @nestjs/cli).
# BugFix-07 (Q6): The Prisma CLI + schema engines are NO LONGER part of the
# runtime images – migrations run exclusively via the compose service
# "migration" (build target `migration` below). The runner only contains
# the generated @prisma/client including the query engine.
# BugFix-10 (#4): `prisma` is a devDependency (API, worker, foundation);
# the complete CLI graph (prisma, @prisma/engines, effect, @prisma/config,
# ~134 MB) is no longer copied into the deploy output by `pnpm deploy --prod`.
# The generated client comes from the build stage; the CLI for the
# migration service is installed on its own in the `migration-cli` stage.

# ---- Base Stage ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---- Dependencies Stage (all deps, build only) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/foundation/package.json packages/foundation/package.json

# Dedicated store cache per service: CI builds api/web/worker in parallel
# and a shared store (same cache mount ID) leads to racy/incomplete
# installs (TS2307: Cannot find module ...).
RUN --mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @versigo/api... --prod=false

# ---- Build Stage ----
FROM base AS build
# `pnpm install --filter @versigo/api...` places the dependencies into the
# node_modules of the respective workspace packages (apps/api/node_modules,
# packages/foundation/node_modules) and links them into the store
# (node_modules/.pnpm). Copying only the root node_modules would omit the
# package node_modules; the build would then depend solely on NODE_PATH
# hoisting (.pnpm/node_modules), which is not guaranteed. Therefore the
# package node_modules are copied explicitly (self-contained build).
# Invariant: both directories are always materialized by the deps install
# (api and foundation have dependencies); the COPYs are unguarded.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/foundation/node_modules ./packages/foundation/node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/turbo.json ./turbo.json

COPY apps/api ./apps/api
COPY packages/foundation ./packages/foundation
COPY prisma ./prisma

# Generate Prisma Client for TypeScript compilation
RUN pnpm exec prisma generate --schema=prisma/schema.prisma && \
    pnpm run build --filter @versigo/api

# ---- Production Dependencies Stage (runtime deps only, no dev tools) ----
# `pnpm deploy` creates a self-contained directory with the project's
# production dependencies (including the packed @versigo/foundation and the
# generated @prisma/client; the Prisma CLI is devOnly since BugFix-10 #4 and
# is missing from the deploy output). Note: `pnpm install --prod` does not
# link top-level packages in pnpm 11.17.0 (regression), hence deploy instead
# of install.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
# Built foundation package (dist) for packing during deploy
COPY --from=build /app/packages/foundation ./packages/foundation
# BugFix-10 (#4): The Prisma client generated in the build stage (query engine +
# wasm + JS/typings, ~21 MB in total) is copied here and transferred into the
# store path of the deploy output during RUN. For a directory source, Docker
# copies its CONTENT, so the client files end up under
# /app/prisma-generated/client/.
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /app/prisma-generated/

RUN --mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm deploy --filter @versigo/api --prod --legacy /app/out && \
    # BugFix-10 (#4): TypeScript is no longer in the deploy output (it was only an
    # optional peer of the Prisma CLI) – the cleanup is defensive.
    rm -rf /app/out/node_modules/.pnpm/typescript@* /app/out/node_modules/typescript && \
    # BugFix-10 (#4): Copy the generated client from the build stage into the
    # store path. .pnpm/@prisma+client@*/node_modules/.prisma/client is the ONLY
    # path @prisma/client loads at runtime (the client has no own
    # dependencies, only peers).
    PRISMA_STORE_DIR="$(ls -d /app/out/node_modules/.pnpm/@prisma+client@*/node_modules | head -1)" && \
    mkdir -p "$PRISMA_STORE_DIR/.prisma" && \
    cp -a /app/prisma-generated/. "$PRISMA_STORE_DIR/.prisma/" && \
    # Runtime copy WITHOUT the Prisma CLI + schema engines. IMPORTANT: the
    # cleanup must happen BEFORE the COPY into the runner – a later `rm` in a
    # RUN layer would NOT reduce the image size because OCI layers keep
    # deleted files in the layer below (measured: 496 MB instead of ~340 MB).
    cp -a /app/out /app/out-runtime && \
    # BugFix-10 (#1): `prisma` is a devDependency; the CLI graph is missing
    # from the deploy output. The rm list is defensive: should the graph ever
    # be re-introduced (e.g. an accidental dependency), the size check in
    # review fails instead of silently growing.
    rm -rf /app/out-runtime/node_modules/.pnpm/prisma@* \
           /app/out-runtime/node_modules/prisma \
           /app/out-runtime/node_modules/.bin/prisma \
           /app/out-runtime/node_modules/.bin/prisma.cmd \
           /app/out-runtime/node_modules/@prisma/engines \
           /app/out-runtime/node_modules/.pnpm/@prisma+engines@* \
           /app/out-runtime/node_modules/.pnpm/effect@* \
           /app/out-runtime/node_modules/.pnpm/@prisma+config@*

# ---- Migration CLI Stage (BugFix-10 #4) ----
# The Prisma CLI is a devDependency and therefore NO LONGER included in the
# deploy output. The migration service therefore installs the CLI on its
# own. Deliberately in /opt/migrate (not /app): pnpm would otherwise modify
# the workspace root package.json. `--config.auto-install-peers=false`
# saves TypeScript (only needed for prisma.config.ts, which we do not use).
# package.json + pnpm-workspace.yaml are created upfront: pnpm 11 aborts
# `pnpm add` without an explicit build-script approval with exit code 1
# (ERR_PNPM_IGNORED_BUILDS for @prisma/engines + prisma); the approval is
# granted here only for the two required packages.
# Deterministic resolution: `pnpm add prisma@6.19.3` resolves the transitive
# CLI dependency without an own lockfile. This is deliberately accepted –
# prisma pins its direct dependencies (@prisma/*) to exact versions, and the
# image is a one-shot tool outside the workspace lockfile (a second
# lockfile root to maintain would be the higher maintenance cost).
FROM base AS migration-cli
WORKDIR /opt/migrate
# Same store cache as the api stages (deps/prod-deps): the install is cached
# across builds (store in the cache mount instead of in the layer).
RUN --mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store \
    printf '{\n  "name": "migration-cli",\n  "private": true\n}\n' > package.json && \
    printf 'allowBuilds:\n  "@prisma/engines": true\n  "prisma": true\n' > pnpm-workspace.yaml && \
    pnpm config set store-dir /pnpm/store && \
    pnpm add prisma@6.19.3 --prod --config.auto-install-peers=false

# ---- Migration Stage (compose service "migration", BugFix-07 Q6) ----
# One-shot execution of `prisma migrate deploy` – the canonical migration
# path on fresh clone/upgrade. Deliberately separate from the runtime
# runner: api/worker no longer contain the Prisma CLI.
FROM node:24-alpine AS migration
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production

# Prisma CLI + its dependencies (BugFix-10 #4): from the dedicated CLI stage,
# no longer from the prod-deps output.
COPY --chown=appuser:appgroup --from=migration-cli /opt/migrate/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=prod-deps /app/out/package.json ./package.json
COPY --chown=appuser:appgroup --from=build /app/prisma ./prisma

USER appuser

# Direct node invocation of the CLI (no npx) – no `prisma generate` needed
# in the runner: client generation happens in the build stage (BugFix-10 #4).
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema=/app/prisma/schema.prisma"]

# ---- Runner Stage ----
FROM node:24-alpine AS runner
RUN apk add --no-cache postgresql16-client
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

# Production dependencies (runtime only) – cleaned copy WITHOUT the Prisma CLI
# and schema engines (BugFix-07 Q6): the cleanup already happened in
# prod-deps BEFORE the COPY so the deleted packages never reach a runner
# layer (otherwise the image size would stay unchanged).
# --chown instead of a later `chown -R`: this saves a huge metadata layer in
# the image (chown -R over node_modules creates a layer the size of the
# content).
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/package.json ./package.json

# Prisma schema
COPY --chown=appuser:appgroup --from=build /app/prisma ./prisma

# Built application code (no source code)
COPY --chown=appuser:appgroup --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=appuser:appgroup --from=build /app/apps/api/package.json ./apps/api/package.json

COPY --chown=appuser:appgroup docker/start.sh ./start.sh

RUN chmod 755 ./start.sh

# BugFix-11: Create the uploads mount point as appuser before the container
# starts. Without this, a fresh named volume mounted at /data/uploads is
# auto-created by the container runtime as root:root, so the appuser cannot
# write to it (EACCES on POST .../documents). Docker/Podman copy-up preserves
# the image ownership for fresh named volumes. Existing deployments whose
# volume was already created as root must run a one-time chown (see
# docs/docker-image-guide.md section 5).
RUN mkdir -p /data/uploads && chown -R appuser:appgroup /data/uploads

USER appuser

EXPOSE 3001

CMD ["node", "apps/api/dist/apps/api/src/main.js"]

ENTRYPOINT ["/app/start.sh"]
