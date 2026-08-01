# AP-17 Review Round 2

Date: 2026-08-01
Reviewer: code-reviewer subagent (DeepSeek)
Scope: all uncommitted AP-17 changes (round-1 fixes M1–M4, m1–m6 plus full package)

## Review result

- Critical: 0
- High: 0
- Medium: 1
- Minor: 5
- Verdict: **CHANGES REQUIRED**

## Round-1 Findings Resolution

- **M1 (Connectivity-Tests nicht auditiert) — RESOLVED.** `system-config.service.ts:148,181` now emits `SYSTEM_CONFIG_TESTED` audits with redacted `diffJson` (`{ key, redacted: true, outcome }`); covered by `system-config.service.spec.ts:290-316` and by the guard spec.
- **M2 (Preload schreibt unvalidierte DB-Werte in process.env) — RESOLVED.** `settings-preload.ts:86-95` validates each row via `validateSettingValue` and skips+warns on invalid values before writing the canonical form; spec `settings-preload.spec.ts:55-71` asserts invalid values are never written. Because the preload also writes only canonical values, `parseAppConfig` can no longer be bricked by persisted garbage.
- **M3 (Legacy /admin/settings umgeht Allowlist/Validierung) — RESOLVED.** `admin-settings.controller.ts:85-99` routes create/update through `assertCatalogSetting` (unknown → BadRequest, bootstrap → BadRequest) and `validateLegacyValue`, which forces `isSecret` from the catalog category and runs `validateSettingValue` (controller spec lines 176-255 cover allowlist, bootstrap, forced-secret, invalid-value, empty-string rejection).
- **M4 (Connectivity-Tests ohne SSRF-Schutz) — RESOLVED.** `connectivity-guard.ts` implements scheme/IPv4/IPv6/IPv4-mapped-IPv6/hostname/DNS-resolution blocking and is applied in `system-config.service.ts:153` and in the legacy controller `admin-settings.controller.ts:191`. Guard spec covers loopback/private/link-local/metadata literals, hostname suffixes, and DNS resolution checks.
- **m1 (READ_ONLY-Profile-403-Redirect) — RESOLVED.** `apps/web/src/app/settings/page.tsx:75` skips the profile fetch for `READ_ONLY` and renders the warning banner (lines 92-101) instead of redirecting.
- **m2 (pendingRestartValue-Semantik) — RESOLVED.** Resolver returns active `value`/`source` plus separate `pendingRestartValue` (`settings-resolver.service.ts:139-153`), and the admin UI renders it as "Wert nach Neustart" (`admin/settings/page.tsx:450-457`).
- **m3 (leere Strings akzeptiert) — RESOLVED.** `settings-validation.ts:37-43` rejects empty/whitespace values; system-config and legacy controllers reject empty values and persist nothing.
- **m4 (Smoke-Test crash-loop detection) — NOT ADDRESSED.** `compose-smoke-test.sh:463-470` still uses `pgrep … | head -1`; remains a robustness nit, mitigated by the step-10 round-trip. Low risk, non-blocking.
- **m5 (N+1 in list()) — RESOLVED.** `resolveMany` (`settings-resolver.service.ts:81-97`) batches into one `findMany`; `system-config.service.ts:63` uses it (spec asserts one DB call, resolver spec lines 267-304).
- **m6 (uiUpdatedBy rohe UUID) — RESOLVED.** `resolveUsernames` (`system-config.service.ts:232-253`) resolves to usernames with UUID fallback; asserted in `system-config.service.spec.ts:166`.

## Findings

### Medium

- [M5] `apps/api/src/features/system-config/system-config.service.ts:145-153` + `apps/api/src/common/connectivity/connectivity-guard.ts:112-121` — **Connectivity-Test kann den Standard-/Dokumentationsfall (Ollama auf localhost) prinzipiell nie bestehen**
  - Evidence: The catalog default for `AI_OLLAMA_BASE_URL` is `http://localhost:11434` (`settings-catalog.ts:97`, `.env.example:99`, `docs/13-settings-catalog.md:75`). `assertSafeTestEndpoint` rejects every `localhost` hostname (and any DNS name resolving to private/link-local ranges). Therefore the connectivity test for Ollama — the documented default and the most common local/dev setup — always returns "Endpunkt aus Sicherheitsgruenden abgelehnt" even when Ollama is reachable. The same applies to a compose-internal Ollama reachable under a container hostname (resolves to 172.x → blocked). The unit test masks this: `system-config.service.spec.ts:307` mocks `assertSafeTestEndpoint` to pass, so the real guard/default interaction is never exercised. The docs describe the test only as "sicherer Connectivity-Test … 5 s Timeout" without documenting the public-endpoint-only restriction, so an admin with the default config gets a guaranteed misleading failure for a documented feature.
  - Required fix: Document the public-endpoint-only restriction in `docs/13-settings-catalog.md`/admin UI, and/or provide an explicit, admin-confirmed opt-in path for loopback (e.g. only for configured catalogued keys), or surface a clearer hint in the result message when the configured value is loopback/private.

### Minor

- [m7] `apps/api/src/common/connectivity/connectivity-guard.ts:163-178` — **DNS-Rebinding TOCTOU: lookup-Check und fetch-Auflösung sind getrennt**
  - Evidence: The guard resolves and validates DNS addresses, but `fetch(url)` (system-config.service.ts:158) re-resolves the hostname afterwards. A rebinding DNS can serve a public IP at check time and a private/metadata IP at fetch time. The comment acknowledges only "einfaches DNS-Rebinding". Admin-initiated and low-impact, but the review focus explicitly asked about DNS rebinding.
  - Required fix: Either document the limitation, or pin the connection to the validated resolved address (fetch by IP + `Host` header).

- [m8] `packages/foundation/src/config/settings-resolver.service.ts:139-153` + `apps/api/src/features/system-config/system-config.service.ts:216-222` — **Nach erfolgtem Neustart wird der bereits aktive DB-Wert weiterhin als "pendingRestartValue" und Quelle "ENV" angezeigt**
  - Evidence: After a restart the preload writes the DB value into `process.env` (`settings-preload.ts:99`). The resolver then reports `source: 'ENV'` for a value that actually originates from the DB preload, while also emitting the identical value as `pendingRestartValue`; the "Neustart erforderlich" badge (`restartRequired`, category-based) shows permanently for restart keys even when the value is already active. Effective value is correct, but labeling is misleading.
  - Required fix: Suppress/compare `pendingRestartValue` against the active env value (hide when equal) and clarify the source/reason for preloaded values.

- [m9] `apps/api/src/features/admin-settings/admin-settings.controller.ts:85-87` + `settings-store.service.ts:56-89` — **Legacy-create mit `valuePlain === undefined` erzeugt weiterhin eine "tote" Zeile ohne Wert**
  - Evidence: `validateLegacyValue` returns `{ valuePlain: undefined }` for a missing value, and `createGlobalSetting` persists a row with both `valueEncrypted`/`valuePlain` null. The resolver treats it as unset (`uiValuePresent:false`), so the row is harmless but invisible to the admin UI and can never be listed/reset there.
  - Required fix: Reject create-without-value on the legacy endpoints or auto-delete empty rows.

- [m10] `apps/api/src/features/system-config/system-config.service.ts:171-177` — **`Verbindungsfehler: ${error.message}` kann hostname-Ähnliche Details an die Admin-UI zurückgeben**
  - Evidence: Non-guard fetch failures surface `error.message` verbatim (e.g. DNS/connect error text). This is not a secret leak (the URL is admin-known and tokens are never included), but response content is not normalized; keep as-is or map to a generic message.
  - Required fix: Optional — map fetch errors to a generic "Verbindungsfehler" without echoing resolver/error internals.

- [m11] `prisma/migrations/20260801130000_ap17_system_settings_actor/migration.sql` — **Keine Bereinigung bestehender Klartext-Secure-Rows**
  - Evidence: Rows for catalogued `secret` keys persisted before the M3 fix (via legacy endpoints with `isSecret=false`) would remain plaintext in `valuePlain`; the resolver then serves them as plaintext to consumers. The fix prevents new occurrences but does not migrate existing ones. Pre-existing data concern, not a new write path.
  - Required fix: Consider a data migration that re-encrypts catalogued secret rows stored as plaintext (or document it as acceptable for the dev-only stage).

## Verification

- Tests/checks reviewed: `settings-catalog.spec.ts`, `settings-resolver.service.spec.ts`, `settings-preload.spec.ts` (incl. fail-soft skip, timeout), `connectivity-guard.spec.ts` (IPv4/IPv6/mapped-IPv6/hostname/DNS), `system-config.service.spec.ts` (audit contents, no-secret assertions, SSRF call path), `system-config.controller.spec.ts` (ADMIN metadata), `admin-settings.controller.spec.ts` (M3 paths), `feature-flags`/`user-preferences` specs, `compose-smoke-test.sh` steps 8b-8e (system-config auth, secret-leak greps, update/reset, profile) and step 10 round-trip.
- Docker gates (`docker compose -f docker-compose.test.yml …` and `./scripts/compose-smoke-test.sh`) were **not re-run** in this read-only pass (no shell tool available); per instructions the implementer-reported "All checks passed!" (470 API tests, 39 files) and smoke pass are trusted. Static inspection found no test that fails as written.
- Important areas inspected: catalog/validation/preload/resolver, system-config service/controller/DTO (audit incl. `SYSTEM_CONFIG_TESTED` outcome, username resolution, batched list), SSRF guard, legacy admin-settings allowlist/validation/forced-secret/SSRF wiring, profile + user-preferences authorization (`@Roles(USER)`/`ADMIN` hierarchy via `roles.guard.ts`), web pages (admin/settings + settings READ_ONLY banner + pendingRestartValue display), module wiring (API `app.module.ts`, worker), `main.ts`/worker `main.ts` preload, migration, `.env.example`/compose (`SETTINGS_ENCRYPTION_KEY` documented and required), and absence of direct `process.env` reads in `apps/api`/`apps/worker`.
- Remaining risks: the Ollama-default/localhost connectivity-test dead end (M5); pre-existing plaintext secret rows (m11); DNS-rebinding TOCTOU (m7) — all admin-gated and low-impact, none data-loss or auth related.
