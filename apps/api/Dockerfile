# syntax=docker/dockerfile:1.7

# ============================================================
# API Service - Production Build
# ============================================================
# AP-20: Der Runner erhaelt ausschliesslich Produktions-Dependencies,
# gebaut per `pnpm deploy --prod` (keine Dev-Werkzeuge wie typescript,
# eslint, vitest, @nestjs/cli; Prisma-CLI + @prisma/client sind bewusst
# Laufzeit-Abhaengigkeiten, da docker/start.sh `prisma migrate deploy`
# ausfuehrt). Der volle Quellcode landet nicht im Runtime-Image.

# ---- Base Stage ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---- Dependencies Stage (alle Deps, nur fuer den Build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/foundation/package.json packages/foundation/package.json

RUN --mount=type=cache,id=versigo-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @versigo/api... --prod=false

# ---- Build Stage ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
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

# ---- Production Dependencies Stage (nur Laufzeit-Deps, keine Dev-Tools) ----
# `pnpm deploy` erzeugt ein eigenstaendiges Verzeichnis mit den
# Produktions-Dependencies des Projekts (inkl. gepacktem @versigo/foundation
# und Prisma-CLI). Hinweis: `pnpm install --prod` verlinkt in pnpm 11.17.0
# keine Top-Level-Pakete (Regression), daher deploy statt install.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
# Gebautes Foundation-Paket (dist) fuer das Packen beim Deploy
COPY --from=build /app/packages/foundation ./packages/foundation

RUN --mount=type=cache,id=versigo-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm deploy --filter @versigo/api --prod --legacy /app/out

# ---- Runner Stage ----
FROM node:24-alpine AS runner
RUN apk add --no-cache postgresql16-client
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

# Produktions-Dependencies (nur Laufzeit, inkl. Prisma-CLI fuer
# `npx prisma migrate deploy` in docker/start.sh)
COPY --from=prod-deps /app/out/node_modules ./node_modules
COPY --from=prod-deps /app/out/package.json ./package.json

# Prisma schema
COPY --from=build /app/prisma ./prisma

# Gebauter Anwendungscode (kein Quellcode)
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# Generate Prisma Client at image build time (ensures complete client with engine binary)
RUN node ./node_modules/prisma/build/index.js generate --schema=/app/prisma/schema.prisma

COPY docker/start.sh ./start.sh

RUN chmod 755 ./start.sh && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

CMD ["node", "apps/api/dist/apps/api/src/main.js"]

ENTRYPOINT ["/app/start.sh"]
