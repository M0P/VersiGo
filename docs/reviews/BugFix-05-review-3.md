# BugFix-05 Review 3 (findings #1–#8: feature config UI, portal URL, costs, spinners)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_02ebcc477ffeRvsWOQXe5Qlrlb`), 2026-08-05.

## Summary
- Critical: 0
- High: 0 (1 open verification item below could elevate)
- Medium: 1 (confirmed)
- Minor: 3 (confirmed)
- Verdict: **CHANGES REQUIRED** (Medium > 0; pending items must be resolved)

## Findings (confirmed)

1. **[Medium] `apps/web/src/app/policies/[id]/covered-persons-tab.tsx:106/132`, `documents-tab.tsx:101/117`, `portal-links-tab.tsx:124/151` — Handler-triggered reloads bypass the cancelled guard → stale foreign-data race**
   - Evidence: The mount/`[policyId]` effects call `reload…(() => cancelled)` with a guard, but `handleSubmit`/`handleDelete` call `reloadPersons()/reloadDocuments()/reloadLinks()` *without* the guard. Each reload also unconditionally does `set…([]); setLoading(true)`. If a user submits on policy A and navigates to policy B while the reload fetch is in flight, A's response can resolve last and overwrite B's data — exactly the "kein Fremddaten-Leak in der UI / keine stale Daten von A unter B" acceptance criterion of Finding #8. The fix introduced the guard only for effect reloads, not handler reloads.
   - Required fix: Thread the same `cancelled` flag into handler-triggered reloads (e.g., a shared `cancelledRef`/request-sequence token checked in every `reload…()` path), and skip the `set…([])`/`setLoading(true)` reset when a policyId change has already superseded the request.

2. **[Minor] `apps/web/src/app/admin/features/page.tsx:69,88,97,106,115` — Dead `group` field with hardcoded German UI strings**
   - Evidence: `FEATURES[].group` is populated (`'KI-Assistent'`, `'Authentifizierung'`, `'Speicher'`, `'Familien-Freigaben'`) but never read anywhere (`grep feature\.group` → no matches). The strings bypass the i18n catalogs (the guard doesn't flag them only because they match the identifier heuristic).
   - Required fix: Remove the unused `group` property, or render it via a `t()` key (en+de parity) if it is meant to be shown.

3. **[Minor] `packages/foundation/src/config/app-config.schema.ts:167` — `FAMILY_SHARING_ENABLED` uses the strict `booleanFromEnv` parser**
   - Evidence: `booleanFromEnv` rejects the empty string, while Docker Compose passes unset vars as `""`. Any future `FAMILY_SHARING_ENABLED=` entry in compose env (or `.env.example`) would fail the whole `parseAppConfig` and prevent API boot. This matches the pre-existing `STORAGE_ENABLED`/`AI_ENABLED` pattern, and `.env.example`/compose currently do not define the var, so it is latent rather than active.
   - Required fix: If compose/.env is ever extended, use `optionalBooleanFromEnv`; otherwise document the constraint.

4. **[Minor] `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts:232,273` — No `@MaxLength` on `portalUrl`, although the work package states "maximales URL-Längenlimit" must be retained**
   - Evidence: `CreatePortalAccountLinkDto.portalUrl` / `UpdatePortalAccountLinkDto.portalUrl` carry only `@PortalUrlTransform()` + `@IsUrl(...)`, no length cap (other fields like `accessHint` have `@MaxLength`). I could not diff the pre-change state to confirm whether a length limit previously existed; if it did, the normalization change dropped it.
   - Required fix: Add an explicit `@MaxLength` (e.g., 2048) on both `portalUrl` fields and re-check the prior behavior.

## Scope notes / verification still outstanding
- No scope violations observed: all inspected changes map to findings #1–#8; finding #9 (Dockerfiles, `compose-smoke`) was not touched in the inspected files.
- Confirmed correct: settings-catalog v2 with `FAMILY_SHARING_ENABLED` (runtime, default true), `OIDC_ENABLED` moved bootstrap→restart, `OIDC_CLIENT_SECRET` `secret`+`bootActivation`; `getBootPreloadKeys()` covers both; `CapabilityFlagsService` fully async via `SettingsResolverService` with `AppConfig` fallback for `LOCAL_AUTH_ENABLED`; all consumers (`oidc.strategy.ts`, `auth.controller.ts`, `identity.module.ts`, `monitoring.service.ts`, `health.controller.ts`) updated to `await`; prisma schema + `20260804120000_bugfix05_remove_feature_flags` migration drop the dead flag tables; feature-flags service/page removed from the tree; `FamilySharingGuard` applied to both controllers; READ_ONLY filtering preserved in `getHouseholdSummary`; `policies[]` per-policy table in `/household/costs`; `/costs/overview` route declared before `:entryId`; i18n en/de parity for the new `features.*` and `costs.*` keys checked manually.

## Remaining tasks (not completed — steps exhausted)
1. **Read `apps/api/src/features/identity/identity.module.ts` fully** — the fail-fast now calls the *async, DB-backed* `capabilities.isEnabled(...)`. If the resolver throws (DB down at boot) and the module does not catch it, boot could fail where it previously degraded. This is the item that could elevate to High; the preload's fail-soft guarantee does not automatically cover the resolver path.
2. Verify `admin-settings.controller.spec.ts`, `settings-catalog.spec.ts`, `settings-preload.spec.ts`, `settings-resolver.service.spec.ts`, `monitoring.service.spec.ts`, `health.controller.spec.ts`, `oidc.strategy.spec.ts` match the new async/catalog-v2 shapes (spot checks look consistent; `capability-flags.service.spec.ts` covers `familySharing` and resolver precedence).
3. Read `family-sharing.guard.spec.ts` for coverage of the 403 path.
4. Confirm `docs/ui-control-matrix.md` and security docs were updated per Finding #6, and that `docker-compose.yml`/`.env.example` do not define `FAMILY_SHARING_ENABLED` (empty-string parse risk).
5. Confirm the stated gate claim (`docker compose -f docker-compose.test.yml up --build …`, 583 API tests, i18n guard) via the actual CI/Compose run; the code gives no reason to expect a failure except the identity-module item above.

## Recommendation
Resolve finding #1 (race guard) and verify the identity-module boot path before merge; the remaining minors can be cleaned up in the same pass.
