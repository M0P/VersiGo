# BugFix-06 Review 1

Date: 2026-08-05
Scope: uncommitted changes on `fix/BugFix-06-release-verification` (work package `prompts/BugFix-06-release-verification-docker.md`, Teile 1–7)
Reviewer: DeepSeek code-reviewer (invoked via Task tool)

## Summary
- Critical: 0
- High: 1
- Medium: 3
- Minor: 4
- Verdict: **CHANGES REQUIRED**

## Findings

### High

- [High] `apps/api/src/common/connectivity/connectivity-guard.ts:209-234` — Cloud-metadata IPv4-mapped IPv6 bypass in relaxed mode
  - Evidence: With `allowPrivate: true`, the guard only checks `isCloudMetadataAddress(literal)`. For IPv6 that function matches only the exact literal `fd00:ec2::254`; the IPv4-mapped forms of the metadata address (`::ffff:169.254.169.254` or `::ffff:a9fe:a9fe`) pass `isIP()` as family 6, fail that comparison, and are **allowed**. Strict mode blocks them (via `isBlockedIpv6` → embedded IPv4 check), so this violates the explicit work-package guarantee that 169.254.169.254 stays blocked even when relaxation is enabled. A `new URL('http://[::ffff:169.254.169.254]/')` connects to the IPv4 metadata address through IPv4-mapped sockets. `connectivity-guard.spec.ts` has no test for this form in relaxed mode.
  - Required fix: In the relaxed branch, additionally reject any address for which `isBlockedIpv6` detects an IPv4-mapped IPv6 whose embedded IPv4 equals `169.254.169.254` (reuse the mapped-parsing logic), and add guard tests for `::ffff:169.254.169.254` / `::ffff:a9fe:a9fe` with `allowPrivate: true`.

### Medium

- [Medium] `apps/api/src/common/connectivity/connectivity-test.ts:44-55` — `testEndpoint` follows redirects without re-validating them
  - Evidence: Axios (^1.18.1) follows up to 5 redirects by default; `testEndpoint` does not set `maxRedirects: 0`. The guard validates only the original URL. A public endpoint that 30x-redirects to `http://169.254.169.254/...` or to a private RFC1918 address therefore issues a server-side GET to an internal/metadata target even when `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` is off — bypassing both the strict default and the "metadata always blocked" guarantee. Impact is limited (only status/statusText returned, not the body), but the guard's guarantee is broken.
  - Required fix: Disable redirect following (`maxRedirects: 0`) or re-run `assertSafeTestEndpoint` on each redirect Location, and add a test proving a 3xx to a private address is not followed.

- [Medium] `apps/api/src/features/cost-tracking/cost-tracking.service.ts:105-124,153-162` — period math uses policy frequency with entry-level amounts
  - Evidence: `calculatePaidToDate`/`getPaidHistory` step periods by the resolved frequency (policy `paymentFrequency`, fallback to active entry) but add the raw `entry.grossAmount` for each period, ignoring the entry's own `frequency`. Both values are independently user-settable: a policy with `paymentFrequency=MONTHLY` and a cost entry with `frequency=QUARTERLY` (gross 300) is summed as 300/month → 3600/year instead of 1200. The reverse undercounts. This produces wrong "paid to date" and per-period amounts for realistic data and is inconsistent with `derivePerFrequency`/`calculateAnnualGross`, which normalize on the entry's own frequency.
  - Required fix: When an entry's `frequency` differs from the step frequency, scale the period amount to the step period (or use the entry frequency as the stepping frequency per period), and add a unit test for the mismatch case.

- [Medium] `docs/13-settings-catalog.md:175-179` — Teil 2 documentation not updated (stale security guidance)
  - Evidence: The work package requires ".env.example, Settings-Catalog und Doku aktualisieren" for Teil 2. The code catalog (`settings-catalog.ts:293-320`) and `.env.example` contain the new keys, but this doc still states the test "erlaubt nur öffentliche http(s)-Endpunkte. Lokale/private Adressen ... werden abgewiesen" and does not document `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` / `CONNECTIVITY_ALLOW_SELF_SIGNED` in the "UI-konfigurierbar" table. Admins get factually wrong security instructions.
  - Required fix: Add the two keys to the UI-configurable table and rewrite the SSRF-restriction section to describe the opt-in relaxation (metadata stays blocked, TLS option, OIDC/AI benefit).

### Minor

- [Minor] `docker-compose.yml:79-116` — connectivity env fallback not wired through Compose
  - Evidence: `.env.example:131-132` documents the two connectivity variables, but the `api` service environment does not pass `CONNECTIVITY_ALLOW_*` into the container, so the `.env` fallback documented in `.env.example` has no effect in the Compose deployment (only the admin-UI path works). Violates the Required Future-Feature Contract for documented env vars.
  - Required fix: Add `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` / `CONNECTIVITY_ALLOW_SELF_SIGNED` pass-through to the `api` (and worker) environment with `${VAR:-false}` defaults.

- [Minor] `apps/api/src/features/identity/oidc.strategy.ts:111-126` — new OIDC relaxation branches untested
  - Evidence: `oidc.strategy.spec.ts` mocks `openid-client` without `allowInsecureRequests`/`customFetch` and never exercises `execute=[allowInsecureRequests]` or `customFetch=relaxedFetch`; the `optionalRelaxedHttpsAgent` toggle in the AI adapters and paperless service is likewise not covered by a test.
  - Required fix: Add tests asserting discovery receives the execute/customFetch options when the flags are enabled and stays empty when disabled.

- [Minor] `packages/foundation/src/config/settings-catalog.ts:293-320` — connectivity keys are `runtime` although OIDC consumes them only at boot
  - Evidence: `OidcStrategy.discoverClient` reads the flags once at `onModuleInit`; the catalog marks both keys `runtime`, so the UI advertises immediate effect while a LAN OIDC IdP needs a restart before discovery honors them. The AI adapters and the connectivity test do apply them per-call.
  - Required fix: Either document this boot-time limitation in the catalog description or re-read the flags before each OIDC request.

- [Minor] `apps/api/src/features/cost-tracking/cost-tracking.service.ts:29-37` — `addMonthsClamped` drifts after month-end clamping
  - Evidence: From a 31.01 anchor, `+1` month clamps to 28./29.02 and the day then stays at 29 forever instead of realigning to the anchor (comment claims periods stay "am Anker ausgerichtet"). Period MM/YYYY labels stay correct, but period boundaries/`periodStart > now` comparisons shift by days in subsequent periods.
  - Required fix: Adjust the comment or realign the day-of-month to the anchor on each step; add a leap-year test (e.g., anchor 2024-01-31, assert 02/2024 and 03/2024 boundaries).

### Reviewed but no finding
- Pinning: route order (`pinned` before `:policyId`), `@Roles`/`HouseholdMembershipGuard`/`assertHouseholdAccess`, READ_ONLY scoping via `getReadablePolicyIds`, migration + index — correct. (Minor untracked: no cap on pinned count and archived policies are pinnable; left as Minor-level hardening, not a defect.)
- Restart feature: admin-only endpoint, Redis TTL 300 s, fail-soft on Redis, no secrets in payloads/logs, `restart: unless-stopped` present on api/worker, preload wired in both bootstraps — sound.
- i18n: new keys (paid history, pin, restart, ssrfHint) exist in de and en with matching structure.
- Teil 3.1 (cost edit/delete) fixed with sequence-token protection in `policies/[id]/costs/page.tsx`.

## Verification
- Files inspected (no shell available, so no `git diff`/`git status`/test execution): connectivity guard/test/relaxed-fetch/tls-agent + spec, settings-catalog, OIDC strategy + spec, ollama/openai-compat adapters, paperless service, admin-settings controller/module/restart + DTO + specs, system-config service + spec, cost-tracking service/controller + spec, policy-registry service/controller + specs, restart coordinator/module + spec, worker main/module, prisma schema + migration, docker-compose.yml, .env.example, docs (13-settings-catalog, docker-image-guide, release-guide), web pages (dashboard, policies, costs, admin/settings), i18n de/en.
- The stated verification (615/615 API tests, lint, typecheck, smoke test green) was not re-run; it is taken as claimed.
- Remaining risks: the two security findings (IPv4-mapped metadata bypass; redirect-following) are not covered by the existing test suite; the frequency-mismatch cost bug is untested; docker-compose env passthrough for the new settings is missing.

## Overall assessment
The work package is largely complete and well-structured: the opt-in SSRF relaxation has a fail-closed resolver path, OIDC/AI/Paperless wiring is scoped correctly, the restart feature is safely orchestrated with Redis TTL and no secret exposure, pinning is authorization-correct, and the billing-period rewrite has meaningful tests for mid-period starts and frequency changes. However, the package cannot be accepted as-is: the relaxed-mode guard demonstrably fails to keep cloud metadata blocked via IPv4-mapped IPv6 (an explicit acceptance criterion), the axios connectivity test follows redirects into private/metadata targets without re-validation, and the period-based cost math is wrong when entry frequency and policy paymentFrequency diverge. These need fixes plus targeted tests before the next review round; the doc/settings-catalog staleness and the compose env passthrough gap should be corrected in the same pass.

---

Note (reviewer, after final re-read): the High finding also applies to the DNS-resolved path in relaxed mode (lines 227–233 check resolved addresses only against `isCloudMetadataAddress`, so a hostname resolving to `::ffff:169.254.169.254` likewise bypasses), which strengthens — but does not change — the finding as stated above.
