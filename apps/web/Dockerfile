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

RUN --mount=type=cache,id=versigo-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @versigo/web... --prod=false

# ---- Build Stage ----
FROM base AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/turbo.json ./turbo.json

COPY apps/web ./apps/web

RUN --mount=type=cache,id=versigo-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm run build --filter @versigo/web

# ---- Runner Stage ----
FROM node:24-alpine AS runner
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production

# Next.js standalone bindet an process.env.HOSTNAME || '0.0.0.0'.
# Docker/Podman setzen HOSTNAME auf die Container-ID, wodurch der Server
# an die Bridge-IP statt an 0.0.0.0 bindet und der Healthcheck gegen
# localhost:3000 nie greift. Daher HOSTNAME hier fest auf 0.0.0.0 setzen.
ENV HOSTNAME=0.0.0.0

# Copy standalone output (includes node_modules, .next, public)
# Next.js standalone output in a monorepo has a nested structure:
# standalone/apps/web/server.js + standalone/node_modules/.pnpm/...
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["node", "apps/web/server.js"]