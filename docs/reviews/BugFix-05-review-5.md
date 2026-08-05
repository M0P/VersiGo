# BugFix-05 Review 5 (findings #1–#8, round 3)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_02eaa340cffeHZ0wP9gzDvWx4t`), 2026-08-05.

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 3
- Verdict: **CHANGES REQUIRED**

## Findings

### Round-2 findings — verification status

1. **[Medium → verified resolved]** `apps/api/src/features/identity/oidc.strategy.ts:57-80` — DB-down boot no longer rejects via `OidcStrategy.onModuleInit`
   - Evidence: `isEnabled('oidc')` is wrapped in try/catch (lines 65-74) with env-snapshot fallback `Boolean(this.config.get('OIDC_ENABLED' as keyof AppConfig))` + warn log, mirroring `identity.module.ts:50-63`. `discoverClient()` is unchanged and fail-closed (catches + logs, `client` stays `null`). The two new spec cases (`oidc.strategy.spec.ts:163-203`) correctly assert only `onModuleInit` resolve + discovery call count (a: DB-down + env false → resolves, discovery not called; b: DB-down + env true + issuer/callback/clientId → resolves, discovery called once). They intentionally do not assert `strategy.isEnabled()` (request-time propagation of capability errors is legitimate).
   - Verified no other unguarded boot-path `isEnabled(`: all 24 call sites checked. Boot paths: `identity.module.ts:52-53` (guarded), `oidc.strategy.ts:66` (guarded). Request-time only: `monitoring.service.ts:201`, `family-sharing.guard.ts:23`, `auth.controller.ts:46/69/89/147/211`, `oidc.strategy.ts:112`. `portal-connectors.module.ts:25` is sync and capability-free. `LocalAdminBootstrapService.bootstrap()` never throws (catches all DB errors, lines 209-217), and `settings-preload.ts` is fail-soft (catch + 15s timeout), so the DB-down boot claim holds.

2. **[Minor → verified resolved]** Three policy tabs — delete-error `setError` now seq-guarded
   - `covered-persons-tab.tsx:137,146`, `documents-tab.tsx:122,131`, `portal-links-tab.tsx:156,165` all capture `const seq = ++requestSeq.current;` at `handleDelete` start and guard `setError(...)` with `seq === requestSeq.current`. Identical, consistent pattern across all three.

3. **[Minor → verified resolved]** `apps/web/src/components/ui/app-shell.tsx:58-74` — family-sharing nav visibility refetched per route change
   - Effect now depends on `[pathname]` (from `usePathname()`), cancelled-guard preserved, default `true` while loading, `.catch` resets to `true`. Toggling `FAMILY_SHARING_ENABLED` is now visible without a full reload.

4. **[Minor → verified resolved]** `costs.perYear` i18n key added with en/de parity
   - `en.ts:292` ('Per year') / `de.ts:285` ('Pro Jahr'); `costs/page.tsx:175` uses `t('costs.perYear')` for the ANNUAL per-frequency row; `costs-overview-card.tsx:112-113` correctly uses the frequency label. Grep confirms `annualGross` label is only used for real annual values (costs page:150, overview-card:100, household summary table header `costs.annualCosts`).

### New findings

1. **[Medium] `packages/foundation/src/health/health.controller.ts:45-52` — `/ready` returns HTTP 500 when the DB is down instead of the documented `{status:'degraded', database:'down'}`**
   - Evidence: `ready()` runs `Promise.all([db.isHealthy(), redisHealth.isHealthy(), workerHeartbeat.getStatus(), capabilities.snapshot()])`. The first three are fail-soft (`isHealthy` catches → `false`; `worker-heartbeat.service.ts:139-141` catches → `'unknown'`), but `capabilities.snapshot()` (`capability-flags.service.ts:61-76`) calls the DB-backed `settings.resolveMany(...)` with no try/catch. This is the one DB-dependent call in `/ready` introduced by the async/resolver capability change (Befund 1). With the DB down, `Promise.all` rejects → NestJS default 500 (no global exception filter in `main.ts`). This contradicts the package's own claim ("die API startet dann trotz DB-Ausfall und der Health-Endpunkt meldet db: down", `identity.module.ts:46-47`) and regresses the pre-change behavior where `snapshot()` was env-only. `health.controller.spec.ts:58-71` ("degraded when DB down") masks this because it mocks `isHealthy → false` while `snapshot` still resolves — an impossible combination in production.
   - Required fix: wrap the `capabilities.snapshot()` call (or the whole `Promise.all`) in try/catch and return a degraded/default capabilities map on failure, matching the fail-soft pattern of the sibling checks; add a spec case where `snapshot` rejects.

2. **[Minor] `apps/web/src/app/policies/[id]/{covered-persons,documents,portal-links}-tab.tsx` — `setFormError` in the submit catch remains unguarded and form state is not reset on `policyId` change**
   - Evidence: `covered-persons-tab.tsx:116`, `documents-tab.tsx:111`, `portal-links-tab.tsx:134` write `setFormError(...)` on the async submit path without a seq check, and the effect (policyId change) only resets `data/error/loading`, not `formError`/`showForm`/`form`/`editingId`. If a POST/PATCH for policy A fails after the user navigated to B (component stays mounted), the error renders in A's still-open form under B; the form fields themselves (with A's values) also persist and a subsequent submit would POST to B's endpoint.
   - Required fix: reset form state (`showForm=false`, `form` cleared, `formError=null`) in the effect body on policyId change, and/or seq-guard the `setFormError` in the submit catch.

3. **[Minor] `apps/web/src/app/policies/[id]/page.tsx:74-84` — page-level policy fetch has no reset/seq-guard, so policy A's header/master-data is transiently shown under `/policies/B`**
   - Evidence: the effect deps are `[policyId, t]`, but it never resets `policy`/`loading` and does not invalidate an in-flight request (no seq token, unlike the three tabs). Navigating A→B leaves `policy` holding A's data (header `policy.insurerName` line 222, master-data tab) until B's response arrives; a slow A response can even resolve after B's effect started and overwrite B's view. Directly relevant to Befund 8's "keine stale Daten von A unter B" acceptance criterion. (If this effect predates the package, the fix is still a trivial in-scope hardening.)
   - Required fix: in the effect, reset `setPolicy(null)`/`setLoading(true)` on policyId change and guard the `setPolicy` with a `cancelled`/seq token.

4. **[Minor] `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts:229-236,272-279` and `portal-links-tab.tsx:20-25` — no test pins the portal-URL normalization behavior**
   - Evidence: `policy-registry.dto.spec.ts` covers `ftp://` rejection and `https://` acceptance but not: `www.portal.de` → accepted and stored as `https://www.portal.de`, `javascript:`/`data:` rejection through the transform, or the `@MaxLength(2048)` cap — all explicitly in the package acceptance criteria. The client-side `normalizePortalUrl` (portal-links-tab) is also untested. The transform logic itself is correct (scheme regex requires `://`, so `javascript:alert(1)` gets `https://` prepended and fails `@IsUrl` port validation; `javascript://` is rejected by the protocols allowlist).
   - Required fix: add DTO spec cases asserting the transform output (`https://` prepend, http(s) unchanged) and the length cap; optionally export the client helper for a unit test.

## Scope notes
- No scope violations found: all inspected changes map to findings #1–8 and the review-driven fixes. Finding #9 (Dockerfiles, compose-smoke) untouched. Dead feature-flags UI fully removed (migration `20260804120000_bugfix05_remove_feature_flags` drops the table; no `feature-flags` service/page remain in source).
- Verified correct: settings-catalog v2 (`OIDC_*` restart/secret+bootActivation, `FAMILY_SHARING_ENABLED` runtime default true, `getBootPreloadKeys()`); restart values surface only as `pendingRestartValue` until reboot (`settings-resolver.service.ts:139-160`); `assertUiConfigurable` blocks bootstrap keys; secrets masked (`system-config.service.ts:220-221`, features page `••••••••`/password input, value cleared on edit); portalUrl transform + `@IsUrl` protocols + `@MaxLength(2048)`; household isolation + READ_ONLY filtering in all cost-tracking read paths; `/costs/overview`/`annual`/`compare` declared before `:entryId`; FamilySharingGuard on both shares controllers; en/de parity via the catalog-parity test; no hardcoded German in JSX (only comments).
- Dockerfile/foundation build (`FAMILY_SHARING_ENABLED` uses strict `booleanFromEnv`; variable not present in compose/.env — latent only, documented at `app-config.schema.ts:163-170`). `/ready`-fetching on every route change (app-shell) adds per-navigation DB queries on a public endpoint — acceptable trade-off, not raised.
- Remaining risk: the Docker Compose gate result (587 API tests, lint/typecheck/i18n) is trusted as reported; code inspection found nothing contradicting it.

**Recommendation:** resolve the `/ready` DB-down fail-soft gap (finding #1) before merge; the three minors are safe to fix in the same pass or defer.
