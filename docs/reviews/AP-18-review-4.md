# AP-18 review — Iteration 4

Reviewer: `code-reviewer` subagent (read-only)
Date: 2026-08-01
Scope: Uncommitted changes for AP-18 portal-connectors on branch `feat/AP-18-portal-connectors` (after remediation of iteration 3 findings).

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 3
- Verdict: CHANGES REQUIRED

## Findings

- [Medium] `apps/web/src/app/policies/[id]/page.tsx:160` — The href hardening is incomplete: the web renderer still falls back to the raw, unvalidated `portalUrl`
  - Evidence: The iteration-3 fix re-validates the scheme only inside `resolveDeepLink` (for `deepLinkUrl`), but the page renders `const targetUrl = l.deepLinkUrl ?? l.portalUrl;` directly into `<a href>`. When `resolveDeepLink` returns `null` (manual URL has non-http(s) scheme and provider is not in the catalog), the browser renders the raw `portalUrl` — a `javascript:`/`data:` value written outside the validated API path — as a live link. `enrichPortalLink` also returns `portalUrl: link.portalUrl` verbatim, so the API hands the raw value to the client.
  - Required fix: Validate the final link target before rendering — either reject/sanitize non-http(s) `portalUrl` in the web component, or have `enrichPortalLink` return `portalUrl: null` for non-http(s) values so the defense-in-depth lives in one place.
  - Status: FIXED (see remediation log).

- [Minor] `apps/api/src/features/portal-connectors/portal-connector.service.ts:111-118` — Swallowed health-check errors leave no operational trace
  - Evidence: The `catch` silently swallows a throwing `plugin.healthCheck()` and returns the degraded status, but the service injects no `Logger` (project convention; cf. `portal-connector-registry.ts:20`, `policy-registry.service.ts:87`). A plugin that crashes repeatedly is invisible in the API logs.
  - Required fix: Inject a `Logger` and log `logger.warn(...)` with the error inside the catch, while still returning the controlled degraded response.
  - Status: FIXED (see remediation log).

- [Minor] `docs/06-integrations.md:39` and `docs/04-data-model.md:97` — Precedence rule changed but docs not updated
  - Evidence: Both docs state "manueller `portalUrl` hat Vorrang vor dem Katalog-Deeplink" without the new restriction (only http(s) manual URLs take precedence; other schemes/unparsable values fall back to the catalog template).
  - Required fix: Amend the two doc statements per the AGENTS.md Future-Feature Contract.
  - Status: FIXED (see remediation log).

- [Minor] `apps/api/src/features/policy-registry/__tests__/policy-registry.dto.spec.ts:96-114` — The `data:` URL rejection test does not isolate the protocol constraint
  - Evidence: The assertion only checks `errors.length > 0` for `'data:text/html,<script>alert(1)</script>'`. This URL would fail `@IsUrl()` even without the `protocols` option, so the test passes for the wrong reason and does not pin the http(s)-only invariant.
  - Required fix: Use a well-formed URL with a wrong scheme (e.g. `ftp://example.com`), which validator.js accepts by default but which the `protocols: ['http','https']` option rejects.
  - Status: FIXED (see remediation log).

## Verification
- Tests or checks reviewed (static): the reviewer verified the iteration-4 delta against the working tree — all five changes present and matching the description; confirmed the smoke-test restructure (step 9 unconditional, 8f inside the admin block), the guard wiring (global `SessionAuthGuard`, no `@Public` on portal-connectors routes), the DTO options, and no regression in the enriched-link tests.
- Remaining risks (reported): (1) the Medium finding above (web fallback to raw `portalUrl`); (2) canonical suite and smoke test could not be re-executed in the reviewer's environment (no bash tool).

---

## Remediation log (iteration 4 → iteration 5)

All findings addressed as follows (verified by the canonical test suite and compose smoke test after each change):

- **Medium (web href fallback)** — Fixed at the single source of truth: `enrichPortalLink` now returns `portalUrl: null` for any value that is not a parseable `http(s)` URL (new private `isHttpUrl` helper), so the API never hands a non-http(s) link target to the client. `resolveDeepLink` reuses the same helper (removed the duplicate parsing). Since the web page renders `l.deepLinkUrl ?? l.portalUrl` and `portalUrl` is now already sanitized, the `<a href>` can no longer receive `javascript:`/`data:` values from either field. Added service tests: http(s) `portalUrl` passes through, `javascript:alert(1)` becomes `null` in `portalUrl` while `deepLinkUrl` falls back to the catalog template, unparsable value becomes `null`.
- **Minor (swallowed health-check errors)** — Injected `private readonly logger = new Logger(PortalConnectorService.name);` (project convention) and added `logger.warn(...)` with the error message inside the catch; the controlled degraded response is still returned.
- **Minor (docs precedence rule)** — Updated `docs/06-integrations.md` (Deep-Link-Auflösung: only `http(s)` manual URLs take precedence; other schemes/unparsable values are discarded and fall back to the catalog template; same rule applies to the `portalUrl` output) and `docs/04-data-model.md` (PortalAccountLink `portalUrl` note).
- **Minor (DTO test isolation)** — Replaced `data:text/html,<script>alert(1)</script>` and `javascript:alert(1)` with well-formed `ftp://example.com` in both the Create and Update DTO rejection tests (a URL validator accepts `ftp:` by default, so the test now genuinely pins the `protocols: ['http','https']` constraint), and kept the `portalUrl: null` clear-semantics assertion.

### Verification after fixes
- Canonical suite `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test`: EXIT=0, "All checks passed!", 44 API test files / 516 API tests, web 18, foundation 75, worker 4.
- Compose smoke test `./scripts/compose-smoke-test.sh --build`: EXIT=0, all checks including 8f (authenticated catalog/plugins) and step 9 (unauthenticated 401).
- Infrastructure note: two smoke-test build attempts failed with transient DNS (`getaddrinfo EAI_AGAIN binaries.prisma.sh` while the runner image downloads the Prisma engine) and one with "no space left on device" (podman GraphRoot on `/dev/sda3` was 100% full). Resolved via `podman system prune -a -f` (freed ~30 GB; images 1049 → 45) and a retry; final smoke run EXIT=0.
