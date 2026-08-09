# VersiGo

> **⚠️ IMPORTANT NOTICE**
>
> **VersiGo was created entirely with AI. The project is experimental, not
> security-audited and not intended for operation reachable from the internet.
> Run it exclusively in a trusted, isolated private environment and do not use
> production or particularly sensitive data without your own security review.**
>
> *This notice must not be relativized by wording such as "production ready",
> "secure" or "publicly operable".*

---

VersiGo is a modular insurance hub for private households.

## What VersiGo does

VersiGo manages insurance policies, documents, cost histories, portal links and
optional AI-assisted extraction/summaries for private households.

## Quick start (deployment from Docker Hub images — no build required)

The easiest way to run VersiGo is the prebuilt stack from Docker Hub. All
images are pulled as-is; **no image build is needed**.

### Requirements

- Docker Engine 24+ **or** Podman 5+ with a docker-compose-compatible wrapper
- Git
- 2 GB+ RAM, ~5 GB persistent storage (more if you upload documents)

### First start

```bash
git clone https://github.com/M0P/VersiGo.git
cd VersiGo

# Configure the environment
cp .env.example .env
```

Edit `.env` at least as follows:

1. **Generate secrets** (do not use the placeholders!):

   ```bash
   openssl rand -hex 32   # for SETTINGS_ENCRYPTION_KEY and SESSION_SECRET
   ```

2. **Set a strong admin password**: `LOCAL_ADMIN_PASSWORD` (the placeholder
   `CHANGE_ME_FOR_LOCAL_DEVELOPMENT` is rejected in production mode).
3. **Choose the operating mode**: for local/first use the defaults
   (`NODE_ENV=development`, `LOCAL_AUTH_ENABLED=true`) are fine. For
   beta/production operation set `NODE_ENV=production` — only then do the
   security guarantees apply (no automatic default admin, rejection of the
   placeholder password, session cookie with `Secure` flag, auth fail-fast).
4. **Set `VERSIGO_IMAGE_TAG`** (optional) to pin a concrete version
   (e.g. `1.2.3`) instead of `latest`.

Start the stack from the prebuilt images (this runs the database migration
automatically on first start):

```bash
docker compose -f docker-compose.dockerhub.yml up -d
```

Or with a pinned version:

```bash
VERSIGO_IMAGE_TAG=1.2.3 docker compose -f docker-compose.dockerhub.yml up -d
```

### What happens on first start

1. `db` (PostgreSQL) and `redis` start and become healthy.
2. The one-shot `migration` service runs `prisma migrate deploy` against the
   database.
3. `api` and `worker` start only after the migrations were applied
   (`docker/start.sh` verifies this) — then `web` starts after the API health
   check.

### Login and first steps

With local authentication enabled, the API creates exactly one initial
administrator from `LOCAL_ADMIN_USERNAME` / `LOCAL_ADMIN_PASSWORD` on an empty
database (idempotent, password stored only as bcrypt hash). Log in via the web
UI at <http://localhost:3000> or via API:

```bash
curl -sS -X POST http://localhost:3001/auth/local/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"localadmin","password":"<YOUR_PASSWORD>"}'
```

New accounts are created via `POST /auth/register` and must be approved by an
administrator (`POST /admin/users/:id/approve`, status `PENDING_APPROVAL`, see
`docs/07-security-privacy.md`).

### Services and ports

| Service | URL |
|---------|-----|
| **Web UI** | http://localhost:3000 |
| **API** | http://localhost:3001 |
| **API health** | http://localhost:3001/health |
| **API readiness** | http://localhost:3001/ready |

### Stop and reset

```bash
# Shut down the stack
docker compose -f docker-compose.dockerhub.yml down

# Delete ALL data (database, Redis, uploads) — irreversible!
docker compose -f docker-compose.dockerhub.yml down -v
```

### Logs

```bash
docker compose -f docker-compose.dockerhub.yml logs -f          # all services
docker compose -f docker-compose.dockerhub.yml logs -f api      # API only
docker compose -f docker-compose.dockerhub.yml logs -f web      # Web only
docker compose -f docker-compose.dockerhub.yml logs -f worker   # Worker only
```

---

## Alternative: build and run from source (developers / releases)

If you develop VersiGo or want to build the images yourself, the repository's
`docker-compose.yml` builds all images from source:

```bash
git clone https://github.com/M0P/VersiGo.git
cd VersiGo

cp .env.example .env
# adjust .env as described above

docker compose up --build -d
```

This path is also used by the CI and the release process. The image names are
the same (`versigo-api`, `versigo-worker`, `versigo-web`); additionally the
`migration` target of `apps/api/Dockerfile` is built by the `migration`
service. See `docs/docker-image-guide.md` for all build, tag, push, upgrade,
rollback and restore details.

---

## Tests and quality assurance

All tests run in Docker containers:

```bash
# Full test suite (lint, typecheck, unit tests, migration check, i18n guard)
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test

# Compose smoke test (start the stack + health checks + API/Web availability)
./scripts/compose-smoke-test.sh --build

# Individual checks
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run lint"
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run typecheck"
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run test"
```

---

## Docker-free fallback

For read-only access or small changes without Docker:

```bash
# Prerequisites: Node.js 24, pnpm, PostgreSQL, Redis installed locally
pnpm install
pnpm run build
pnpm run dev
```

This mode is **not** suitable for CI, releases or full test verification.

---

## Development mode (Turbo)

The dev mode is started via Turborepo (with a running database and Redis, e.g.
from the Compose stack):

```bash
pnpm run dev         # API, Worker and Web in parallel (watch mode)
pnpm run dev:api     # NestJS API only
pnpm run dev:web     # Next.js web only
pnpm run dev:worker  # Worker only
```

The `dev` task first builds the workspace dependencies (`^build`) and then
starts the watch processes. `turbo.json` sets `envMode: "loose"` so the
configuration variables of the environment (`.env`) are passed through to the
dev processes.

The Next.js dev server only allows HMR/dev requests from `localhost` by
default. If the web UI is called from another origin (e.g. LAN IP or reverse
proxy), add it to `NEXT_ALLOWED_DEV_ORIGINS` as a comma-separated list
(`host` or `host:port`) — e.g. `NEXT_ALLOWED_DEV_ORIGINS=192.168.24.8:3000`.
This setting applies only in dev mode.

---

## Feature overview

| Area | Features | Status |
|------|----------|--------|
| **Authentication** | Local login (username/password), OIDC (Keycloak, Authentik, etc.), registration with admin approval, roles (ADMIN, USER, READ_ONLY) | ✅ |
| **Policy management** | Policy CRUD, insured persons, cost history, documents, portal links | ✅ |
| **Documents** | Upload (local/MinIO), categorization, versioning, AI extraction | ✅ |
| **Cost overview** | Household-wide aggregation, charts, filters | ✅ |
| **Family sharing** | Object-based sharing between household members (overview, create, permissions) | ✅ |
| **Admin: system settings** | Catalog-based (allowlist), priority UI > ENV > default, encrypted secrets, connectivity tests, audit log | ✅ |
| **Admin: feature flags** | Global & household-specific, toggle in UI | ✅ |
| **Admin: integrations** | AI (Ollama/OpenAI-compatible), Paperless-ngx, portal connectors | ✅ |
| **AI assist** | Document extraction, coverage summaries (optional, queue-based) | ✅ |
| **Paperless-ngx** | Document sync, tagging (optional) | ✅ |
| **Portal connectors** | Catalog (HUK-COBURG, etc.), deep links, plugin framework (experimental) | ✅ |
| **Audit & monitoring** | Audit log (admin), queue monitoring, worker heartbeat, integration status | ✅ |
| **Privacy** | GDPR export (Art. 15), account deletion with last-admin protection | ✅ |
| **Internationalization** | German/English, persistent (USER/ADMIN) or session-only (READ_ONLY) | ✅ |
| **Design system** | Light/dark, 8 accent colors + custom, CSS custom properties | ✅ |

---

## Architecture

- **Modular monolith** with vertically sliced features (see `docs/03-architecture.md`)
- **Backend:** NestJS (API + Worker)
- **Frontend:** Next.js 16 (App Router, React 19, Standalone Output)
- **Design system:** CSS custom properties with theme provider (see `docs/11-ui-ux.md`)
- **Database:** PostgreSQL 16 with Prisma ORM
- **Queue/Cache:** Redis 7 + BullMQ 5
- **File storage:** local volume (optional MinIO/S3)
- **Auth:** OIDC (Keycloak, Authentik, etc.) + local username/password

---

## Requirements for beta operation

> **Mandatory for beta/production:** set **`NODE_ENV=production`** in the
> `.env` (`.env.example` is preconfigured for local development with
> `development`). Only with `NODE_ENV=production` do the security guarantees
> apply: no automatically created default admin, rejection of the
> `.env.example` placeholder password, session cookie with `Secure` flag and
> auth fail-fast at startup. The Compose smoke test verifies this production
> path (step 12).

| Resource | Minimum | Recommended | Note |
|----------|---------|-------------|------|
| CPU | 2 vCPU | 4 vCPU | For the AI queue worker |
| RAM | 2 GB | 4 GB | API + Worker + Web + DB + Redis |
| Persistent storage | 5 GB | 20 GB | PostgreSQL + Redis + uploads |
| Backup storage | 2× data | 3× data | Daily pg_dump + volume snapshots |
| Upload growth | – | 1–5 GB/month | Depending on document volume |

---

## Configuration

All environment variables are documented **per variable** in `.env.example`
with purpose, safe placeholder example value, security relevance and default
(binding reference). The following table summarizes the categories with
example values and security relevance:

| Category | Variables | Required | Service | Example value | Security relevance |
|----------|-----------|----------|---------|---------------|--------------------|
| **Infrastructure** | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`, `VERSIGO_HOST`, `APP_PORT`, `WEB_PORT`, `APP_VERSION`, `NEXT_PUBLIC_APP_VERSION` | Yes | All | `postgresql://versigo:change-me@db:5432/versigo`; `VERSIGO_HOST=192.168.24.8` | DB password has no default; internal network only. `VERSIGO_HOST` + `APP_PORT`/`WEB_PORT` are the single source for the public URLs (`NEXT_PUBLIC_API_BASE_URL`, `CORS_ORIGINS`, `OIDC_CALLBACK_URL` are derived in the Compose files) |
| **Secrets** | `SESSION_SECRET`, `SETTINGS_ENCRYPTION_KEY` | Yes | API, Worker | `openssl rand -hex 32` | Min. 32 random characters; leak = session impersonation / decryption |
| **Auth** | `LOCAL_AUTH_ENABLED`, `LOCAL_ADMIN_*`, `OIDC_*`, `CORS_ORIGINS`, `TRUST_PROXY`, `COOKIE_SECURE` | Yes (at least one auth method) | API, Worker | `LOCAL_ADMIN_PASSWORD=<strong>`; `TRUST_PROXY=false`; `COOKIE_SECURE` empty | Placeholder password is rejected in production; `TRUST_PROXY` only behind a proxy; `COOKIE_SECURE` only set explicitly for HTTP operation (default: true in production) |
| **Storage** | `STORAGE_ENABLED`, `DOCUMENTS_STORAGE_PATH`, `S3_*`, `MINIO_*` | No | API, Worker | `change-me` placeholders | Credentials never default; path in volume |
| **AI** | `AI_ENABLED`, `AI_PROVIDER`, `AI_OLLAMA_*`, `AI_OPENAI_COMPAT_*` | No | API, Worker | `AI_ENABLED=false` (opt-in) | API key only on explicit activation; data flows only then |
| **Paperless** | `PAPERLESS_ENABLED`, `PAPERLESS_URL`, `PAPERLESS_API_TOKEN` | No | API | `PAPERLESS_ENABLED=false` (opt-in) | Token only on activation; data leaves only then |
| **Worker health** | `WORKER_HEALTH_PORT`, `WORKER_HEARTBEAT_*` | No | Worker | `3100` (internal only) | Port not bound to the host |

**Secure defaults:** all secrets have placeholders (`change-me`) in
`.env.example`. In production you **must** generate your own values
(`openssl rand -hex 32`). For beta/production operation `NODE_ENV=production`
is mandatory (see "Requirements for beta operation" above).

**Validation:** unknown, insecure or contradictory configurations cause a
clear error at startup (fail-fast).

---

## Ports, volumes & data

| Service | Ports (internal) | Ports (external, Compose) | Volumes | Stored data |
|---------|------------------|---------------------------|---------|-------------|
| **PostgreSQL** | 5432 | – | `postgres-data` | All relational data (users, policies, settings, audit, etc.) |
| **Redis** | 6379 | – | `redis-data` | BullMQ queues, cache, session store |
| **API** | 3001 | `${APP_PORT:-3001}` | `uploads-data` (mount) | – (stateless) |
| **Worker** | 3100 (health, internal only) | – | `uploads-data` (mount) | – (stateless) |
| **Web** | 3000 | `${WEB_PORT:-3000}` | – | – (stateless) |
| **MinIO** (optional) | 9000/9001 | – | `minio-data` | S3-compatible object storage |

---

## AI & external integrations (optional)

| Integration | Purpose | Data received | Deactivation |
|-------------|---------|---------------|--------------|
| **AI Assist (Ollama)** | Local LLM extraction | Document text, metadata | `AI_ENABLED=false` |
| **AI Assist (OpenAI-compatible)** | Cloud LLM extraction | Document text, metadata, API key | `AI_ENABLED=false` |
| **Paperless-ngx** | Document sync | Document metadata, file references | `PAPERLESS_ENABLED=false` |
| **Portal connectors** | Insurer portal deep links | None (configuration only) | Feature flag `portalConnectors.enabled=false` |

**Important:** all integrations are **opt-in** (default: disabled). No data
leaves the system without explicit configuration.

---

## Contributing

Help, reviews, tests, bug reports, security reports, documentation
improvements and pull requests are **explicitly welcome**.

- **Contribution guidelines:** see [CONTRIBUTING.md](CONTRIBUTING.md)
  (forking, branch naming, commit messages, tests, review loop).
- **Code of conduct:** see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Security reports:** report vulnerabilities **privately** via **GitHub
  Security Advisories** (Security -> Report a vulnerability), **not** as a
  public issue. See [SECURITY.md](SECURITY.md).

---

## Tool documentation

| Tool | Version | Purpose | Important commands |
|------|---------|---------|--------------------|
| **Docker / Compose** | 24+ / 2.24+ | Container orchestration | `docker compose up --build`, `docker compose down -v` |
| **pnpm** | 11.17.0 | Package manager (monorepo) | `pnpm install`, `pnpm run build`, `pnpm run test` |
| **Node.js** | 24.x | Runtime | – |
| **Turbo** | 2.10+ | Build orchestration | `turbo run build`, `turbo run dev` |
| **Prisma** | 6.19+ | ORM & migrations | `npx prisma migrate deploy`, `npx prisma generate` |
| **Redis / BullMQ** | 7.4 / 5.34 | Queue & cache | – |
| **Next.js** | 16.2 | Frontend framework | `next build`, `next start` |
| **NestJS** | 11.0 | Backend framework | `nest start`, `nest build` |

**Diagnostic commands:**

```bash
# Container status
docker compose ps

# Logs
docker compose logs -f api

# Check database migrations
docker compose run --rm migration

# Prisma Studio (dev only)
npx prisma studio

# Health checks
curl http://localhost:3001/health
curl http://localhost:3001/ready
curl http://localhost:3000/
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| **API does not start: "NO AUTHENTICATION METHOD CONFIGURED"** | Neither `LOCAL_AUTH_ENABLED` nor `OIDC_ENABLED` set | Enable at least one method in `.env`: `LOCAL_AUTH_ENABLED=true` or `OIDC_ENABLED=true` |
| **Database unreachable** | `DATABASE_URL` wrong, DB not started | `docker compose ps db`, check `DATABASE_URL` in `.env` |
| **Redis connection refused** | Redis not started, wrong port | `docker compose ps redis`, check `REDIS_URL` |
| **Migration fails** | Schema drift, lock conflict | `docker compose down -v` (data loss!) or manually `npx prisma migrate resolve` |
| **Login fails (401)** | Wrong password, user not `ACTIVE`, `PENDING_APPROVAL` | Admin: approve the user in `/admin/users`; reset password via DB |
| **Login succeeds (no error) but redirects back to login page** | `COOKIE_SECURE=true` (production default) while the site is served over plain HTTP – the browser drops the Secure session cookie | Set `COOKIE_SECURE=false` in `.env` (plain HTTP) or terminate TLS; recreate the API: `docker compose up -d api` |
| **Upload fails** | `STORAGE_ENABLED=false`, volume not mounted, file too large | `STORAGE_ENABLED=true`, `docker compose ps`, check nginx/proxy `client_max_body_size` |
| **Build error: TypeScript errors** | Code changes break types | Run `pnpm run typecheck` locally, check `tsconfig.json` `strict: true` |
| **OIDC login fails** | `OIDC_*` variables wrong, callback URL mismatch | Compare issuer URL, client ID/secret, callback URL in IdP & `.env` |
| **AI/Paperless connectivity test fails** | Wrong URL/token, network blocked | Test `curl` from the API container: `docker compose exec api curl -v <URL>` |
| **CORS error in browser** | `CORS_ORIGINS` does not match the web origin | Set `CORS_ORIGINS=http://localhost:3000` (or your domain) |
| **Rate limit locks out all users** | `TRUST_PROXY=true` without a real reverse proxy | Keep `TRUST_PROXY=false` (default), except behind a trusted proxy |

---

## Beta limitations (open & honest)

| Limitation | Details |
|------------|---------|
| **No public hosting** | Not intended for operation reachable from the internet |
| **No security certification** | No pen test, no audit, no compliance guarantee |
| **No guarantee of loss-free data** | Backups are **your** responsibility |
| **No support commitment** | Community project, best effort |
| **No replacement for your own backups** | `docker compose down -v` deletes everything irreversibly |
| **Incomplete features** | Notifications only API, no UI |
| **Experimental plugins** | Portal connector "Mailbox Sync" is `available: false` |
| **No automatic DB backward migration** | Restore only via backup (`pg_dump` + volume) |
| **Single-tenant only** | No multi-tenant, no tenant isolation beyond households |

---

## Known limitations

- **Family sharing:** household shares end at your own installation; no
  cross-instance sharing
- **Notifications:** API skeleton only, no UI, no push/email
- **Paperless sync:** configuration + connectivity test only, no automatic sync
- **Portal connector plugin:** "Mailbox Sync" is experimental and disabled
  (`available: false`)
- **OIDC:** no auto-provisioning — an admin must set the binding manually
  (ADR-007)
- **Language:** only German/English (no complete i18n for all strings)

---

## Documentation

- `docs/01-product-vision.md` – Product vision
- `docs/02-requirements.md` – Requirements
- `docs/03-architecture.md` – Architecture (modular monolith, ADRs)
- `docs/04-data-model.md` – Data model (Prisma schema)
- `docs/05-feature-slices.md` – Feature slices overview
- `docs/06-integrations.md` – External integrations
- `docs/07-security-privacy.md` – Security & privacy model
- `docs/08-admin-operations.md` – Operations (backup, restore, upgrade, migration)
- `docs/09-ai-agent-implementation-plan.md` – AI agent plan
- `docs/10-quality-and-library-policy.md` – Quality & library policy
- `docs/11-ui-ux.md` – UI/UX & design system
- `docs/12-roadmap.md` – Roadmap
- `docs/13-settings-catalog.md` – Complete settings catalog
- `docs/adr/` – Architecture Decision Records (ADR-001 to ADR-009)
- `docs/ui-control-matrix.md` – UI control matrix (all functions, roles, permissions, tests)
- `docs/beta-release-checklist.md` – Beta release checklist (go/no-go)
- `docs/release-notes-template.md` – Release notes template
- `docs/docker-image-guide.md` – Docker image build & deployment guide
- `docs/end-user-guide.md` – End-user guide
- `docs/release-guide.md` – Release guide

---

## License

VersiGo is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0)** — see the [LICENSE](LICENSE) file. The software is and will
remain open source; the copyright is held by the project maintainer.

---

*Last updated: 2026-08-07 | Beta version | Created entirely with AI*
