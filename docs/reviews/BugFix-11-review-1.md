# BugFix-11 Review — Iteration 1

Date: 2026-08-08
Reviewer: code-reviewer subagent (DeepSeek)
Reviewed: uncommitted working-tree changes on `fix/BugFix-09-ci-fix-community-standards-dockerhub` (HEAD `f8fcfbf`) against `prompts/BugFix-11-release-readiness.md`

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 5
- Verdict: PASS

**Note on method:** I had no shell/bash tool available in this environment, so I could not literally run `git diff`/`git status`. I reviewed the current working-tree files directly against the work package (`prompts/BugFix-11-release-readiness.md`) and the described change set, focusing on the eight requested areas. All files inspected are the uncommitted working-tree state on `fix/BugFix-09-ci-fix-community-standards-dockerhub` (HEAD `f8fcfbf`).

## Findings

- [Minor] `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:167-170` — probe failure caches `v2` permanently on non-406 errors
  - Evidence: `probeDialect` catches any error and returns `DEFAULT_DIALECT` ('v2'), which `resolveDialect` then stores in `dialectCache`. A transient network failure (e.g. Paperless briefly unreachable at first use) permanently pins `v2` for that `baseUrl::token` key, so a legacy server would keep returning 406 on every search until the config changes or the process restarts. The probe failure is also not logged, which deviates from the "errors are logged, never thrown" contract.
  - Required fix: on a non-406 probe error, return `'v2'` without writing to the cache (so the next call re-probes), and log a warning that the dialect probe failed.

- [Minor] Translation sweep incomplete — German comments remain in `apps/web` and `oidc.strategy.ts`
  - Evidence: the work package's new convention is "ALL code comments/log messages in `apps/`/`packages/` are English". Still present: `apps/web/src/components/ui/app-shell.tsx:22-25,47,57-65,84-86,115-121`, `apps/web/src/hooks/use-current-user.ts:24`, `apps/web/src/middleware.ts:5`, `apps/web/src/lib/portal-url.ts:5`, and `apps/api/src/features/identity/oidc.strategy.ts:8-17,34-35,150,190,210-217,279-283,303-304` (mixed German/English). These are code comments, not i18n resources or user-visible labels, so they fall under the translation scope.
  - Required fix: translate the remaining German comments in `apps/web/src/**` and `oidc.strategy.ts` to English (or explicitly document them in the allowlist if intentionally kept).

- [Minor] R1 rename fallout incomplete — `CONTRIBUTING.md` and `SECURITY.md` still reference `M0P/insura`
  - Evidence: `CONTRIBUTING.md:15,36-38` (`git clone https://github.com/<your-user>/insura.git`, `cd insura`, `git remote add upstream https://github.com/M0P/insura.git`) and `SECURITY.md:24` (`https://github.com/M0P/insura/security/advisories/new`). Only `README.md` lines 36-37/136-137 were updated to `M0P/VersiGo.git`.
  - Required fix: update the `insura` URLs in `CONTRIBUTING.md` and `SECURITY.md` to `M0P/VersiGo` (or document them as out of scope in the PR description).

- [Minor] `docs/release-notes-v1.0.0-beta.1.md:74-75` — vitest version inconsistency
  - Evidence: the release notes state "vitest 3.2.7" while all four `package.json` files declare `"vitest": "^3.2.6"`. The caret range resolves to 3.2.7+, so this is cosmetic, but the notes should match the declared constraint.
  - Required fix: align the release-notes text with the declared `^3.2.6` (or bump the manifest to `^3.2.7`).

- [Minor] `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:353` — dialect resolved twice per search
  - Evidence: `searchDocuments` calls `resolveDialect` at line 353 and then `get()` (line 356) resolves it again internally (line 180). Harmless because of the cache, but redundant and slightly confusing.
  - Required fix: drop the explicit `resolveDialect` call in `searchDocuments` and rely on `get()`'s resolution (or pass the dialect through).

## Verification

### Explicit confirmations requested

**(a) Dialect negotiation correct and safe — YES (with one Minor caveat).**
- Probe only ever targets `${baseUrl}/api/documents/?page_size=1` where `baseUrl` is the configured `PAPERLESS_URL` — no new SSRF surface (the same URL is used for all other calls; TLS relaxation is the pre-existing opt-in flag).
- 406 → `legacy` (unversioned `Accept` + `?q=`); 200/401/403 → stays `v2` (401/403 surface the real token/permission error as before); communication errors never throw.
- Cache keyed by `baseUrl::apiToken`, so config changes trigger re-probing.
- `healthCheck()` and the document listing (`get`) use the negotiated header.
- All 5 required unit scenarios are present in `paperless-ngx.service.spec.ts` (406→legacy with `q=`, v2 stays, healthCheck negotiated header, cache reset on config change, 401/403 keeps v2), plus the `MockHttpService = HttpService & { get: ReturnType<typeof vi.fn> }` typing fix.
- Caveat: the silent v2-caching on transient probe errors (finding #1).

**(b) German user-visible UI strings changed — NO.** `apps/web/src/i18n/locales/de.ts` (and `en.ts`) are intact; `settings-catalog.ts` German descriptions/groups (user-visible via admin UI) are unchanged; `portal-connector.service.ts` German `reason` strings and `admin-settings.controller.ts` German connectivity messages (user-facing API responses) are unchanged. Only non-UI code comments/log strings were translated.

**(c) Spec assertions match production strings — YES.** `portal-connector.service.spec.ts:189,208` assert `'nicht registriert'`/`'fehlgeschlagen'`, matching the intentionally kept German `reason` strings in `portal-connector.service.ts:107,120`. `ai-extraction.processor.spec.ts:75,133` assert `'retry required'`/`'Maximum number of retries'`, matching the translated English strings in `ai-extraction.processor.ts:423,435`. `restart.service.spec.ts` no longer asserts the old German log string (production `restart.service.ts` is now English).

**(d) Dockerfile upload fix correct for fresh named volumes — YES.** Both `apps/api/Dockerfile:198` and `apps/worker/Dockerfile:148` run `RUN mkdir -p /data/uploads && chown -R appuser:appgroup /data/uploads` before `USER appuser`; Docker/Podman copy-up preserves image ownership for fresh named volumes, so the `EACCES` root cause is addressed. Smoke test check 4b (`compose-smoke-test.sh:301-318`) probes writability with a touch+rm pair inside the API container.

### Other areas inspected
- Version bump: all 5 `package.json` at `1.0.0-beta.1`; `APP_VERSION` optional string in `app-config.schema.ts:70`; `AppConfigService.appVersion`; `HealthController` returns `version` on `/health`+`/ready` (with `'unknown'` fallback, tested in `health.controller.spec.ts`); web footer in `app-shell.tsx:269-271` via `getAppVersion()`; `docker-compose.yml` passes `APP_VERSION`/`NEXT_PUBLIC_APP_VERSION`; `.env.example:37-38`; README config table and `docs/13-settings-catalog.md:139` updated.
- B5: `pnpm-workspace.yaml` overrides (postcss ^8.5.23, sharp ^0.35.3, vite ^6.4.3) and vitest ^3.2.6 in all packages.
- Docs: `docs/release-notes-v1.0.0-beta.1.md` (new, concrete), `docs/release-guide.md:151-152` references the concrete notes, `docs/beta-release-checklist.md` R-12 + version row updated.
- Hygiene: `prompts/BugFix-03-post-bugfix02-issues.md` is gone (glob returns nothing).

### Remaining risks / not fully verified (no tool access left)
- `docker-compose.dockerhub.yml` was not inspected — confirm it also passes `APP_VERSION`/`NEXT_PUBLIC_APP_VERSION` (the Docker Hub deployment path would otherwise show `'unknown'`).
- Worker liveness endpoint (`worker-liveness.service.ts`) was not inspected for a `version` field; the work package only requires `/health`+`/ready` on the API, so this is likely fine but unverified.
- `pnpm-lock.yaml` sync and the `.env.test*` files were not diffed (no git tooling).
- The smoke-test "32 checks" count is not an explicit counter in the script; check 4b is present and numbered correctly.

## Recommendation
All findings are Minor (5 ≤ 8), so the package passes the review threshold. Before committing, address the two most useful Minors: (1) don't cache the dialect on non-406 probe errors (and log the probe failure), and (2) finish the German-comment sweep in `apps/web` + `oidc.strategy.ts` and the `insura` URL cleanup in `CONTRIBUTING.md`/`SECURITY.md`.
