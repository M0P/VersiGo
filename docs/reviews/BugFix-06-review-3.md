# BugFix-06 Review 3

Date: 2026-08-06
Scope: uncommitted changes on `fix/BugFix-06-release-verification` after fixing all round-2 findings (docs/reviews/BugFix-06-review-2.md)
Reviewer: DeepSeek code-reviewer (invoked via Task tool)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: **APPROVED**

## Findings

- [Minor] `apps/api/src/common/connectivity/__tests__/connectivity-test.spec.ts:29-37,80-83` — Test server B (`serverB` on 127.0.0.2) is never closed
  - Evidence: `serverB` is created and started in `beforeAll` as a local `const`, but `afterAll` only closes `server` (server A). The listening socket on 127.0.0.2 stays open until the vitest worker is torn down. This is a test-resource leak introduced with the round-2 cross-origin test. It does not fail the suite (vitest force-terminates workers after the run), but it leaves an open handle and can add teardown delay.
  - Suggested fix: hoist `serverB` to the describe scope and close it in `afterAll` (e.g. `serverB.closeAllConnections()` + `server.close()`), mirroring the handling of `server`.

## Overall assessment

Both round-2 findings are correctly and completely fixed. The origin-based token gating is robust against the relevant URL-normalization edge cases (default ports, case, punycode, userinfo, scheme changes) and is proven by the two new real-server tests in both directions (cross-origin token stripped, same-origin token forwarded). The doc version now matches the code. The full working-tree scan found no remaining Critical/High/Medium issues and no regressions in the two `testEndpoint` callers; the only new item is the minor unclosed test-server handle. The known partial German documentation (docs/02–11, docs/adr/, prompts/*.md, code comments) is an accepted, documented deviation and not a new regression. The package meets the review-loop abort condition (0/0/0, ≤8 Minor).

## Verification
- Inspected: `connectivity-test.ts` + spec, `connectivity-guard.ts`, both callers (`system-config.service.ts`, `admin-settings.controller.ts`), `restart.service.ts`, `oidc.strategy.ts`, `cost-tracking.service.ts`, pinning controller/service + specs, `docker-compose.yml`, `.env.example`, `.gitignore`, `docs/13-settings-catalog.md`, `docs/end-user-guide.md`, `docs/release-guide.md`, i18n de/en, prior review docs (rounds 1–2).
- Test gate (628 API / 47 web / 105 foundation / 4 worker, lint/typecheck/i18n/turbo, smoke 31 PASS) was not re-run in this session (no shell); taken as claimed.
- Remaining risks: none material. The unclosed `serverB` is the only cleanup item.
