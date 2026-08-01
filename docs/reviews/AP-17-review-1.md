# AP-17 Review — Iteration 1

Review executed: 2026-08-01 by the `@code-reviewer` subagent (read-only) against the
uncommitted AP-17 change set on `feat/AP-16-roles-rechte-lokale-registrierung`.
Docker gates were not re-run in this read-only pass (implementer reports both green).

Review result saved verbatim below (as returned by the code-reviewer):

---

Maximum steps reached — I must stop making tool calls. I have completed a substantial portion of the review (all central server-side code, catalog, resolver, preload, encryption, migrations, smoke test, Dockerfile/compose, and the two main UI pages). The test specs, remaining web files, and docs/.env.example could not be read before the limit.

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 4
- Minor: 6
- Verdict: **CHANGES REQUIRED** (Medium findings present; per verdict rule PASS requires zero Critical/High/Medium)

Note: I did not run the Docker-Compose gates (static review only). Findings below are based on direct file inspection; anything inferred is marked as such.

## Findings

### Medium

- [Medium] `apps/api/src/features/system-config/system-config.service.ts:111` — **Connectivity tests are not audited**
  - Evidence: AP-17 requirement 8 explicitly requires "Änderungen, Zurücksetzen … und Connectivity-Tests werden revisionssicher auditiert". `testConnectivity()` (lines 111–154) performs no `audit()` call; `audit()` (lines 243–261) only supports the action types `SYSTEM_CONFIG_UPSERTED | SYSTEM_CONFIG_RESET`. So `POST /admin/system-config/:key/test` runs without any audit trail, violating the acceptance criteria.
  - Required fix: Extend the audit action type (e.g. `SYSTEM_CONFIG_TESTED`) and record key + redacted result in `auditEvent` from `testConnectivity`, without including URLs, tokens, or response content.

- [Medium] `packages/foundation/src/config/settings-preload.ts:63` — **Preload writes unvalidated DB values into `process.env`, can brick API/Worker boot**
  - Evidence: `preloadRestartSettingsIntoEnv` writes `env[row.key] = rawValue` for any non-empty stored value without calling `validateSettingValue`. `parseAppConfig` (`app-config.schema.ts:105-106`, `167-176`) fails hard (throws) on invalid env values: `LOCAL_AUTH_MAX_ATTEMPTS` uses `z.coerce.number().int().positive()`, `STORAGE_ENABLED` uses `booleanFromEnv` (strict `true`/`false`). An invalid persisted value (e.g. `LOCAL_AUTH_MAX_ATTEMPTS="banana"`, `STORAGE_ENABLED="yes"`) written to env by the preload would make `AppConfigService` throw and the whole API/Worker fail to start — directly contradicting the documented fail-soft guarantee (preload comment lines 18–29) and the AP-17 invariant "ein ungültiger UI-Wert aktiviert NIE einen defekten effektiven Zustand". The new system-config API cannot persist invalid values (it validates), but the legacy `/admin/settings` endpoints and direct DB edits can (see next finding).
  - Required fix: In the preload, validate each row value via `validateSettingValue` against the catalog definition; skip and warn on invalid values instead of writing them into `env`.

- [Medium] `apps/api/src/features/admin-settings/admin-settings.controller.ts:68` + `admin-settings/settings-store.service.ts:56` — **Legacy `/admin/settings` endpoints bypass the catalog allowlist and validation**
  - Evidence: `POST/PATCH /admin/settings(/:key)` accept arbitrary `dto.key`, `dto.valuePlain`, `dto.isSecret` and persist directly to `global_integration_settings` with no catalog check and no `validateSettingValue` call. These rows are read by both the `SettingsResolverService` and the boot preload. Consequences: (a) arbitrary unknown keys can be injected into the settings table (violates "kein Mechanismus darf beliebige .env-Namen/JSON/unbekannte Schlüssel über die UI einschleusen"); (b) invalid values for catalogued restart keys can be persisted, which the preload then injects unvalidated (see previous finding); (c) a catalogued `secret` key can be stored as plaintext (`isSecret=false` → `valuePlain`), which the resolver/consumers would then read as plaintext. Reachable only by ADMIN, so not Critical.
  - Required fix: Route the legacy endpoints through the same allowlist/type validation (or deprecate/remove them in favor of the new `/admin/system-config` feature) and enforce the catalog `isSecret` category rather than a caller-supplied boolean.

- [Medium] `apps/api/src/features/system-config/system-config.service.ts:126` (and legacy `admin-settings.controller.ts:184`) — **Connectivity tests are not SSRF-guarded**
  - Evidence: AP-17 requirement 7 explicitly requires "SSRF-guarded" connectivity tests. `buildEndpoint`/`testConnectivity` construct `fetch(url)` from the admin-configured base URL (which may be `http://localhost`, `http://172.x`, `http://169.254.x`, etc.) with no scheme allowlist and no private-IP/loopback/link-local guard; the legacy `POST /admin/connectivity-test` even accepts an arbitrary `dto.endpoint` + `dto.apiToken` and fetches it. Impact is limited to ADMIN-initiated requests, hence Medium, but the requirement is explicit.
  - Required fix: Restrict test URLs to `http(s)://` and reject loopback/private/link-local/metadata addresses (or explicitly document that admin-initiated probing is intended and gate it accordingly), and cap the token usage to the catalogued secret for the tested key.

### Minor

- [Minor] `apps/web/src/app/settings/page.tsx:55` — READ_ONLY profile page intent vs. behavior: the 403 handler in `loadProfile` does `window.location.href = '/forbidden'`, so a READ_ONLY user who opens `/settings` gets redirected instead of seeing the page's own READ_ONLY warning banner (lines 85–95). Either skip the fetch for READ_ONLY or drop the redirect to keep the graceful message.
- [Minor] `packages/foundation/src/config/settings-resolver.service.ts:74` / `system-config.service.ts:184` — For `restart` category, the resolver reports the pending DB value as `effectiveValue`/source `UI` while the running process still uses the boot-time env value; the "Neustart erforderlich" badge mitigates a false "active" claim, but the displayed "effektiver Wert" is not actually the active value until restart. Consider labeling it as "Wert nach Neustart" to be unambiguous.
- [Minor] `packages/foundation/src/config/settings-validation.ts:57` — String type accepts an empty string (no min length) and `update()` persists it, but the resolver treats empty/whitespace values as "not set" (`settings-resolver.service.ts:71`) — an admin can create a stored row that is displayed as unset (`uiValuePresent:false`) yet still exists. Consider rejecting empty strings in validation.
- [Minor] `scripts/compose-smoke-test.sh:463` — crash-loop detection captures `pgrep -f … | head -1`; if more than one process matches (e.g. an `sh` wrapper plus `node` if `start.sh` does not `exec`), PID selection/ordering is not guaranteed, and the 5 s window misses slower crash-loops (mitigated by the step-10 round-trip). Robustness nit; pattern and busybox `pgrep -f` support match the actual worker command `node apps/worker/dist/apps/worker/src/main.js`.
- [Minor] `apps/api/src/features/system-config/system-config.service.ts:47` — `list()` calls `resolver.resolve(key)` per catalogued key (DB read + decrypt for secrets) — N+1 DB round trips (~30 keys). Consider a batched resolution for the list view.
- [Minor] `apps/api/src/features/system-config/system-config.service.ts:186` — `uiUpdatedBy` exposes the raw actor user UUID to the admin UI; consider resolving to the username for readability (requirement 5: "soweit datenschutzkonform").

## Verification

Inspected (verified facts): work package AP-17, AGENTS.md, `prompts/00-gemeinsame-regeln.md`, `prompts/PR-REVIEW.md`; the complete new foundation config layer (`settings-catalog.ts`, `settings-validation.ts`, `settings-resolver.service.ts`, `settings-preload.ts`, `settings.module.ts`, `config/index.ts`, `app-config.service.ts`, `app-config.schema.ts`, `aes-gcm-encryption.adapter.ts`); `system-config` controller/service/DTO; `profile` controller/service/DTO; `user-preferences` controller/service/DTO (allowlist, unknown-key rejection, `@Roles(GlobalRole.USER)`); `admin-settings` controller/store/feature-flags; `ai-assist` (service/registry/adapters/module), `paperless-ngx` service/module, worker `main.ts`/`worker.module.ts`/`ai-extraction.processor.ts` — all rewired to `SettingsResolverService`; no direct `process.env` reads found in API/Worker feature code (grep over `apps/**/*.ts`); `roles.guard.ts` (hierarchical ADMIN>USER>READ_ONLY) + `auth.guard.ts` registered as global `APP_GUARD`s in `identity.module.ts`; Prisma migration `20260801130000_ap17_system_settings_actor`; full `compose-smoke-test.sh` (steps 8b–8e, log-independent worker readiness via in-container `pgrep`, BullMQ terminal-state check via Redis); `Dockerfile` (node:24-alpine → busybox `pgrep` available), `docker-compose.yml` (worker command string matches the pgrep pattern).

Checks passed by inspection: server-side permission matrix on all three features (READ_ONLY/USER get 403 via RolesGuard before any handler runs); secrets encrypted at rest (AES-256-GCM), masked in all DTOs, never logged, audit `diffJson` redacted; UI>ENV>DEFAULT priority and invalid-value skip logic in the resolver; audit rows for upsert/reset (values redacted); smoke-test secret-leak greps; connectivity-test timeout (5 s AbortController).

Could not verify (step limit reached before these reads): all new spec files (`settings-catalog.spec.ts`, `settings-resolver.service.spec.ts`, `settings-preload.spec.ts`, `system-config.*.spec.ts`, `profile.*.spec.ts`, `user-preferences.service.spec.ts`) — requirement 12 coverage unverified; `apps/web/src/contexts/theme-context.tsx` (requirement 11 403 degradation), `nav-config.ts`, `globals.css` (a11y/contrast), `appearance-settings.tsx`, `use-current-user.ts`; `docs/13-settings-catalog.md`, `.env.example`, `docker-compose.test.yml`, README updates (requirement 14); `docker/start.sh` (assumption that the worker's node process cmdline matches the pgrep pattern); whether Docker-Compose gates actually pass (requirement 13 — static review only, no Docker run attempted).

Remaining risk: the interaction between the legacy `/admin/settings` persistence path and the new resolver/preload (Medium 2+3) is the most security/correctness-relevant gap found; it should be resolved before merge.

---

## Severity counts (one line)
Critical: 0, High: 0, Medium: 4, Minor: 6 — Verdict: CHANGES REQUIRED
