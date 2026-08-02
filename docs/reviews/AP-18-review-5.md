# AP-18 review — Iteration 5

Reviewer: `code-reviewer` subagent (read-only)
Date: 2026-08-01
Scope: Uncommitted changes for AP-18 portal-connectors on branch `feat/AP-18-portal-connectors` (after remediation of iteration 4 findings).

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Findings

- [Minor] `apps/api/src/features/portal-connectors/portal-connector.service.ts:185` — `enrichPortalLink` checks `isHttpUrl(link.portalUrl)` and passes the **raw, untrimmed** value through, while `resolveDeepLink` checks the **trimmed** value and normalizes via `new URL(manual).toString()`. For a stored value with surrounding whitespace (only possible for data written outside the validated DTO path, the defense-in-depth scenario `isHttpUrl` claims to cover — `schema.prisma:429` allows any `String?`), the emitted `portalUrl` contains the whitespace while `deepLinkUrl` is normalized, so the two link fields disagree and `portalUrl` is not a clean http(s) target as the "single source of truth" doc comment claims. The web `<a href>` is unaffected because `deepLinkUrl` is always non-null whenever `portalUrl` is non-null.
  - Required fix: apply the same trimming in `enrichPortalLink` (compute the trimmed value once and emit that, or return the normalized `new URL(...).toString()`).
  - Status: FIXED (see remediation log).

- [Minor] `apps/api/src/features/portal-connectors/portal-connector.service.ts:144-145` — `resolveDeepLink` still parses the URL twice for valid http(s) inputs (once inside `isHttpUrl`, once via `new URL(manual).toString()`). Purely an efficiency/maintainability nit with no behavioral impact.
  - Required fix: have `isHttpUrl` return the parsed `URL | null` (or a discriminated result) so `resolveDeepLink` parses once and reuses the result.
  - Status: FIXED (see remediation log).

## Verification
- Tests or checks reviewed (static): the reviewer confirmed the iteration-5 delta against the working tree — new service tests genuinely pin the claimed invariants (https passes through unchanged; `javascript:` yields `portalUrl: null` with `deepLinkUrl` falling back to the catalog template; unparsable yields `null`); the DTO spec now genuinely pins the `protocols: ['http','https']` constraint via `ftp://example.com`; the Medium finding from iteration 4 is fully closed (all five producers of portal-link payloads route through `enrichPortalLink`, the sole web consumer uses `l.deepLinkUrl ?? l.portalUrl`, and no code path can hand a non-http(s) value to the `<a href>`); `Logger` usage matches the codebase-wide pattern; docs accurately describe the http(s)-only precedence and output rule.
- Remaining risks: none material.

---

## Remediation log (iteration 5 → commit)

Both Minor findings addressed as follows (verified by the canonical test suite and compose smoke test after the change):

- **Minor (trim/normalize consistency)** — Refactored `isHttpUrl` into a `parseHttpUrl(value): URL | null` helper that trims the value, parses it once, and returns the `URL` only for `http:`/`https:` schemes. `enrichPortalLink` and `resolveDeepLink` both use it, so `portalUrl` and `deepLinkUrl` are now emitted in the identical normalized form (trimmed, `new URL(...).toString()`).
- **Minor (double parsing)** — Resolved by the same refactor: `parseHttpUrl` parses once and returns the `URL`; `resolveDeepLink` calls `.toString()` on the reused result, `enrichPortalLink` stores the result and calls `.toString()`.
- Added a service test pinning the trimming/normalization consistency: `portalUrl: '  https://mein-portal.example.com/login  '` yields `portalUrl` and `deepLinkUrl` both equal to `'https://mein-portal.example.com/login'`.

### Verification after fixes
- Canonical suite `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test`: EXIT=0, "All checks passed!", 44 API test files / 517 API tests, web 18, foundation 75, worker 4.
- Compose smoke test `./scripts/compose-smoke-test.sh --build`: EXIT=0, all checks including 8f (authenticated catalog/plugins) and step 9 (unauthenticated 401).
- Cleanup (per new AGENTS.md rule 9 / `prompts/00-gemeinsame-regeln.md` "Aufräum-Pflicht"): removed debug containers `iter-test` and `mig-pg` (+ the `mig-pg` volume), removed session images `localhost/versigo:latest` and `localhost/versigo-test:latest`, pruned dangling images; pre-existing containers (`tk-epa-ubuntu`, `libation-env`) and shared base images (node/postgres/redis/ubuntu/fedora) left untouched.

### Final review state (across all iterations)
| Iteration | Critical | High | Medium | Minor | Verdict |
|-----------|----------|------|--------|-------|---------|
| 1         | 0        | 0    | 2      | 5     | CHANGES REQUIRED |
| 2         | 0        | 0    | 0      | 3     | APPROVED |
| 3         | 0        | 0    | 0      | 5     | APPROVE |
| 4         | 0        | 0    | 1      | 3     | CHANGES REQUIRED |
| 5         | 0        | 0    | 0      | 2     | PASS |

Acceptance condition met: 0 Critical / 0 High / 0 Medium / 2 Minor (≤ 8 Minor).
