# syntax=docker/dockerfile:1.7

# ============================================================
# Worker Service - Production Build
# ============================================================
# AP-20: Der Runner erhaelt ausschliesslich Produktions-Dependencies,
# gebaut per `pnpm deploy --prod` (keine Dev-Werkzeuge).
# BugFix-07 (Q6): Die Prisma-CLI + Schema-Engines sind NICHT mehr Teil der
# Laufzeit-Images – Migrationen laufen ausschliesslich ueber den Compose-
# Service "migration". Der Runner enthaelt nur noch den generierten
# @prisma/client inkl. Query-Engine.
# BugFix-10 (#4): `prisma` ist eine devDependency (API, Worker, Foundation);
# der komplette CLI-Graph (~134 MB) wird von `pnpm deploy --prod` nicht mehr
# in den Deploy-Output kopiert. Der generierte Client stammt aus dem
# Build-Stage.

# ---- Base Stage ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---- Dependencies Stage (alle Deps, nur fuer den Build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/foundation/package.json packages/foundation/package.json

# Eigener Store-Cache je Service: Die CI baut api/web/worker parallel und
# ein geteilter Store (gleiche Cache-Mount-ID) fuehrt zu racemässig
# unvollstaendigen Installs (TS2307: Cannot find module ...).
RUN --mount=type=cache,id=versigo-pnpm-store-worker,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @versigo/worker... --prod=false

# ---- Build Stage ----
FROM base AS build
# `pnpm install --filter @versigo/worker...` legt die Dependencies in die
# node_modules der jeweiligen Workspace-Pakete ab (apps/worker/node_modules,
# packages/foundation/node_modules) und verlinkt sie in den Store
# (node_modules/.pnpm). Nur die Wurzel-node_modules zu kopieren wuerde die
# Paket-node_modules weglassen; der Build hinge dann allein vom NODE_PATH-
# Hoisting (.pnpm/node_modules) ab, das nicht garantiert ist. Daher werden
# die Paket-node_modules explizit mitkopiert (selbstenthaeltender Build).
# Invariante: beide Verzeichnisse werden vom deps-Install immer materialisiert
# (worker und foundation haben Dependencies); die COPYs sind unguarded.
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

# ---- Production Dependencies Stage (nur Laufzeit-Deps, keine Dev-Tools) ----
# Siehe apps/api/Dockerfile: `pnpm deploy` statt `pnpm install --prod`
# (pnpm-11-Regression bei install --prod: keine Top-Level-Verknuepfungen).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
# Gebautes Foundation-Paket (dist) fuer das Packen beim Deploy
COPY --from=build /app/packages/foundation ./packages/foundation
# BugFix-10 (#4): Der im Build-Stage generierte Prisma-Client wird hierher
# kopiert und im RUN in den Store-Pfad des Deploy-Outputs uebertragen
# (Docker kopiert bei einer Verzeichnis-Quelle deren INHALT).
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /app/prisma-generated/

RUN --mount=type=cache,id=versigo-pnpm-store-worker,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm deploy --filter @versigo/worker --prod --legacy /app/out && \
    # BugFix-10 (#4): TypeScript ist nicht mehr im Deploy-Output (war nur ein
    # optionaler Peer der Prisma-CLI) – die Bereinigung ist defensiv.
    rm -rf /app/out/node_modules/.pnpm/typescript@* /app/out/node_modules/typescript && \
    # BugFix-10 (#4): Generierten Client aus dem Build-Stage in den
    # Store-Pfad kopieren. Der Store-Eintrag stammt aus dem gepackten
    # Foundation-Paket (Worker hat kein direktes @prisma/client-Dependency);
    # .pnpm/@prisma+client@*/node_modules/.prisma/client ist der EINZIGE
    # Pfad, den @prisma/client zur Laufzeit laedt. Der Runner verknuepft den
    # Store-Pfad zusaetzlich top-level (Symlink weiter unten).
    PRISMA_STORE_DIR="$(ls -d /app/out/node_modules/.pnpm/@prisma+client@*/node_modules | head -1)" && \
    mkdir -p "$PRISMA_STORE_DIR/.prisma" && \
    cp -a /app/prisma-generated/. "$PRISMA_STORE_DIR/.prisma/" && \
    # Laufzeit-Kopie OHNE Prisma-CLI + Schema-Engines (Bereinigung VOR dem
    # COPY in den Runner – sonst wuerde die Image-Groesse nicht sinken).
    cp -a /app/out /app/out-runtime && \
    # BugFix-10 (#1): defensiv – der CLI-Graph ist devOnly und fehlt im
    # Deploy-Output; eine Wiedereinschleusung wuerde sonst unerkannt wachsen.
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
RUN apk add --no-cache postgresql16-client
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

# Produktions-Dependencies (nur Laufzeit) – bereinigte Kopie OHNE Prisma-CLI
# und Schema-Engines (BugFix-07 Q6, Bereinigung erfolgte in prod-deps).
# --chown statt nachtraeglichem `chown -R`: das erspart eine riesige
# Metadaten-Layer-Schicht im Image (chown -R ueber node_modules erzeugt
# einen Layer in der Groesse des Inhalts).
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/package.json ./package.json

# Prisma schema
COPY --chown=appuser:appgroup --from=build /app/prisma ./prisma

# Gebauter Anwendungscode (kein Quellcode)
COPY --chown=appuser:appgroup --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --chown=appuser:appgroup --from=build /app/apps/worker/package.json ./apps/worker/package.json

# @prisma/client ist im Worker-Deploy nur ueber das gepackte Foundation-Paket
# verfuegbar (kein Top-Level-Link, da kein direktes Dependency) – daher wird
# der Store-Pfad zur Laufzeit top-level verknuepft. Der generierte Client
# (Query-Engine) wurde bereits in prod-deps aus dem Build-Stage in den Store
# kopiert (BugFix-10 #4).
RUN mkdir -p /app/node_modules/@prisma && \
    ln -sfn "$(ls -d /app/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client | head -1)" /app/node_modules/@prisma/client

COPY --chown=appuser:appgroup docker/start.sh ./start.sh

RUN chmod 755 ./start.sh

USER appuser

EXPOSE 3100

CMD ["node", "apps/worker/dist/apps/worker/src/main.js"]

ENTRYPOINT ["/app/start.sh"]
