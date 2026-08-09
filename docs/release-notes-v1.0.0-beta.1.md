# Release Notes – VersiGo v1.0.0-beta.1

**Version:** `v1.0.0-beta.1`
**Date:** `2026-08-08`
**Branch:** `main` (tag: `v1.0.0-beta.1`, created by the release manager after merge)
**Commit:** `<short-sha>`

---

## Highlights

This is the first public beta of VersiGo, a self-hosted insurance hub for
private households. It covers the full policy lifecycle: identity and roles,
policy registry, cost tracking with overview page, document management with
file storage and versioning, family sharing, admin settings with an encrypted
settings store, Paperless-ngx integration (metadata sync, search, document
linking) and an optional AI assist layer for extracting insurance data from
PDFs. The release also delivers the Docker Compose delivery baseline with
health endpoints, the Portal-Connectors framework (experimental), audit,
privacy and monitoring features, multi-language support (de/en) and community
standards (AGPL-3.0 license, contribution guidelines, security policy).

---

## Changes

### New (Features)

| Feature | Description | PR |
|---------|-------------|----|
| Identity & access (AP-02) | Local username/password login, OIDC login readiness, session management, roles (USER/ADMIN/READ_ONLY) | #3 |
| Policy registry (AP-03) | Policy data model, API and web UI | #4 |
| Cost tracking (AP-04) | CRUD, proration, annual summary, separate costs overview page | #5 |
| Documents (AP-05) | Upload, CRUD, versioning, file storage, household isolation | #6 |
| Family sharing (AP-06) | CRUD API, permission checks | #7 |
| Admin settings (AP-07) | Encrypted settings store, feature flags, admin UI | #8 |
| Paperless-ngx (AP-08) | Deep links, metadata sync, search, NoOp fallback | #9 |
| AI assist (AP-09/10) | Optional AI provider adapters (Ollama/OpenAI-compatible), async extraction jobs, coverage summaries with source references | #10, #11 |
| Design system & responsive UI (AP-13) | Shared design system, responsive web UI | #15 |
| Docker Compose delivery (AP-15) | Full service topology: web, api, worker, db, redis, storage | #12–14 |
| Local login (AP-14) | Local username/password authentication | #12 |
| Roles & local registration (AP-16) | Role management, local registration with activation | #17 |
| Profile & system settings UI (AP-17) | Profile and system settings screens | #18 |
| Portal connectors (AP-18) | Connector catalog, deep links, plugin framework (experimental) | #19 |
| Audit, privacy & monitoring (AP-19) | Audit log, privacy features (account deletion), monitoring | – |
| Readiness & version 1 (AP-20) | Health/readiness endpoints, release readiness | – |
| Multi-language support (AP-21) | en/de UI, session-only and persistent language selection, i18n formatting | #21 |
| Product rename (AP-22) | Renamed Insura → VersiGo | #20 |
| Community standards (BugFix-09) | AGPL-3.0 LICENSE, Code of Conduct, CONTRIBUTING, SECURITY policy, issue/PR templates | #28 |
| Docker Hub publishing (BugFix-09) | `m000p/versigo-*` images published on version releases | #28 |

### Bugfixes

| Bug | Description | PR |
|-----|-------------|----|
| Uploads fail on fresh volumes (BugFix-11) | `EACCES` on `/data/uploads` – Dockerfiles now create the directory with `appuser` ownership so fresh named volumes are writable | #28 |
| Paperless search returns 406 (BugFix-11) | API-dialect auto-negotiation: servers that reject versioned `Accept` headers (Paperless 3.x) fall back to the unversioned legacy dialect (`?q=`) | #28 |
| API boot order (BugFix-09) | Fixed `auth.service` ↔ `oidc.strategy` load-order cycle | #28 |
| Docker image sizes (BugFix-10) | Prod-deps-only images, zstd compression, provenance/sbom off, Prisma client from build stage, standalone migration-cli stage (api ~339 MB, worker ~333 MB, web ~206 MB, migration ~297 MB) | #28 |
| Costs overhaul (BugFix-08) | Period-based incurred/expected table, paid-to-date = sum of past periods, increase-from-date auto-ends predecessor, editable historic entries, READ_ONLY access | #25 |
| Admin settings single page (BugFix-07) | Consolidated admin settings UI, OIDC self-service account linking, Paperless document linking (race-safe dedupe), portal URL https normalization | – |
| Release verification & SSRF/TLS (BugFix-06) | SSRF/TLS relaxation opt-in, costs billing-period fixes, dashboard pinning, UI restart feature, English docs + end-user deployment guide | – |
| Manual-test findings (BugFix-05) | Feature config UI, portal URLs, costs, spinner, signout, tab reload, family sharing | #24 |
| Docker production build (BugFix-05) | Fixed Docker production build for api/worker | #24 |
| Docker images (BugFix-04) | Smaller images, audit/monitoring/export in UI, policy-source i18n | #24 |
| Premium currency (BugFix-03) | Removed `premiumCurrency` from policy forms (not in data model) | #24 |
| Docker startup (BugFix-01) | Local Docker and monorepo startup works end-to-end | #16 |

### Refactoring / Technical improvements

| Area | Description | PR |
|------|-------------|----|
| Version 1.0.0-beta.1 (BugFix-11) | Version bumped to `1.0.0-beta.1` in all packages; runtime version in `/health` + `/ready` (API) and web footer via `APP_VERSION`/`NEXT_PUBLIC_APP_VERSION` | #28 |
| Dependency audit (BugFix-11) | `pnpm audit --prod` = 0/0/0 (bcrypt 6.0.0 removed the node-pre-gyp/tar graph; next 16.2.12; overrides for postcss/sharp/vite; vitest 3.2.x everywhere) | #28 |
| vitest 3 migration (BugFix-11) | vitest 3.2.x in api/web/foundation/worker | #28 |
| German→English cleanup (BugFix-11) | All source comments, JSDoc, log messages and thrown error strings in `apps/`/`packages/` translated to English (German remains only in UI resources) | #28 |
| Community standards (BugFix-09) | English README with Docker Hub quick start (no rebuild) | #28 |
| Code comments (BugFix-10) | English comments in Dockerfiles, scripts, workflows | #28 |

### Documentation

| Document | Change |
|----------|--------|
| README | English quick start (Docker Hub images, no rebuild) |
| `docs/end-user-guide.md` | Deployment guide for end users |
| `docs/release-guide.md` | Concrete release notes reference (`docs/release-notes-v1.0.0-beta.1.md`) |
| `docs/beta-release-checklist.md` | Version row, R-12 audit row updated |
| `docs/docker-image-guide.md` | Uploads volume ownership note for existing deployments |

---

## Migration notes

> Important for upgrades from earlier versions:

### Database migrations
- The `migration` service runs `prisma migrate deploy` automatically on stack start (idempotent)
- No manual steps required
- Migrations are **additive only** (no breaking schema changes)

### Breaking changes
- **None** in this beta version

### Configuration changes
| Variable | New | Required? | Notes |
|----------|-----|-----------|-------|
| `APP_VERSION` | `1.0.0-beta.1` | No (default) | Passed to api + worker; reported in `/health` + `/ready` |
| `NEXT_PUBLIC_APP_VERSION` | `1.0.0-beta.1` | No (default) | Passed to web; shown in the footer |

### Deprecations
- None

---

## Security

| Aspect | Status | Details |
|--------|--------|---------|
| Auth fail-fast | ✅ | No default admin in production |
| Secrets handling | ✅ | Encrypted in DB, masked in UI, never in logs |
| CORS / rate limit | ✅ | `TRUST_PROXY` only behind a trusted proxy |
| Dependency audit (prod) | ✅ | `pnpm audit --prod` = 0/0/0 (0 critical / 0 high / 0 moderate) |
| Dependency audit (full) | ⚠️ | 5 remaining HIGH in dev tooling only (eslint/brace-expansion, eslint/js-yaml, @nestjs/cli/fast-uri) – not part of runtime images; reason + risk in `docs/beta-release-checklist.md` R-12 |

---

## Known limitations (Beta)

| Feature | Status | Workaround |
|---------|--------|------------|
| Notifications | ⚠️ API skeleton only | Not relevant for beta |
| Paperless auto-sync | ❌ Not implemented | Manual via Paperless UI |
| Portal-connector plugin | ⚠️ Experimental, disabled | `available: false` in catalog |
| DB backward migration | ❌ Not automated | Restore via `pg_dump` + volume |

---

## Metrics (Build & Runtime)

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Build time (clean) | ~8.5 min | ≤ 15 min | ✅ |
| Image: API | ~339 MB (prod deps only, BugFix-10) | < 1 GB | ✅ |
| Image: Worker | ~333 MB (prod deps only, BugFix-10) | < 1 GB | ✅ |
| Image: Web | ~206 MB (standalone) | < 500 MB | ✅ |
| Image: Migration | ~297 MB (Prisma CLI via migration-cli stage, BugFix-10) | < 500 MB | ✅ |
| Test duration (full suite) | ~2 min | < 5 min | ✅ |
| Smoke test duration | ~3 min | < 5 min | ✅ |

---

## Links

- **Changelog (full):** `git log --oneline`
- **PR:** #28
- **Docker images:** `m000p/versigo-api:v1.0.0-beta.1`, `m000p/versigo-worker:v1.0.0-beta.1`, `m000p/versigo-web:v1.0.0-beta.1`, `m000p/versigo-migration:v1.0.0-beta.1` (Docker Hub, each additionally published as `:latest` automatically via `.github/workflows/publish.yml`)
- **Documentation:** `docs/` (README, ui-control-matrix, beta-release-checklist, docker-image-guide)

---

## Release checklist (internal)

- [ ] All CI checks green (lint, typecheck, tests, smoke)
- [ ] Beta release checklist (`docs/beta-release-checklist.md`) complete ✅
- [ ] Docker images built, tagged, pushed
- [ ] Images verified (`docker pull` + `docker run --rm <image> --version`)
- [ ] GitHub release created with these release notes
- [ ] Tag `v1.0.0-beta.1` set on `main` (release manager, after merge)
- [ ] Next version planned (issues for next beta/RC)

---

## Next steps (post-release)

1. Collect community feedback (issues, discussions)
2. Prioritize known limits (notifications, Paperless auto-sync)
3. Security audit (dependency scan, SAST)
4. Performance optimization (image sizes)
5. Prepare RC1 / v1.0.0
