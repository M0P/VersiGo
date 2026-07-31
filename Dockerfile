# ============================================================
# Stage 1: Deps – install all dependencies (cached via lockfile)
# ============================================================
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# Copy dependency manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy workspace package manifests (needed so pnpm resolves workspace deps)
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/foundation/package.json packages/foundation/package.json

RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: Build – compile all apps
# ============================================================
FROM node:24-alpine AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# Copy deps (node_modules from previous stage)
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=deps /app/turbo.json /app/turbo.json

# Copy source code (including eslint config and other root-level configs)
COPY apps/ apps/
COPY packages/ packages/
COPY prisma/ prisma/
COPY eslint.config.mjs eslint.config.mjs

# Generate Prisma client and build all apps
RUN npx prisma generate
RUN pnpm run build

# ============================================================
# Stage 3: Runner – minimal production image
# ============================================================
FROM node:24-alpine AS runner

# Install PostgreSQL client for wait/health checks
RUN apk add --no-cache postgresql16-client

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Point Node.js to the pnpm virtual store so all dependencies are
# resolvable at runtime without needing per-app node_modules symlinks.
ENV NODE_PATH=/app/node_modules/.pnpm/node_modules

# Copy node_modules from deps stage (includes all deps, including dev)
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=deps /app/turbo.json /app/turbo.json

# Copy Prisma schema and migrations
COPY --from=build /app/prisma /app/prisma

# Copy built artifacts
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/apps/web/.next /app/apps/web/.next
COPY --from=build /app/apps/web/public /app/apps/web/public
COPY --from=build /app/apps/web/package.json /app/apps/web/package.json
COPY --from=build /app/apps/worker/dist /app/apps/worker/dist
COPY --from=build /app/apps/worker/package.json /app/apps/worker/package.json

# Copy packages (needed for workspace dependency resolution)
COPY --from=build /app/packages /app/packages

# Create workspace package symlinks so the compiled JS can resolve
# workspace dependencies like @insura/foundation at runtime via
# Node.js module resolution (pnpm only creates these per-app, not
# at the root level where our runtime CWD sits).
RUN mkdir -p /app/node_modules/@insura && \
    ln -sfn /app/packages/foundation /app/node_modules/@insura/foundation && \
    ln -sfn /app/apps/api /app/node_modules/@insura/api && \
    ln -sfn /app/apps/worker /app/node_modules/@insura/worker && \
    ln -sfn /app/apps/web /app/node_modules/@insura/web

# Regenerate Prisma client to ensure native binaries match runner architecture
RUN npx prisma generate

# Copy start script
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Make the whole app directory writable for the non-root runtime user.
# Next.js writes cache/artefact directories and the worker/API may write
# runtime data – without this the container start fails with EACCES
# (observed: `permission denied, open /app/_tmp_...`).
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

EXPOSE 3000 3001

ENTRYPOINT ["/app/start.sh"]
