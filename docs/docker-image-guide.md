# Docker Image Guide – Build, Tag, Push, Deploy, Upgrade, Rollback, Restore

**Version:** 1.4.0 (BugFix-10)  
**Date:** 2026-08-07  
**Applies to:** `versigo-api`, `versigo-worker`, `versigo-web` (and `versigo-test` for CI, `versigo-migration`)

---

## 1. Overview

VersiGo is built as **four runtime images** that contain **production
dependencies only** (AP-20, BugFix-04, BugFix-07 Q6, BugFix-10):

| Image | Dockerfile | Base | Contents | Size (BugFix-10) |
|-------|------------|-------|----------|-------------------|
| `versigo-api` | `apps/api/Dockerfile` | `node:24-alpine` | NestJS build (`dist`), generated `@prisma/client` (query engine only), `postgresql16-client`, `docker/start.sh` | **~339 MB** |
| `versigo-worker` | `apps/worker/Dockerfile` | `node:24-alpine` | BullMQ worker build (`dist`), generated `@prisma/client` (query engine only), `postgresql16-client`, `docker/start.sh` | **~333 MB** |
| `versigo-web` | `apps/web/Dockerfile` | `node:24-alpine` | Next.js `output: "standalone"` + branding assets | **~206 MB** |
| `versigo-migration` | `apps/api/Dockerfile` (`target: migration`) | `node:24-alpine` | Prisma CLI + schema + migrations (`prisma migrate deploy`), one-shot | **~297 MB** |

**Before/After (AP-20 → BugFix-04 → BugFix-07 → BugFix-10):**

| Image | Before AP-20 | After AP-20 | After BugFix-04 | After BugFix-07 | After BugFix-10 |
|-------|--------------|-------------|-----------------|-----------------|-----------------|
| `versigo-api` | 1.12 GB (incl. dev tools) | ~839 MB | ~493 MB | ~371 MB | **~339 MB** |
| `versigo-worker` | 1.12 GB (incl. dev tools) | ~828 MB | ~487 MB | ~365 MB | **~333 MB** |
| `versigo-web` | 240 MB | 240 MB | ~207 MB | ~207 MB | **~206 MB** |
| `versigo-migration` | – | – | – | ~431 MB | **~297 MB** |

### Why so slim?

- The runner stage copies **only** the production dependencies. This uses
  `pnpm deploy --filter @versigo/<app> --prod --legacy` (creates a standalone
  directory with runtime deps including the packed `@versigo/foundation`).
- No TypeScript, no ESLint, no Vitest, no `@nestjs/cli`, no source code in the
  runtime image.
- **BugFix-07 (Q6):** The Prisma **CLI + schema engines** are no longer part
  of the api/worker runtime images (saves ~125 MB per image, measured).
  Migrations run exclusively via the Compose service `migration`, which builds
  the dedicated `migration` target of `apps/api/Dockerfile`. The api/worker
  runners contain only the **generated `@prisma/client`** with its query
  engine.
  **Implementation detail:** the pruning happens in the `prod-deps` stage
  **before** the `COPY` into the runner (`cp -a` of the deploy output into
  `out-runtime`, then removal of `prisma@*` / `@prisma/engines@*`). A later
  `rm` in a RUN layer would **not** reduce the image size, because OCI layers
  retain deleted files in lower layers (measured: 496 MB without the early
  pruning).
- **BugFix-10 (#4):** `prisma` is now a **devDependency** of api/worker/foundation,
  so the whole CLI graph (`prisma`, `@prisma/engines`, `effect`, `@prisma/config`
  – ~134 MB) is no longer copied into the deploy output at all. The generated
  client is created in the **build** stage (`prisma generate`) and copied from
  there into the store of the deploy output (`.pnpm/@prisma+client@*/node_modules/.prisma/client`
  – the only path the client loads at runtime; the client has no runtime
  dependencies of its own, only peers). The `migration` image gets its CLI from
  a dedicated `migration-cli` stage (`pnpm add prisma@6.19.3 --prod` in
  `/opt/migrate`). The out-runtime cleanup additionally removes `effect@*` and
  `@prisma+config@*` **defensively**, so a future reintroduction of the CLI
  graph fails the size check instead of growing the images silently
  (BugFix-10 #1, saves ~31 MB per image, measured).
- The Prisma client is generated **at image build time**
  (`prisma generate --schema=/app/prisma/schema.prisma`) so the image contains
  the full client with the query engine.
- Note: `pnpm install --prod` does not link top-level packages in pnpm
  11.17.0 (regression) – therefore `pnpm deploy` is used (see comment in the
  Dockerfiles).
- **Runtime network access (AP-20 P1):** The production images need **no
  uncontrolled network access** at runtime. API/worker only talk to DB,
  Redis and – only if configured – the optional external integrations.
  Build-time dependencies are pinned reproducibly via the pnpm lockfile
  (frozen lockfile); the Prisma engines are downloaded **during the build**,
  not at runtime.

---

## 2. Prerequisites

- Docker Engine 24+ **or** Podman 5+ with a docker-compose-compatible wrapper
- 4 GB+ RAM, 10 GB+ free disk space (the build phase needs the pnpm store)
- `.env` copied from `.env.example`

---

## 3. Build

### 3.1 Via Docker Compose (recommended)

```bash
docker compose build api worker web
# or build and start all services:
docker compose up --build -d
```

### 3.2 Manually with Podman/Docker

```bash
podman build -f apps/api/Dockerfile    -t versigo-api:latest    .
podman build -f apps/worker/Dockerfile -t versigo-worker:latest .
podman build -f apps/web/Dockerfile    -t versigo-web:latest    .
# migration service (Prisma CLI) – builds the `migration` target of the API Dockerfile:
podman build --target migration -f apps/api/Dockerfile -t versigo-migration:latest .
```

> **Podman note:** `docker compose up --build` **alone** is not enough on
> machines with podman-compose – existing containers stay pinned to the
> **old image ID**. Before a restart:
> `docker compose down` (or `docker compose down -v`), then `up --build`.

### 3.3 Build duration

- Clean build (no cache): ~8–10 min for all three images (measured AP-20).
- Incremental builds with the pnpm store cache (`--mount=type=cache`) are
  significantly faster.

### 3.4 Supported architectures & multi-platform build (Buildx)

- **Primarily supported and tested:** `linux/amd64` (measured AP-20, CI,
  Compose smoke).
- The base images (`node:24-alpine`) are available as multi-arch manifests
  (`linux/amd64`, `linux/arm64`); the Dockerfiles contain no
  platform-specific commands. An `arm64` image is therefore buildable in
  principle, but was **not** verified in AP-20.
- **Optional multi-platform build with Docker Buildx** (not a required path,
  no CI job):

  ```bash
  docker buildx create --use          # once
  docker buildx build --platform linux/amd64,linux/arm64 \
    -f apps/api/Dockerfile -t versigo-api:latest . \
    --push                            # push to a registry (OCI compatible)
  # analogous for worker + web
  ```

  Without `--push` the result stays in the Buildx cache and can only be used
  directly with `docker buildx` (not with classic `docker run`).

---

## 4. Tag & Push

### 4.1 Public registry images (Docker Hub)

Since **BugFix-09**, the GitHub workflow `.github/workflows/publish.yml`
automatically builds and pushes all production images to **Docker Hub** when a
version tag (`v*`) is pushed (or manually via `workflow_dispatch`). The images
are published as:

- `<namespace>/versigo-api:<version>` + `<namespace>/versigo-api:latest`
- `<namespace>/versigo-worker:<version>` + `<namespace>/versigo-worker:latest`
- `<namespace>/versigo-web:<version>` + `<namespace>/versigo-web:latest`
- `<namespace>/versigo-migration:<version>` + `<namespace>/versigo-migration:latest`

where `<version>` is the tag without the `v` prefix (e.g. tag `v1.2.3` ->
version `1.2.3`) and `<namespace>` is the Docker Hub namespace configured in
the workflow (`DOCKERHUB_NAMESPACE`, currently `m000p`). The workflow requires
the GitHub secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.

Deployment without rebuilding the images uses
`docker-compose.dockerhub.yml` (see README "Quick start").

### 4.2 Manual tag & push (own registry)

Convention: `<registry>/versigo-<service>:<tag>`, where `<tag>` is either
`latest` (development) or a version tag such as `1.0.0-beta`.

```bash
REGISTRY=docker.io/your-user   # or your own container registry
TAG=1.0.0-beta

podman tag versigo-api:latest    "$REGISTRY/versigo-api:$TAG"
podman tag versigo-worker:latest "$REGISTRY/versigo-worker:$TAG"
podman tag versigo-web:latest    "$REGISTRY/versigo-web:$TAG"
podman tag versigo-migration:latest "$REGISTRY/versigo-migration:$TAG"

podman push "$REGISTRY/versigo-api:$TAG"
podman push "$REGISTRY/versigo-worker:$TAG"
podman push "$REGISTRY/versigo-web:$TAG"
podman push "$REGISTRY/versigo-migration:$TAG"
```

Also push the `latest` tags if the operating environment pulls without a
version tag:

```bash
podman tag versigo-api:latest "$REGISTRY/versigo-api:latest"
podman push "$REGISTRY/versigo-api:latest"
# analogous for worker + web + migration
```

> The CI (`.github/workflows/ci.yml`) does **not** run the build-metrics job
> blockingly; the publish workflow (`.github/workflows/publish.yml`) builds
> and pushes the tags to Docker Hub automatically on version release.

---

## 5. Deploy (Fresh installation)

```bash
git clone <repo> versigo && cd versigo
cp .env.example .env
# adjust .env (mandatory):
#   1. NODE_ENV=production        <- central, see note below
#   2. VERSIGO_HOST, APP_PORT, WEB_PORT  <- public host + ports (single source,
#      see note below)
#   3. DATABASE_URL, REDIS_URL, SESSION_SECRET, SETTINGS_ENCRYPTION_KEY
#   4. Auth configuration (LOCAL_AUTH_ENABLED / OIDC_ENABLED)
docker compose up --build -d
```

> **Public URLs:** `CORS_ORIGINS` and `OIDC_CALLBACK_URL` are derived in the
> Compose files from `VERSIGO_HOST` (default `localhost`) plus
> `APP_PORT`/`WEB_PORT`. `NEXT_PUBLIC_API_BASE_URL` is **auto-detected in the
> browser** (BugFix-14): with direct IP/HTTP access the web app calls
> `http://<host>:<APP_PORT>` (only the port differs from the web port), with
> HTTPS via a reverse proxy it calls `https://<host>/api` (the proxy strips
> the `/api` prefix). One deployment therefore works over both access paths.
> Only set the variables explicitly when the proxy uses a different public
> URL (e.g. `https://app.example.com`).
>
> **Reverse proxy (Caddy) with dual access (BugFix-14):** to serve the stack
> over HTTPS while keeping direct IP/HTTP access working, route the API
> through the same host under the `/api` prefix and set `TRUST_PROXY=true`:
>
> ```caddyfile
> versicherung.home {
>     tls internal
>     handle /api/* {
>         uri strip_prefix /api
>         reverse_proxy api:3001
>     }
>     handle {
>         reverse_proxy web:3000
>     }
> }
> ```
>
> `.env` for this setup:
>
> ```env
> VERSIGO_HOST=192.168.24.8      # direct-IP access
> APP_PORT=2669
> WEB_PORT=2670
> CORS_ORIGINS=http://192.168.24.8:2670,https://versicherung.home
> TRUST_PROXY=true
> # NEXT_PUBLIC_API_BASE_URL unset -> browser auto-detects
> # COOKIE_SECURE unset -> per-request "auto" (Secure only over HTTPS)
> # OIDC_CALLBACK_URL=https://versicherung.home/api/auth/callback  (only with OIDC)
> ```
>
> Caddy must be attached to the same Docker network as the `web`/`api`
> containers. An API subdomain (`api.versicherung.home`) does **not** work:
> the session cookies use `SameSite=Lax`, and `.home` is not on the Public
> Suffix List, so the browser treats the subdomain as cross-site and would
> not send the session cookie on API requests.
>
> **Important (AP-20, `NODE_ENV=production`):** `.env.example` sets
> `NODE_ENV=development` (local development mode). For
> beta/production operation **`NODE_ENV=production` must be set explicitly**
> in the `.env` – only then do the security guarantees apply: no
> automatically created default admin, rejection of the
> `.env.example` placeholder password, session cookie with the `Secure` flag
> and auth fail-fast at startup. The Compose smoke test verifies this
> production path (step 12).
>
> `COOKIE_SECURE` (secure flag of the session cookie) is **`auto` per
> request** when unset (BugFix-14): the cookie gets the `Secure` flag only
> when the request arrived over HTTPS (needs `TRUST_PROXY=true` behind the
> proxy). Over plain HTTP the cookie stays plain, so both access modes work
> with one deployment and the old symptom "login succeeds but redirects back
> to the login page" (Secure cookie silently dropped over HTTP) no longer
> occurs. Set `COOKIE_SECURE=true`/`false` explicitly only to force the flag,
> e.g. `COOKIE_SECURE=false` when the API itself is deliberately served over
> plain HTTP in production without a proxy.
>
> The initial administrator is **never created automatically**. For the
> first start, `LOCAL_AUTH_ENABLED=true` and your own strong
> `LOCAL_ADMIN_PASSWORD` (not the `.env.example` placeholder, which is
> rejected in production) must be set. The API then creates the admin plus
> the reference household `default` exactly once; afterwards further
> accounts can be enabled via `/admin/users`.
>
> **Pure OIDC operation:** OIDC does not provision accounts and
> `LOCAL_ADMIN_*` has no effect while `LOCAL_AUTH_ENABLED=false`
> (or unset in production). For the first start you must therefore
> additionally set `LOCAL_AUTH_ENABLED=true` with your own strong
> `LOCAL_ADMIN_PASSWORD` so that the initial admin and the
> household `default` are created. Only afterwards can local
> authentication be disabled again.

On first start:
1. `db` → migrations via the one-shot service `migration` (`prisma migrate deploy`)
2. `api`/`worker` → `docker/start.sh` waits for the DB **and** for the applied
   migrations (the `migration` service), then starts
3. `web` → starts after the API health check

> **BugFix-11 (uploads volume ownership):** Since BugFix-11 the api/worker
> images create `/data/uploads` with `appuser` ownership at build time, so
> fresh named volumes (`uploads-data`) inherit `appuser` ownership on first
> start (Docker/Podman copy-up preserves the image ownership). Deployments
> that already created the volume **before** BugFix-11 must fix the ownership
> once, otherwise document uploads fail with `EACCES`:
>
> ```bash
> # Find the volume path (podman: podman volume inspect versigo_uploads-data --format '{{.Mountpoint}}')
> podman unshare chown 100:101 <volume>/_data
> # docker (rootful): chown -R 100:101 <volume>/_data
> docker compose restart api worker
> ```
>
> The Compose smoke test verifies the uploads directory is writable inside
> the API container (step 4b).

> **BugFix-07 (Q6):** `docker/start.sh` no longer runs `prisma migrate deploy`
> itself — the api/worker runtime images do not contain the Prisma CLI. The
> Compose `migration` service is the **canonical** migration path; the start
> script only verifies that migrations have been applied before starting the
> process (race protection on fresh clones).

Verification:

```bash
docker compose ps
curl http://localhost:3001/health   # {"status":"ok"}
curl http://localhost:3000/         # HTTP 200
./scripts/compose-smoke-test.sh     # complete smoke test
```

---

## 6. Upgrade

```bash
git pull                        # fetch the new code
docker compose down             # stop containers (data stays in volumes)
docker compose build api worker web migration   # build the new images
docker compose up -d            # start; the migration service runs migrations
```

Important:

- **Idempotent migrations:** `prisma migrate deploy` runs in the `migration`
  service at every start and only applies pending migrations. A restart after
  a partial upgrade is not critical.
- **No automatic backward migrations** (downgrade DB migrations are not
  provided). For rollback, restore a backup instead (section 8).
- **Podman machines:** always run `docker compose down` before `up`,
  otherwise containers stay on old image IDs (section 3.2).

---

## 7. Rollback (Image level)

If a new image is broken:

```bash
# Go back to the last working state (image tag only),
# provided the Compose file uses external tags:
docker compose down
# point the image tag in docker-compose.yml / .env at the last
# working version (e.g. IMAGE_TAG=v1.0.0-beta-1)
docker compose up -d
```

If the database has already advanced through migrations and the rollback
image expects an older database structure, **do not** simply start it –
instead restore a backup (section 8). A pure code-state rollback without a
database downgrade only works if the migrations of the faulty release left
no breaking changes in the database.

---

## 8. Restore (Data level)

### 8.1 Create a backup

```bash
# PostgreSQL
docker compose exec db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c -f /tmp/versigo.dump
docker compose cp db:/tmp/versigo.dump ./versigo-backup-$(date +%F).dump

# Redis (optional, queue state)
docker compose exec redis redis-cli BGSAVE
docker compose cp redis:/data/dump.rdb ./redis-backup-$(date +%F).rdb

# Uploads (if documents are stored locally)
docker run --rm -v versigo_uploads-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-backup-$(date +%F).tar.gz -C /data .
```

### 8.2 Restore

```bash
docker compose down
# remove the old volumes (CAUTION: deletes data irreversibly)
docker compose down -v

docker compose up -d db redis
# wait until db is healthy
docker compose cp ./versigo-backup-YYYY-MM-DD.dump db:/tmp/versigo.dump
docker compose exec db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/versigo.dump'

# repopulate the uploads volume
docker run --rm -v versigo_uploads-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/uploads-backup-YYYY-MM-DD.tar.gz -C /data

docker compose up -d   # starts API, Worker, Web incl. migrations
```

### 8.3 Database reset (Development/Test only)

```bash
docker compose down -v   # deletes ALL volumes (postgres, redis, uploads, minio)
```

---

## 9. Inspect image contents

Quick content check without Compose (Podman):

```bash
podman run --rm --entrypoint sh versigo-api:latest -c '
  ls apps/api/dist/apps/api/src/main.js &&      # build present
  node -e "require(\"@versigo/foundation\")"     # workspace package resolvable
'

# Dev tools AND the Prisma CLI graph must NOT be in the api/worker images
# (effect + @prisma/config are only pulled by the Prisma CLI, BugFix-10 #1):
podman run --rm --entrypoint sh versigo-api:latest -c \
  'ls node_modules/.pnpm | grep -Ei "^(eslint|vitest|@nestjs\+cli|prisma|effect|@prisma\+config)@" && echo "LEAK!" || echo "OK: no dev tools / prisma CLI graph"'

# The Prisma CLI lives only in the migration image (installed via the
# standalone migration-cli stage, BugFix-10 #4):
podman run --rm --entrypoint sh versigo-migration:latest -c \
  'node node_modules/prisma/build/index.js --version | head -1'
```

---

## 10. Troubleshooting (Image/Deploy)

| Symptom | Cause / Solution |
|---------|------------------|
| Container starts with old code | podman-compose recycles containers – run `docker compose down` **before** `up --build` |
| `prisma` CLI missing in the api/worker images | **Expected** (BugFix-07 Q6): the CLI is only in the `versigo-migration` image. Migrations run via the Compose `migration` service (`docker compose run --rm migration` for manual runs) |
| `Cannot find module '@prisma/client'` | `prisma generate` did not run in the runner or the `@prisma/client` link is missing (worker: top-level link in the Dockerfile) |
| Build fails with `no space left on device` | `podman system prune -a -f`, then rebuild |
| `pnpm install --prod` creates an empty `node_modules` | pnpm-11.17.0 regression → the Dockerfiles use `pnpm deploy --prod --legacy` |
| `pg_isready` fails | `postgresql16-client` must be installed in the runner (Alpine APK) |
| Login succeeds (no error) but you are redirected back to the login page | Since BugFix-14 the session-cookie `Secure` flag is `auto` per request, so a plain-HTTP deployment no longer needs `COOKIE_SECURE=false`. If the symptom still occurs because `COOKIE_SECURE=true` is set explicitly while the API is served over plain HTTP, unset it (or set `false`) in `.env` and recreate the API container (`docker compose up -d api`). If the login POST itself returns 401, the `.env` `LOCAL_ADMIN_PASSWORD` differs from the one used at first bootstrap – either use the original value or reset the DB (`docker compose down -v`) |
| Stack/service reported as `unhealthy` | The healthchecks are curl-based (BugFix-15): `curl -fsS` against the internal health endpoints – `/health` on `API_HEALTHCHECK_PORT` (default `3001`, the container-internal API port) for the API, `/health` on `WORKER_HEALTH_PORT` (default `3100`) for the worker, `/` on `:3000` for the web. **The images must be rebuilt and republished after BugFix-15** – older images contain no `curl` and the healthcheck then fails with `curl: not found` (this is the most likely cause of a persistently `unhealthy` stack with `m000p/versigo-*` images). Check which service and why: `docker compose ps -a`, `docker inspect <container> --format '{{json .State.Health}}'` (look at the last `Output` of the failing check), `docker compose logs <service> \| tail -50`. Known benign cases: the one-shot `migration` container shows as `exited (0)` by design; during the initial image pull (`pull_policy: always`) services show as `starting` and only become `healthy` after `start_period`. `unhealthy` only sticks when the healthcheck command itself fails 5 times in a row |
