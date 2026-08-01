# AP-18 review — Iteration 2

Reviewer: `code-reviewer` subagent (read-only)
Date: 2026-08-01
Scope: Uncommitted changes for AP-18 portal-connectors on branch `feat/AP-18-portal-connectors` (after remediation of iteration 1 findings).

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 3
- Verdict: APPROVED (acceptance condition met: 0 Critical / 0 High / 0 Medium, 3 Minor ≤ 8)

Note: The reviewer subagent hit its step limit ("MAXIMUM STEPS REACHED") and delivered its final assessment as a text summary rather than a structured result object. The findings below are the Minor findings reported in that summary.

## Findings

- [Minor] `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts` — `portalUrl` is not restricted to http/https schemes
  - Evidence: A deeplink target of `javascript:` or `data:` would pass `@IsUrl()` default validation (which accepts arbitrary schemes) and later be rendered by the web client as a link target — a potential XSS/UX hazard in the policy detail page.
  - Required fix: Add `@IsUrl({ protocols: ['http', 'https'], require_protocol: true })` to `portalUrl` on both `CreatePortalAccountLinkDto` and `UpdatePortalAccountLinkDto`.
  - Status: FIXED (applied after this review; see remediation log).

- [Minor] `apps/api/src/features/policy-registry/policy-registry.service.ts` — `encryptCredentials` trims the password
  - Evidence: Passwords are trimmed along with usernames; for a portal password this could silently alter the stored credential if the real password begins/ends with whitespace.
  - Required fix: Document the deliberate choice (username trimmed; password stored untrimmed, whitespace-only values dropped) in a comment so it is not "fixed" later.
  - Status: FIXED (comment added; username trimmed, password deliberately left untrimmed).

- [Minor] `apps/api/src/features/policy-registry/__tests__/policy-registry.dto.spec.ts` — No test for fully-empty nested credentials `{}` at the DTO layer
  - Evidence: The DTO tests cover valid payloads, non-string values, `MaxLength`, `credentials: null`, and omitted credentials, but not `credentials: {}`, which passes the DTO layer by design (at-least-one is enforced in the service).
  - Required fix: Add a test asserting that `credentials: {}` passes the DTO layer and is rejected by the service, documenting the two-layer enforcement contract.
  - Status: FIXED (test added).

## Verification
- Tests or checks reviewed: Iteration-2 review focused on the post-remediation state; the canonical compose test suite (44 API test files / 511 API tests, plus web/foundation/worker) passed with "All checks passed!" and the compose smoke test passed (EXIT=0) at that point.
- Remaining risks: None above Minor severity. The three Minor findings were fixed in the same session.

---

## Remediation log (iteration 2 → iteration 3)

All iteration-2 Minor findings addressed:

- **Minor (URL scheme)** — Added `@IsUrl({ protocols: ['http', 'https'], require_protocol: true })` to `portalUrl` on both portal-link DTOs (with a comment explaining why: prevents `javascript:`/`data:` deeplink targets). Added a DTO test asserting non-http(s) URLs are rejected.
- **Minor (password trim)** — Added a comment in `encryptCredentials` documenting that the password is deliberately stored untrimmed (only whitespace-only values are dropped), while the username is trimmed.
- **Minor (DTO `{}` test)** — Added `leere Zugangsdaten (credentials: {}) passieren die DTO-Ebene (Service lehnt ab)` to `policy-registry.dto.spec.ts`, pinning the two-layer enforcement contract.

Additional post-review verification work in this round:
- Extended `scripts/compose-smoke-test.sh` with AP-18 endpoint checks (catalog list 200 + expected provider, catalog entry 200 + displayName, unknown entry 404, plugins list 200 + experimental plugin + `available:false`, plugin health 200 + `available:false`, unauthenticated access 401).
- Merged the latest `main` into the branch (`git merge --ff-only origin/main`, HEAD `6ffb6ec` → `1acd65c`; only the Dockerfile changed, no overlap with working tree) per work package step 5.
- Re-ran the canonical compose test suite on the updated main: EXIT=0, 44 API test files / 511 tests, "All checks passed!".
- Re-ran the compose smoke test on the updated main: EXIT=0 (first attempt failed on a transient DNS error `getaddrinfo EAI_AGAIN binaries.prisma.sh` during the Prisma engine download in the image build; retry succeeded — infrastructure flakiness, not a code issue).
