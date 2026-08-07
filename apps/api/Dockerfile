# syntax=docker/dockerfile:1.7

# ============================================================
# API Service - Production Build
# ============================================================
# AP-20: Der Runner erhaelt ausschliesslich Produktions-Dependencies,
# gebaut per `pnpm deploy --prod` (keine Dev-Werkzeuge wie typescript,
# eslint, vitest, @nestjs/cli).
# BugFix-07 (Q6): Die Prisma-CLI + Schema-Engines sind NICHT mehr Teil der
# Laufzeit-Images – Migrationen laufen ausschliesslich ueber den Compose-
# Service "migration" (Build-Target `migration` weiter unten). Der Runner
# enthaelt nur noch den generierten @prisma/client inkl. Query-Engine.
# BugFix-10 (#4): `prisma` ist eine devDependency (API, Worker, Foundation);
# der komplette CLI-Graph (prisma, @prisma/engines, effect, @prisma/config,
# ~134 MB) wird von `pnpm deploy --prod` nicht mehr in den Deploy-Output
# kopiert. Der generierte Client stammt aus dem Build-Stage; die CLI fuer
# den migration-Service wird eigenstaendig im Stage `migration-cli`
# installiert.

# ---- Base Stage ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---- Dependencies Stage (alle Deps, nur fuer den Build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/foundation/package.json packages/foundation/package.json

# Eigener Store-Cache je Service: Die CI baut api/web/worker parallel und
# ein geteilter Store (gleiche Cache-Mount-ID) fuehrt zu racemässig
# unvollstaendigen Installs (TS2307: Cannot find module ...).
RUN --mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @versigo/api... --prod=false

# ---- Build Stage ----
FROM base AS build
# `pnpm install --filter @versigo/api...` legt die Dependencies in die
# node_modules der jeweiligen Workspace-Pakete ab (apps/api/node_modules,
# packages/foundation/node_modules) und verlinkt sie in den Store
# (node_modules/.pnpm). Nur die Wurzel-node_modules zu kopieren wuerde die
# Paket-node_modules weglassen; der Build hinge dann allein vom NODE_PATH-
# Hoisting (.pnpm/node_modules) ab, das nicht garantiert ist. Daher werden
# die Paket-node_modules explizit mitkopiert (selbstenthaeltender Build).
# Invariante: beide Verzeichnisse werden vom deps-Install immer materialisiert
# (api und foundation haben Dependencies); die COPYs sind unguarded.
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

# ---- Production Dependencies Stage (nur Laufzeit-Deps, keine Dev-Tools) ----
# `pnpm deploy` erzeugt ein eigenstaendiges Verzeichnis mit den
# Produktions-Dependencies des Projekts (inkl. gepacktem @versigo/foundation
# und generiertem @prisma/client; die Prisma-CLI ist devOnly seit
# BugFix-10 #4 und fehlt im Deploy-Output). Hinweis: `pnpm install --prod`
# verlinkt in pnpm 11.17.0 keine Top-Level-Pakete (Regression), daher
# deploy statt install.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
# Gebautes Foundation-Paket (dist) fuer das Packen beim Deploy
COPY --from=build /app/packages/foundation ./packages/foundation
# BugFix-10 (#4): Der im Build-Stage generierte Prisma-Client (Query-Engine +
# wasm + JS/typings, insgesamt ~21 MB) wird hierher kopiert und im RUN in den
# Store-Pfad des Deploy-Outputs uebertragen. Docker kopiert bei einer
# Verzeichnis-Quelle deren INHALT, daher landen die Client-Dateien unter
# /app/prisma-generated/client/.
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /app/prisma-generated/

RUN --mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm deploy --filter @versigo/api --prod --legacy /app/out && \
    # BugFix-10 (#4): TypeScript ist nicht mehr im Deploy-Output (war nur ein
    # optionaler Peer der Prisma-CLI) – die Bereinigung ist defensiv.
    rm -rf /app/out/node_modules/.pnpm/typescript@* /app/out/node_modules/typescript && \
    # BugFix-10 (#4): Generierten Client aus dem Build-Stage in den
    # Store-Pfad kopieren. .pnpm/@prisma+client@*/node_modules/.prisma/client
    # ist der EINZIGE Pfad, den @prisma/client zur Laufzeit laedt (der Client
    # hat keine eigenen Dependencies, nur Peers).
    PRISMA_STORE_DIR="$(ls -d /app/out/node_modules/.pnpm/@prisma+client@*/node_modules | head -1)" && \
    mkdir -p "$PRISMA_STORE_DIR/.prisma" && \
    cp -a /app/prisma-generated/. "$PRISMA_STORE_DIR/.prisma/" && \
    # Laufzeit-Kopie OHNE Prisma-CLI + Schema-Engines. WICHTIG: Die
    # Bereinigung muss VOR dem COPY in den Runner passieren – ein spaeteres
    # `rm` in einer RUN-Schicht wuerde die Image-Groesse NICHT reduzieren,
    # da OCI-Layer geloeschte Dateien in der darunterliegenden Schicht
    # behalten (gemessen: 496 MB statt ~340 MB).
    cp -a /app/out /app/out-runtime && \
    # BugFix-10 (#1): `prisma` ist devDependency, der CLI-Graph fehlt im
    # Deploy-Output. Die rm-Liste ist defensiv: Sollte der Graph jemals
    # wieder eingeschleust werden (z.B. versehentliche Abhaengigkeit),
    # schlaegt die Groessenpruefung im Review fehl statt still zu wachsen.
    rm -rf /app/out-runtime/node_modules/.pnpm/prisma@* \
           /app/out-runtime/node_modules/prisma \
           /app/out-runtime/node_modules/.bin/prisma \
           /app/out-runtime/node_modules/.bin/prisma.cmd \
           /app/out-runtime/node_modules/@prisma/engines \
           /app/out-runtime/node_modules/.pnpm/@prisma+engines@* \
           /app/out-runtime/node_modules/.pnpm/effect@* \
           /app/out-runtime/node_modules/.pnpm/@prisma+config@*

# ---- Migration CLI Stage (BugFix-10 #4) ----
# Die Prisma-CLI ist eine devDependency und damit NICHT mehr im
# Deploy-Output enthalten. Der migration-Service installiert die CLI daher
# eigenstaendig. Bewusst in /opt/migrate (nicht /app): pnpm wuerde sonst die
# Root-package.json des Workspace veraendern. `--config.auto-install-peers=false`
# spart TypeScript ein (nur fuer prisma.config.ts noetig, das wir nicht
# verwenden).
# package.json + pnpm-workspace.yaml werden VORAB angelegt: pnpm 11 bricht
# `pnpm add` ohne explizite Build-Script-Freigabe mit Exit-Code 1 ab
# (ERR_PNPM_IGNORED_BUILDS fuer @prisma/engines + prisma); die Freigabe
# erfolgt hier nur fuer die zwei noetigen Pakete.
# Deterministische Aufloesung: `pnpm add prisma@6.19.3` loest die transitive
# CLI-Abhaengigkeit ohne eigenes Lockfile auf. Das ist bewusst akzeptiert –
# prisma pinnt seine direkten Dependencies (@prisma/*) auf exakte Versionen,
# und das Image ist ein One-Shot-Werkzeug ausserhalb des Workspace-Lockfiles
# (eine zweite, mitzupflegende Lockfile-Wurzel ist der hoehere Wartungsaufwand).
FROM base AS migration-cli
WORKDIR /opt/migrate
# Gleicher Store-Cache wie die api-Stages (deps/prod-deps): das Install wird
# ueber Builds hinweg gecacht (Store im Cache-Mount statt in der Schicht).
RUN --mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store \
    printf '{\n  "name": "migration-cli",\n  "private": true\n}\n' > package.json && \
    printf 'allowBuilds:\n  "@prisma/engines": true\n  "prisma": true\n' > pnpm-workspace.yaml && \
    pnpm config set store-dir /pnpm/store && \
    pnpm add prisma@6.19.3 --prod --config.auto-install-peers=false

# ---- Migration Stage (Compose-Service "migration", BugFix-07 Q6) ----
# One-shot-Ausfuehrung von `prisma migrate deploy` – der kanonische
# Migrationspfad bei Fresh-Clone/Upgrade. Bewusst vom Laufzeit-Runner
# getrennt: api/worker enthalten die Prisma-CLI nicht mehr.
FROM node:24-alpine AS migration
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production

# Prisma-CLI + ihre Dependencies (BugFix-10 #4): aus dem eigenen CLI-Stage,
# nicht mehr aus dem prod-deps-Output.
COPY --chown=appuser:appgroup --from=migration-cli /opt/migrate/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=prod-deps /app/out/package.json ./package.json
COPY --chown=appuser:appgroup --from=build /app/prisma ./prisma

USER appuser

# Direkter Node-Aufruf der CLI (kein npx) – kein `prisma generate` im
# Runner noetig: die Client-Generierung laeuft im Build-Stage (BugFix-10 #4).
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema=/app/prisma/schema.prisma"]

# ---- Runner Stage ----
FROM node:24-alpine AS runner
RUN apk add --no-cache postgresql16-client
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

# Produktions-Dependencies (nur Laufzeit) – bereinigte Kopie OHNE Prisma-CLI
# und Schema-Engines (BugFix-07 Q6): die Bereinigung passierte bereits in
# prod-deps VOR dem COPY, damit die geloeschten Pakete nie in einen
# Runner-Layer gelangen (sonst bliebe die Image-Groesse unveraendert).
# --chown statt nachtraeglichem `chown -R`: das erspart eine riesige
# Metadaten-Layer-Schicht im Image (chown -R ueber node_modules erzeugt
# einen Layer in der Groesse des Inhalts).
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=prod-deps /app/out-runtime/package.json ./package.json

# Prisma schema
COPY --chown=appuser:appgroup --from=build /app/prisma ./prisma

# Gebauter Anwendungscode (kein Quellcode)
COPY --chown=appuser:appgroup --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=appuser:appgroup --from=build /app/apps/api/package.json ./apps/api/package.json

COPY --chown=appuser:appgroup docker/start.sh ./start.sh

RUN chmod 755 ./start.sh

USER appuser

EXPOSE 3001

CMD ["node", "apps/api/dist/apps/api/src/main.js"]

ENTRYPOINT ["/app/start.sh"]
