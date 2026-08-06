# BugFix-06 Review 2

Date: 2026-08-05
Scope: uncommitted changes on `fix/BugFix-06-release-verification` after fixing all round-1 findings (docs/reviews/BugFix-06-review-1.md)
Reviewer: DeepSeek code-reviewer (invoked via Task tool)

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 1
- Verdict: **CHANGES REQUIRED**

## Findings

- [Medium] `apps/api/src/common/connectivity/connectivity-test.ts:71` — Authorization header is forwarded to every redirect hop, including cross-host redirects
  - Evidence: The new manual redirect loop (`maxRedirects: 0` + per-Location re-validation) is otherwise correct — relative, absolute and protocol-relative `Location` values are resolved against `currentUrl` (line 89), each target is re-validated with the same `allowPrivate` mode (line 92), non-`UnsafeEndpointError` errors propagate, and the loop is capped at 5 redirects (lines 86–88). However, the `Authorization: Bearer ${options.token}` header (line 71) is applied on every iteration with no origin check. The SSRF guard only enforces address class (public in strict mode, non-metadata in relaxed mode), so a configured public endpoint that 302s to an attacker-controlled public host (or an http-downgrade) receives the admin's integration token (e.g. `PAPERLESS_API_TOKEN`, `AI_OPENAI_COMPAT_API_KEY`) in cleartext over the redirected hop. This is a credential-disclosure vector via open redirect, directly relevant to the new redirect-following code. Impact is bounded (admin-initiated test), but the token is a long-lived secret configured for the integration.
  - Required fix: Forward the token only when the redirect target's origin matches the origin of the originally validated URL (compare protocol + host + port), or strip the Authorization header on any redirect to a different origin. Add a spec asserting the token is not sent to a redirect target on another host.

- [Minor] `docs/13-settings-catalog.md:5` — stale catalog version in a doc file touched by this package
  - Evidence: The doc header states "Katalogversion: `SETTINGS_CATALOG_VERSION = 1`", but `packages/foundation/src/config/settings-catalog.ts:64` exports `SETTINGS_CATALOG_VERSION = 2`. This package updated the same file (SSRF/Connectivity section), so the version line is now factually wrong for the shipped catalog.
  - Required fix: Update the header to `SETTINGS_CATALOG_VERSION = 2` (and keep it in sync with the code on future bumps).

## Overall assessment

All 8 round-1 findings are correctly and completely addressed, with the fixes verified against the actual code and tests:

1. **HIGH (IPv4-mapped metadata bypass):** Fixed correctly. `extractMappedIpv4()` handles dotted-quad (`::ffff:169.254.169.254`) and canonical hex (`::ffff:a9fe:a9fe`) forms and is wired into both `isBlockedIpv6()` (strict mode) and `isCloudMetadataIpv6()` (relaxed mode, literal and DNS-resolved paths). Parsing edge cases (non-mapped `::ffff:` forms, extra hextets, invalid hex) degrade to conservative blocking in strict mode and produce no metadata bypass in relaxed mode; the `::ffff:808:808`→8.8.8.8 public-address case is correctly allowed. Tests cover literal + DNS paths (connectivity-guard.spec.ts:119–193).
2. **MEDIUM (redirect re-validation):** Fixed correctly for SSRF. Location resolution, protocol-relative URLs, the 5-redirect cap, per-hop re-validation with the same mode, and `UnsafeEndpointError`→failure handling are all sound; the real-local-server spec proves private redirects are blocked in strict mode, metadata redirects blocked even relaxed, safe redirects followed, and loops capped. The remaining gap is the token-header reuse described above.
3. **MEDIUM (cost period math):** Fixed correctly. `periodAmount()` scales by the months ratio in both directions (quarterly 300 under a monthly policy = 100/period), `getPaidHistory` and `calculatePaidToDate` use the identical resolved step frequency and identical per-period amounts (sum-of-periods == paidToDate), leap-year anchor realignment works, and rounding is applied consistently per period and on the total.
4. **MEDIUM (docs):** SSRF relaxation section and both `CONNECTIVITY_*` keys documented (table + security notes + metadata-always-blocked guarantee).
5. **MINOR (compose):** Both flags passed through to `api` and `worker` with `${VAR:-false}` defaults (docker-compose.yml:120–121, 168–169), consistent with `.env.example` (commented, off-by-default) and the catalog defaults.
6. **MINOR (OIDC spec):** 3 new tests exercise `execute=[allowInsecureRequests]`, `customFetch=relaxedFetch`, and the both-disabled branch; fail-closed fallback confirmed in `resolveConnectivityFlags()`.
7. **MINOR (catalog descriptions):** OIDC boot-time limitation documented (settings-catalog.ts:304–305).
8. **MINOR (addMonthsClamped):** Comment clarified (anchored, no chaining) and leap-year test added.

Task E (strict-mode regressions and the two callers): no regression found — strict mode still blocks all private/metadata forms including the new mapped-IPv6 handling, DNS resolution failures remain non-blocking, and both callers (admin-settings.controller.ts, system-config.service.ts) wire `allowPrivate`/`allowSelfSigned` consistently with fail-closed resolution (`?? false` on resolver errors). Task F (pinning/restart): the pin endpoints remain authorization-correct (route order, `@Roles`, household scoping, READ_ONLY via `getReadablePolicyIds`) and the restart flow (admin-only, Redis TTL, fail-soft, no secrets) is unchanged from the passing round-1 assessment. The redirect loop's behavior was verified against the real HTTP test server; the Docker test gate (626 API tests, lint/typecheck/i18n/turbo, smoke test) is taken as claimed since no shell was available to re-run it. Remaining risk beyond the single Medium is low; the metadata-vs-relaxed-mode invariant now holds for all documented forms.
