# syntax=docker/dockerfile:1.7

# ============================================================
# Web Service (Next.js) - Production Build
# ============================================================

# ---- Base Stage ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---- Dependencies Stage ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json

# Dedicated store cache per service: CI builds api/web/worker in parallel
# and a shared store (same cache mount ID) leads to racy/incomplete installs.
RUN --mount=type=cache,id=versigo-pnpm-store-web,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod=false

# ---- Build Stage ----
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/turbo.json ./turbo.json

COPY apps/web ./apps/web

# BugFix-07 (Q7b): branding override. Files in the repo folder `branding/`
# (icon.svg / favicon.svg) override the default assets in
# apps/web/public/branding/ directly in the build – an own icon requires a
# rebuild, not a source-code change.
COPY branding/ ./apps/web/public/branding/

# License-compliance (third-party notices): Next.js standalone output only
# traces runtime-needed files and drops the LICENSE/NOTICE files of the
# packages it bundles (next, react, sharp, libvips/LGPL, ...). Collect them
# into the standalone tree so the runner image ships the required license
# texts. The policy/allowlist lives in scripts/dependency-licenses.mjs.
COPY scripts/dependency-licenses.mjs scripts/dependency-licenses.mjs

RUN --mount=type=cache,id=versigo-pnpm-store-web,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    cd apps/web && pnpm run build && \
    node ../../scripts/dependency-licenses.mjs collect \
      --pnpm-dir /app/node_modules/.pnpm \
      --out /app/apps/web/.next/standalone/THIRD_PARTY_LICENSES

# ---- Runner Stage ----
FROM node:24-alpine AS runner
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production

# Next.js standalone binds to process.env.HOSTNAME || '0.0.0.0'.
# Docker/Podman set HOSTNAME to the container ID, so the server binds to
# the bridge IP instead of 0.0.0.0 and the healthcheck against
# localhost:3000 never succeeds. Therefore HOSTNAME is fixed to 0.0.0.0 here.
ENV HOSTNAME=0.0.0.0

# Copy standalone output (includes node_modules, .next, public)
# Next.js standalone output in a monorepo has a nested structure:
# standalone/apps/web/server.js + standalone/node_modules/.pnpm/...
# --chown instead of a later `chown -R /app`: this saves a metadata layer the
# size of the content in the runner image.
COPY --chown=appuser:appgroup --from=build /app/apps/web/.next/standalone ./
COPY --chown=appuser:appgroup --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=appuser:appgroup --from=build /app/apps/web/public ./apps/web/public

# Copy entrypoint script
COPY --chown=appuser:appgroup apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER appuser

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "apps/web/server.js"]