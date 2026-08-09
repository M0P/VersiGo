# BugFix-11 – Release readiness: uploads, Paperless dialect fix, v1.0.0-beta, B3/B5/R1/R3/R5/R6/R7

Source: user request (2026-08-07) — "erstelle ein neues umsetzungpaket" with the content: upload fix; Paperless fix (the user runs **Paperless 3.x**, not Paperless 1); B2 (v1.0.0 BETA); B3; B5; R1 (including another German→English translation round in code comments); R3; R5; R6; R7.

B/R codes refer to `docs/pre-release-review.md` (findings before the first VersiGo release, 2026-08-07).

## Context (what exists today)

- Branch: `fix/BugFix-09-ci-fix-community-standards-dockerhub` @ `f8fcfbf` (BugFix-10 committed `c654e13`; PR #28 not merged yet — B1 is NOT in this package's scope). Handoff: `docs/reviews/NEXT-CODING-AGENT-PROMPT.md`.
- **Upload bug (empirically verified, 2026-08-07):** `POST .../documents` → `EACCES: permission denied, mkdir '/data/uploads/<id>'`. The API/worker containers run as `uid=100 (appuser)`, but `/data/uploads` (named volume `uploads-data`, podman name `versigo_uploads-data`) is `root:root` mode 1755 (`drwxr-xr-t`). Root cause: neither `apps/api/Dockerfile` nor `apps/worker/Dockerfile` creates `/data/uploads`; the mount point is auto-created as root at container start, so every fresh named volume inherits root ownership. (A one-off `podman unshare chown 100:101 <volume>/_data` fixed the running instance; the image is still broken for fresh clones.)
- **Paperless bug (empirically verified with the user's real token, 2026-08-07):** every search → `status=406`. `PaperlessNgxService.createHeaders` (line ~98) hardcodes `Accept: application/json;version=2`, and `searchDocuments` calls `GET /api/documents/?query=...` (line ~276). The user's server at `PAPERLESS_URL=https://papierkram.home` (a **Paperless 3.x** installation) **rejects every versioned Accept header** with `{"detail":"Invalid version in \"Accept\" header."}` — verified: version=1/2/3 → 406; unversioned `Accept: application/json` + `/api/documents/` → 200 (2,115 documents; the stored token is valid); unversioned + `/api/documents/?q=test` → 200 (search works); `/documents/?query=test` → 400. So the app must **negotiate the API dialect** instead of assuming v2. (Likely cause of the anomaly: the paperless reverse-proxy/versioning configuration rejects the versioned header; the fix must not assume the user's server is at fault and must work for any server dialect.)
- Versions: root, api, worker, web, foundation all `0.1.0`. `docs/beta-release-checklist.md` targets `v1.0.0-beta`; release-guide + `publish.yml` tag `v*` → Docker Hub publish (`m000p/versigo-*`).
- `github-advanced-security` check FAILED on PR #28; workflow run "Code scanning AI findings on PR #28" (run 31186564603) failed. `.github/workflows/` contains only `ci.yml` + `publish.yml` → these are GitHub **default-setup** (AI code scanning) runs, not repo workflows.
- `pnpm audit --prod` (2026-08-07): **28 advisories (11 moderate / 16 high / 1 critical)**; critical `tar <=7.5.20` via `bcrypt>@mapbox/node-pre-gyp>tar` (GHSA-r292-9mhp-454m, patched ≥7.5.21); high on next/sharp/esbuild/vite/vitest paths; checklist R-12 still says 26.
- Dependabot PR #27 (`vitest 2.1.9 → 3.2.6`) CI-failed; dependabot batch runs on `main` failed (esbuild/next/sharp/tar/vite/vitest).
- R1 rename fallout: `git remote origin` = `https://github.com/M0P/insura.git`; README lines 36–37, 136–137 still `insura`; GitHub description/topics/license metadata stale. Plus the user-requested **German→English translation round** (code comments/logs — German UI translations stay, they are a feature).
- R6: untracked stale `prompts/BugFix-03-post-bugfix02-issues.md`; stale branches.
- R7: `packages/foundation/src/health/health.controller.ts` returns no version on `/health`/`/ready`; web UI shows no version.

## Scope

### 1. Upload fix (Docker images)
- In `apps/api/Dockerfile` AND `apps/worker/Dockerfile` runner stage, before `USER appuser`:
  `RUN mkdir -p /data/uploads && chown -R appuser:appgroup /data/uploads`
- Fresh named volumes then inherit `appuser` ownership (Docker/Podman copy-up preserves image ownership). Document for existing deployments: one-time `podman unshare chown 100:101 <volume>/_data` (append a short note to `docs/docker-image-guide.md` or the deployment guide — pick the doc that describes the uploads volume).
- Extend `scripts/compose-smoke-test.sh` with one new check: uploads directory writable inside the API container (`docker compose exec` touch+rm probe on `/data/uploads`). Keep the check list count in sync (31 → 32 checks).
- Live verification (dev stack is running): repeat the end-to-end upload (login `localadmin` → `POST /auth/local/login`, `GET /households/default/policies`, `POST .../documents` with a small file, then `DELETE` the created document) and confirm the file lands under `/data/uploads/<policyId>/<docId>/` and cleanup leaves the volume empty.

### 2. Paperless API-dialect fix (auto-negotiation)
- Introduce a dialect concept in `PaperlessNgxService` (keep it inside the service or a small helper class, no new module unless cleaner): `v2` = current behavior (`Accept: application/json;version=2`, search param `query`); `legacy` = `Accept: application/json` (unversioned), search param `q`.
- **Auto-negotiation:** on first use (and after any config change — `runtimeConfig()` values changed) probe the dialect with a lightweight request using the v2 header; if the server answers **406** → switch to `legacy` for all subsequent calls and cache the result per `baseUrl`; any other status (200/401/403/…) → keep `v2` (401/403 with the stored token means wrong token/permission, NOT a dialect issue — surface the real error as today). On `legacy`, `searchDocuments` must send `?q=` instead of `?query=`; `healthCheck()` and the document listing must use the negotiated header too.
- Keep failure semantics unchanged: communication errors are logged, never thrown (interface contract; "Fehler … werden geloggt, aber nicht weitergereicht").
- Result-shape note: the legacy endpoint returns the same DRF paginated `results[]` document objects; map fields to the existing internal shape if field names differ (verify against the real server response while implementing).
- Tests (unit): mock the HTTP layer —
  1. server rejects versioned header (406) → service falls back to legacy → subsequent search sends unversioned Accept + `q=` → parses results,
  2. server accepts v2 → stays v2,
  3. `healthCheck` uses the negotiated dialect,
  4. dialect cache resets when the config (baseUrl/token) changes,
  5. search param mapping `query`→`q` covered.
- Live verification (dev stack running, user's server reachable from the API container): after the fix, `searchDocuments('Versicherung')` must return results (currently 406). If the server is unreachable during implementation, the unit tests + documented manual verification step are the acceptance evidence (note this in the commit).

### 3. B2 + R7 – version `1.0.0-beta.1` everywhere and in the runtime
- Bump `"version": "1.0.0-beta.1"` in: root `package.json`, `apps/api`, `apps/worker`, `apps/web`, `packages/foundation` (all `0.1.0` today). Regenerate `pnpm-lock.yaml` (container pnpm, `--lockfile-only`).
- Expose the version at runtime (R7):
  - API/worker: read from env `APP_VERSION`; add to `packages/foundation/src/config/app-config.schema.ts` (optional string), `AppConfigService`, and return it from `HealthController` in `/health` (add `version`) and `/ready` (add `version`). Do not expose secrets; version is a public, harmless value.
  - Web: `NEXT_PUBLIC_APP_VERSION` injected at container startup like `NEXT_PUBLIC_API_BASE_URL` (same entrypoint mechanism), displayed in the web UI footer (add a small footer line if none exists; keep it minimal, no new layout work).
  - Compose: pass `APP_VERSION: ${APP_VERSION:-1.0.0-beta.1}` to api + worker and `NEXT_PUBLIC_APP_VERSION: ${NEXT_PUBLIC_APP_VERSION:-1.0.0-beta.1}` to web in `docker-compose.yml`; add both to `.env.example` with the default; update the docs env-var tables (whichever doc lists the env vars) — **Required Future-Feature Contract**: every new env var goes into compose, `.env.example`, and docs in the same feature.
- Update `docs/beta-release-checklist.md` (version row) and `docs/release-guide.md` where they mention `0.1.0`; state in the PR/commit that the git tag `v1.0.0-beta.1` is created by the release manager AFTER merge (tagging `main` is out of agent scope per the shared rules).
- Tests: extend the health/ready unit tests (foundation) for the new `version` field (absent → `'unknown'` or omit? — pick one and test it); compose smoke health/ready checks may assert `version` present.

### 4. B3 – github-advanced-security check + "Code scanning AI findings" workflow
- Investigate with `gh` if authenticated (`gh pr checks 28`, `gh run view 31186564603`); otherwise use the unauthenticated GitHub API and document exactly what needs owner access. The pre-release review already established: no code-scanning workflow file exists in the repo → these are GitHub **default setup** runs.
- Remediation (in priority order, do what is possible without repo-admin rights):
  1. If the failure is a real code-scanning alert → fix the code on this branch (the alert detail should be available via the API/SARIF or the PR checks UI; if not readable, document the exact click-path for the owner).
  2. If the failure is a job/config failure of the default-setup workflow → add a repo-controlled code-scanning workflow (e.g. a corrected `codeql.yml`/AI-findings workflow with the right `permissions: security-events: write` and a working config) so the check is green and repo-controlled, OR
  3. Document the owner-only action (disable/adjust "AI-powered code scanning" default setup in GitHub UI) precisely in the PR description and commit message.
- Outcome: PR #28's `github-advanced-security` check is green after this package's commit (checks re-run on push), or the failure is fully diagnosed with an owner-action list. CodeQL + other checks in `ci.yml` must stay green.

### 5. B5 – dependency audit (28 advisories)
- Re-run `pnpm audit --prod` in the container first; record the fresh numbers.
- Fix the critical: pin `tar@>=7.5.21` via a pnpm `overrides` entry (or bump `bcrypt` to a version whose `@mapbox/node-pre-gyp` dependency is updated — choose the cleaner one; the library-policy doc `docs/10-quality-and-library-policy.md` must stay accurate, update it if the override/bump changes policy-relevant entries).
- Bump the clean high/mod paths: `next`, `sharp`, `postcss` (next path), and coordinate `esbuild`/`vite`/`vitest` with item 7 (R3). Verify every bump with the full gates (web build in the smoke test proves next/sharp).
- Re-run `pnpm audit --prod` → target **0 critical / 0 high**; every remaining advisory (if any) gets an explicit reason + risk statement in `docs/beta-release-checklist.md` R-12 (update the numbers to the final state).
- Update `pnpm-lock.yaml` in the same change.

### 6. R1 – rename fallout + German→English translation round
- `README.md` lines 36–37 and 136–137: `git clone https://github.com/M0P/insura.git` → `M0P/VersiGo.git`, `cd insura` → `cd VersiGo`.
- `git remote set-url origin https://github.com/M0P/VersiGo.git` (local-only; describe in the commit message; cannot be committed).
- GitHub metadata best-effort: `gh repo edit M0P/VersiGo --description ... --topics ... --add-topic ...` if authenticated (suggested topics from the review: `typescript, nextjs, nestjs, prisma, postgresql, selfhosted, insurance`); if not authenticated, put the exact commands in the PR description for the owner.
- **Translation round (user-requested):** translate German source comments, JSDoc and German non-UI runtime strings (logger messages, thrown error messages) to English in:
  - `apps/*/src/**` (TS comments + `logger.*`/`throw new Error` strings) — known hotspots seen during analysis: `admin-settings/restart.service.ts`, `identity/oidc.strategy.ts`, `paperless-ngx/paperless-ngx.service.ts`, `paperless-ngx/paperless-ngx.interface.ts`, `identity/auth.controller.ts`, `identity/auth.service.ts`, `documents/documents.service.ts`, `monitoring/*`, `system-config/*`, `ai-assist/*`, foundation `health/health.controller.ts`, `capabilities/*`, `encryption/aes-gcm-encryption.adapter.ts`, `config/*`, `settings-preload.ts`, `settings-catalog.ts` (category labels that are NOT i18n UI strings — check: if the catalog labels are user-visible via the admin UI, they may need i18n keys instead of plain strings; do not silently change user-visible German labels — if they are user-visible, leave the label but translate the code comment, and note it),
  - `apps/*/Dockerfile` + `apps/web/Dockerfile` + `docker/*.sh` + entrypoint scripts (BugFix-10 convention "German Dockerfile comments" is hereby overridden → English),
  - `.github/workflows/*.yml` comments.
  - **Excluded:** i18n UI resource files (`apps/web` locale/de files, `apps/api`/foundation i18n keys — German UI is a feature), `/prompts/**`, `/docs/**` (except where another item explicitly edits docs), `docs/reviews/**`.
  - **Critical:** German strings may be asserted in specs (e.g. `restart.service` "Neustart von api/worker…", `oidc.strategy.spec` "Discovery fehlgeschlagen", `auth.controller.spec` "OIDC_ISSUER_URL fehlt", paperless `logError` messages, monitoring specs, `system-config`/`admin-settings` spec strings). Grep every translated string in `__tests__`/`*.spec.ts` and update assertions to the new English text.
- Verification: `grep -rE '[äöüÄÖÜß]' apps packages --include='*.ts' --include='*.sh' --include='Dockerfile' --include='*.yml'` returns only allowed i18n resources and user-visible UI labels (document the allowlist in the commit); lint/typecheck/tests green.

### 7. R3 – Dependabot / vitest 3
- Complete the vitest 3 migration: bump `vitest` + `@vitest/*` to 3.2.x in the workspace devDeps (api/web/foundation/worker), fix any breaking changes (vitest 3: pool/workspace/coverage config, `vitest.config.*` files, reporter/`vi` API changes), re-run all gates. This also covers the B5 vitest-path advisories.
- If the clean bump fails despite reasonable effort: close dependabot PR #27 with a documented reason and pin `vitest@2.x` (still supported) — but prefer the bump.
- After gates are green: re-open/rebase or accept the dependabot PRs in the dependabot batch (esbuild/next/sharp/tar/vite/vitest) so their `compose-test` checks pass; close stale dependabot PRs with reasons if superseded by this package's bumps. Keep `pnpm-lock.yaml` in sync. (Note: dependabot PR checks run on the dependabot branches; if the agent cannot update those branches, document the state and leave the PRs for the owner with a clear status list in the PR description.)

### 8. R5 – release notes
- Produce the concrete release notes for `v1.0.0-beta.1`: `docs/release-notes-v1.0.0-beta.1.md` (highlights, features AP-01…AP-21, bugfixes BugFix-01…11, known limits, versions) and leave `docs/release-notes-template.md` as the reusable template (only fix it if it is factually wrong after this package). Update `docs/release-guide.md` if it still says "fill in the template" → reference the concrete file.
- The notes must include this package's changes (uploads, Paperless dialect, version, audit, health version).

### 9. R6 – repo hygiene
- Delete the untracked stale file `prompts/BugFix-03-post-bugfix02-issues.md` (issues long fixed; the file is not part of any committed package).
- Prune stale **local** branches that are already merged (`git branch -d` for `feat/AP-*`/`fix/BugFix-*` that are merged into the current branch; never force-delete anything unmerged).
- Remote branches: DO NOT delete remote branches without explicit user confirmation — list them (merged vs. obsolete) in the PR description/commit message for the owner to clean up.
- Best-effort `gh repo edit` metadata is covered in item 6.

## Verification
- Full gate suite via Docker Compose: `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` (API vitest ~654, web 47, foundation 105, worker 4, typecheck, lint, i18n guard, `prisma migrate deploy`, compose configs, workflow YAML validity) — the vitest 3 / dependency bumps make this run mandatory.
- Full smoke: `./scripts/compose-smoke-test.sh --build --clean` (31 + 1 new upload-write check = 32 checks).
- Fresh-clone contract: after `docker compose down -v` and `up --build`, the upload smoke check must pass (proves the Dockerfile fix produces a writable volume).
- Live checks against the running dev stack: end-to-end upload (item 1), Paperless search against `papierkram.home` (item 2, if reachable), `/health` + `/ready` return `version` (item 3), web footer shows the version.
- `pnpm audit --prod` final numbers (item 5) — documented in the commit + checklist.
- German-char grep verification (item 6) with allowlist.
- `gh pr checks 28` / run-view for B3 (item 4) state documented.
- Review loop: invoke the `code-reviewer` subagent (Task tool) on the uncommitted diff, write each report verbatim to `docs/reviews/BugFix-11-review-<n>.md`, fix every Critical/High/Medium (and Minor where reasonable) until **0 Critical / 0 High / 0 Medium / ≤ 8 Minor**, max 5 rounds.
- Cleanup duty (AGENTS.md + shared rules): remove all podman artifacts created during the session (session images `versigo-{api,worker,web,migration}` + `versigo-test`, `podman image prune -f`, scratch volumes/containers), `df -h /var/home` afterwards, delete `/tmp/opencode` scratch files.

## Conventions
- Work continues on the PR #28 feature branch `fix/BugFix-09-ci-fix-community-standards-dockerhub` (established practice: BugFix-10 also committed there; `main` is behind — branching from `main` would lose BugFix-09/10/11). Note this deviation from the generic shared-rule "new branch from main" in the PR description.
- After this package, ALL code comments/log messages in `apps/`/`packages/` are English (new convention, overrides BugFix-10's "German Dockerfile comments"); German remains only in i18n UI resources and `/prompts`/`/docs` operational files.
- Required Future-Feature Contract: new env vars `APP_VERSION` + `NEXT_PUBLIC_APP_VERSION` go into compose (api/worker/web), `.env.example`, and the docs env-var tables in the same feature (item 3).
- Existing patterns: docs layout, `.env.example`, compose smoke test structure, commit messages starting with the package number.

## Out of scope
- B1 (merging PR #28), B4 (Docker Hub secrets + test publish), R2 (CI smoke upgrade), R4 (full checklist drift + sign-off) — not requested; B5 updates only the R-12 audit row, item 3 the version row.
- Any new Paperless feature (auto-sync R-03, UI changes), OIDC auto-provisioning, Playwright E2E, a11y automation.
- Deleting remote branches (R6) without explicit user confirmation.
- Changing German user-facing UI strings.

## Acceptance
- Uploads work from a fresh clone (image creates `/data/uploads` with appuser ownership; smoke upload-write check green; live E2E upload OK).
- Paperless search works against the user's Paperless 3.x server (live 200 with results) OR the fallback is unit-proven and the manual verification step is documented (if the server was unreachable).
- All package versions `1.0.0-beta.1`, lockfile in sync; `/health` + `/ready` report `version`; web footer shows the version; compose + `.env.example` + docs updated per contract.
- `github-advanced-security` check resolved (green) or fully diagnosed with owner-action list.
- `pnpm audit --prod`: 0 critical / 0 high, or every remaining advisory explicitly documented in R-12 with reason + risk.
- Dependabot vitest-3 PR green (or closed with documented reason); dependabot batch state documented.
- German→English translation round complete; only the documented allowlist keeps German; specs updated; grep verification passes.
- Release notes `docs/release-notes-v1.0.0-beta.1.md` concrete; checklist rows updated.
- Stale `prompts/BugFix-03-post-bugfix02-issues.md` removed; local merged branches pruned; remote branch list documented.
- All gates green (compose test gate + smoke 32/32); review loop 0 Critical / 0 High / 0 Medium / ≤ 8 Minor.
- Commit message starting `BugFix-11:`; rewrite `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` (next package = BugFix-11); clean up podman artifacts; verify `df -h /var/home`.
- Do **not** start any later work package, do **not** tag, merge, push or open PRs beyond the established branch/PR workflow.
