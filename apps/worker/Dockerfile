# syntax=docker/dockerfile:1.7

# ============================================================
# Worker Service - Production Build
# ============================================================
# AP-20: Der Runner erhaelt ausschliesslich Produktions-Dependencies,
# gebaut per `pnpm deploy --prod` (keine Dev-Werkzeuge; Prisma-CLI +
# @prisma/client sind bewusst Laufzeit-Abhaengigkeiten, da
# docker/start.sh `prisma migrate deploy` ausfuehrt). Der volle
# Quellcode landet nicht im Runtime-Image.

# ---- Base Stage ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---- Dependencies Stage (alle Deps, nur fuer den Build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/foundation/package.json packages/foundation/package.json

RUN --mount=type=cache,id=versigo-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @versigo/worker... --prod=false

# ---- Build Stage ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
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

# ---- Production Dependencies Stage (nur Laufzeit-Deps, keine Dev-Tools) ----
# Siehe apps/api/Dockerfile: `pnpm deploy` statt `pnpm install --prod`
# (pnpm-11-Regression bei install --prod: keine Top-Level-Verknuepfungen).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
# Gebautes Foundation-Paket (dist) fuer das Packen beim Deploy
COPY --from=build /app/packages/foundation ./packages/foundation

RUN --mount=type=cache,id=versigo-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm deploy --filter @versigo/worker --prod --legacy /app/out && \
    # TypeScript ist bei prisma nur ein optionaler Peer (wird nur fuer
    # prisma.config.ts benoetigt, das wir nicht verwenden) und nicht Teil
    # der Laufzeit-Dependencies. Entfernen spart ~23 MB im Runner-Image.
    rm -rf /app/out/node_modules/.pnpm/typescript@* /app/out/node_modules/typescript

# ---- Runner Stage ----
FROM node:24-alpine AS runner
RUN apk add --no-cache postgresql16-client
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

# Produktions-Dependencies (nur Laufzeit, inkl. Prisma-CLI fuer
# `npx prisma migrate deploy` in docker/start.sh)
# --chown statt nachtraeglichem `chown -R`: das erspart eine riesige
# Metadaten-Layer-Schicht im Image (chown -R ueber node_modules erzeugt
# einen Layer in der Groesse des Inhalts).
COPY --chown=appuser:appgroup --from=prod-deps /app/out/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=prod-deps /app/out/package.json ./package.json

# Prisma schema
COPY --chown=appuser:appgroup --from=build /app/prisma ./prisma

# Gebauter Anwendungscode (kein Quellcode)
COPY --chown=appuser:appgroup --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --chown=appuser:appgroup --from=build /app/apps/worker/package.json ./apps/worker/package.json

# Generate Prisma Client at image build time (ensures complete client with engine binary).
# @prisma/client ist im Worker-Deploy nur ueber das gepackte Foundation-Paket
# verfuegbar (kein Top-Level-Link, da kein direktes Dependency) — daher wird
# zunaechst der Store-Pfad verknuepft, damit `prisma generate` den Client findet.
# Die generierten Client-Dateien werden anschliessend gezielt auf den appuser
# gechownt (kein vollstaendiges `chown -R /app`).
RUN mkdir -p /app/node_modules/@prisma && \
    ln -sfn "$(ls -d /app/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client | head -1)" /app/node_modules/@prisma/client && \
    node ./node_modules/prisma/build/index.js generate --schema=/app/prisma/schema.prisma && \
    chown -R appuser:appgroup /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /app/node_modules/.prisma 2>/dev/null || true

COPY --chown=appuser:appgroup docker/start.sh ./start.sh

RUN chmod 755 ./start.sh

USER appuser

EXPOSE 3100

CMD ["node", "apps/worker/dist/apps/worker/src/main.js"]

ENTRYPOINT ["/app/start.sh"]
