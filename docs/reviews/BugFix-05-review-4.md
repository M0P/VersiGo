# BugFix-05 Review 4 (findings #1–#8, round 2)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_02eb23d20ffeDp34KOJ0ZAhULh`), 2026-08-05.

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 3
- Verdict: **CHANGES REQUIRED**

Note: the reviewer reached its step budget and could not complete every intended
read (notably `oidc.strategy.ts` in full and the git diff itself). The single
Medium below is an evidence-based completeness gap in the round-1 #2 fix that
must be verified before merge; everything else inspected is clean.

## Findings

1. **[Medium] `apps/api/src/features/identity/oidc.strategy.ts:61` (+ `identity.module.ts:41-63`) — Round-1 #2 not fully resolved: DB-down boot can still fail via `OidcStrategy.onModuleInit`**
   - Evidence: `CapabilityFlagsService.isEnabled()` (`packages/foundation/src/capabilities/capability-flags.service.ts:49-58`) first calls the DB-backed `SettingsResolverService.getEffectiveBoolean()`; a throw propagates (no catch in `isEnabled`, the `config.get` fallback only applies when `resolved === undefined`). The round-1 fix added a try/catch **only** in `IdentityModule.onModuleInit` (lines 50-63). But `OidcStrategy` is a provider of the same module (identity.module.ts:21) and its `onModuleInit` calls `await this.capabilities.isEnabled('oidc')` at line 61 with no visible guard. NestJS runs `onModuleInit` on every provider; if the resolver rejects while the DB is down, the strategy init rejects and the whole boot fails — contradicting the fix's own stated goal ("Die API startet dann trotz DB-Ausfall", identity.module.ts:46-47). The compose gate passed with the DB **up**, so the DB-down boot path is exactly the case left unverified.
   - Required fix: verify `oidc.strategy.ts:onModuleInit` wraps the `isEnabled('oidc')` call (and `discoverClient()`) in the same try/catch + env-snapshot fallback used in `identity.module.ts`; if not, add it, and extend `identity.module.spec.ts` (or a strategy spec) with a "DB down + OIDC disabled → boot resolves" case. Alternatively confirm `SettingsResolverService` is fail-soft (the current code comment says it is not).

2. **[Minor] `apps/web/src/app/policies/[id]/covered-persons-tab.tsx:141-143`, `documents-tab.tsx:126-128`, `portal-links-tab.tsx:160-162` — delete-error `setError` bypasses the `requestSeq` guard**
   - Evidence: Round-1 #1 is otherwise correctly resolved (all three tabs use a shared monotonic `requestSeq`; every reload captures `seq = ++requestSeq.current`, all data/loading/error writes inside `reload…()` are seq-guarded, and the effect cleanup increments the counter so in-flight requests from the previous `policyId` are invalidated). The only unguarded state write left is the `catch` of `handleDelete`, which calls `setError(...)` without a seq check. If a DELETE on policy A fails after the user has navigated to B, the error banner renders under B.
   - Required fix: in the delete `catch`, check the current seq (e.g., capture `const seq = ++requestSeq.current` at handler start and only `setError` when `seq === requestSeq.current`), mirroring the reload pattern.

3. **[Minor] `apps/web/src/components/ui/app-shell.tsx:56-72` — family-sharing nav visibility is evaluated once on mount, not reactively**
   - Evidence: `familySharingEnabled` is fetched from `/ready` in a mount-only effect; toggling `FAMILY_SHARING_ENABLED` to `false` in the running UI hides `/household/shares` only after a full page reload, not immediately (the nav state is otherwise static in `NAV_SECTIONS`). Acceptable as documented fallback, but it does not fully meet "bei Deaktivierung … der Nav-Eintrag wird ausgeblendet" without a reload.
   - Required fix: re-check the capability on route change (e.g., key the fetch on `pathname`) or document the reload requirement explicitly.

4. **[Minor] `apps/web/src/app/policies/[id]/costs/page.tsx:175` and `costs-overview-card.tsx:113` — ANNUAL per-frequency row reuses the `costs.annualGross` label**
   - Evidence: the "per period" display labels the ANNUAL amount with `t('costs.annualGross')` ("Annual costs (gross)") instead of a per-year label; the value is correct, the label is slightly misleading (cosmetic).
   - Required fix: use a dedicated key (e.g., `costs.perYear`) in `en.ts`/`de.ts` with parity.

## Round-1 findings — verified status
- **#1 (race guard)** → verified resolved (seq logic is sound; all reset/loading/data writes guarded; effect deps `[policyId]` correct; reset behavior preserved; see Minor #2 for the one residual unguarded write).
- **#2 (identity boot)** → fix itself (try/catch + `AppConfigService` env fallback + fail-fast) is correct and matches pre-BugFix-05 behavior (`LOCAL_AUTH_ENABLED` default `NODE_ENV !== 'production'`); the 6 spec cases are sound and match the constructor arg order `(capabilities, config, adminBootstrap)`. Remaining gap = the OIDC strategy path (finding #1 above).
- **#3 (dead `group`)** → verified resolved: `FEATURES` array in `admin/features/page.tsx` uses only i18n keys; no hardcoded German UI strings remain; `group: string` retained only in the `SystemConfigEntry` DTO mirror.
- **#4 (`@MaxLength(2048)`)** → verified resolved on both `portalUrl` fields (policy-registry.dto.ts:235 and :278), comments updated.
- **#5 (`FAMILY_SHARING_ENABLED`)** → verified resolved: `booleanFromEnv.default(true)` at app-config.schema.ts:170 with a full constraint comment (empty-string rejection, `optionalBooleanFromEnv` recommendation) at lines 163-170.
- **#6 (docs)** → verified resolved: `docs/ui-control-matrix.md` rows for Feature-Verwaltung (`/admin/features`, line 75) and FamilySharingGuard on Freigaben übersicht (line 97).

## Fresh scope checks (findings #1–8)
- Admin-only enforcement: features page handles 401/403 client-side; API enforcement stays server-side via `RolesGuard` (catalog `permission: 'ADMIN'`); no hardcoded credentials found.
- Secrets masked: `FeatureField` renders `••••••••` for secrets, `type="password"` inputs, value cleared on edit start; `OIDC_CLIENT_SECRET` is `secret`+`bootActivation` and covered by `getBootPreloadKeys()`.
- Household isolation: `getHouseholdSummary` keeps `assertHouseholdAccess` + `getReadablePolicyIds` READ_ONLY filtering; both family-sharing controllers behind `HouseholdMembershipGuard` + `FamilySharingGuard` (403 path).
- Cost math: `PERIOD_DAYS` (365.25-based), `derivePerFrequency` (annual/12/4/2), `calculatePaidToDate` (pro-rata `days/PERIOD_DAYS`, future `validFrom` skipped, `validTo` capped) — consistent and reused by both `getOverview` and `getHouseholdSummary`; `selectActiveOrLatestEntry` fallback correct. The `+1` inclusive day count slightly over-counts partial periods (documented approximation). Route order `overview`/`annual`/`compare` before `:entryId` — correct.
- i18n: en/de parity verified for `nav.features`, `admin.features.*`, and `costs.*` (incl. `paidToDate`, `perPeriod`, `perMonth/Quarter/HalfYear`, `perPolicy`, `frequency`, `asOf`, `since`).
- `CapabilityFlagsService` fully async via resolver with `AppConfig` fallback; `/ready` (`health.controller.ts`) exposes `capabilities` from `snapshot()` for the app-shell nav; DB-down falls back to nav-visible default.
- No scope violations observed: all inspected changes map to findings #1–8; Dockerfile work (#9) was not touched in the inspected files.

## Verification
- Reviewed: all three tabs, `identity.module.ts` + its spec, `admin/features/page.tsx`, both portal-url DTOs, `app-config.schema.ts`, `settings-catalog.ts`, `capability-flags.service.ts`, `family-sharing.guard.ts` + both controllers, `cost-tracking.service.ts`/`controller.ts`, policy + household costs pages, `costs-overview-card.tsx`, `app-shell.tsx`, `globals.css` (sidebar/drawer/logout), `nav-config.ts`, `health.controller.ts`, `ui-control-matrix.md`, en/de locale files.
- The reviewer could not run `git diff`/`git status` (no shell tool in its environment) and did not fully read `oidc.strategy.ts` or `settings-resolver.service.ts` — the two files that decide whether finding #1 above is real or already handled.
- Remaining risk: DB-down boot path (finding #1); recommend confirming before commit.

**Recommendation:** resolve/verify finding #1 (OIDC strategy DB-down path), then the remaining items are cosmetic; round-1 findings #1–6 are otherwise correctly and completely fixed.
