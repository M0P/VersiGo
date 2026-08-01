# AP-16 Review — Iteration 2

Review executed: 2026-08-01 by the `@code-reviewer` subagent (read-only) against the
uncommitted AP-16 change set on `feat/AP-16-roles-rechte-lokale-registrierung`
(HEAD `9c9f19300bef078f0c1e326445916a593a285625`).

Review result saved verbatim below (as returned by the code-reviewer):

---

**STATEMENT: Maximum steps for this agent have been reached — no further tool calls were possible. The review below is based on the files inspected before the limit. I was unable to inspect in detail the remaining test specs (roles.guard.spec.ts, household-membership.guard.spec.ts, auth.service.spec.ts, password-hashing.service.spec.ts, local-admin.bootstrap.spec.ts, identity.module.spec.ts, the household-isolation.integration.spec.ts suites), `README.md`, `docker-compose.test.yml`, the full `compose-smoke-test.sh`, `apps/api/src/app.module.ts`, the tail of `policy-registry.service.ts` (covered-persons/portal-link write paths), the audit admin controller, the `ai-assist.controller.ts` role gating, and `apps/worker/src/worker.module.ts`/`main.ts`. Those areas are flagged as remaining risks rather than findings. Both automated gates (docker-compose test stack: 33 API test files / 398 tests; compose smoke test) were reported green by the implementer and were not re-run.**

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 1
- Verdict: CHANGES REQUIRED

## Findings

### Round-1 verification (all 8 findings resolved)

- [Fixed] Medium#1 — Write gate / `ownerUserId` decision: now coherently documented. ADR-007 "Konsequenzen" (`docs/adr/ADR-007-global-roles-local-registration-oidc-binding.md:86`) states explicitly that `assertHouseholdAccess` (household membership) is the write gate and `ownerUserId` is provenance only; `docs/07-security-privacy.md:53` repeats it; the acceptance criterion was reconciled in `prompts/AP-16-roles-rechte-lokale-registrierung.md:75` ("„Eigene Verträge" bedeutet die Verträge des eigenen Households … `ownerUserId` ist Provenienz-Information, keine Zugriffsgrenze"). Server enforcement matches the doc: write routes carry `@Roles(GlobalRole.USER, GlobalRole.ADMIN)` (e.g. `policy-registry.controller.ts:32,61,72,82`, `cost-tracking.controller.ts:26,79,91`, `documents.controller.ts:38,141,153`, `family-sharing.controller.ts:25,72,83`), so `READ_ONLY` cannot write (min-rank blocks rank 1 vs. required rank 2), while `USER`/`ADMIN` write on household membership only.
- [Fixed] Medium#2 — Migration collision resolution: `prisma/migrations/20260731120000_ap16_global_roles_local_registration/migration.sql:67-98` now runs an iterative `DO $$ … WHILE remaining > 0 AND guard < 6` loop that appends ever-longer id-derived segments until no duplicates remain, with `RAISE EXCEPTION` as fallback. This handles the previously reported "natural `foo-abc123` collides with suffixed `foo`" case.
- [Fixed] Minor (a) — Register rate limiting: `login-rate-limiter.service.ts` scopes `'login' | 'register'` (separate counters); `auth.controller.ts:80-114` checks `isBlocked(ip,'register')` → 429 and `recordAttempt(ip,'register')` on both 409-conflict and success; spec coverage added in `auth.controller.spec.ts` (429, 409-counting, scope assertions) and `login-rate-limiter.service.spec.ts` (register-scope incr/get/del tests).
- [Fixed] Minor (b) — P2034 handling: `user-admin.service.ts:123-149` `runSerializable` retries up to 3 times and maps persistent P2034 to `ConflictException` (409); `disable`/`setRole` both use it; P2034 tests added in `user-admin.service.spec.ts:207-242,328-356`.
- [Fixed] Minor (c) — 409 enumeration decision: documented as a deliberate, bounded exception in ADR-007 decision 4a (`:56-64`) and `docs/07-security-privacy.md:60-61`.
- [Fixed] Minor (d) — Role-change confirmation: `apps/web/src/app/admin/users/page.tsx:111-135` `applyRole` uses `window.confirm`, with a dedicated downgrade warning for ADMIN→USER/READ_ONLY.
- [Fixed] Minor (e) — Stale AP-number references: repo-wide grep finds no references to AP-11/AP-99 outside `docs/reviews/AP-16-review-1.md`; AP-18/AP-19/AP-20 appear only as self-references in their own prompt files. No stale cross-references in docs/PR_DESCRIPTION.md remain.
- [Fixed] Minor (f) — Trust proxy: `TRUST_PROXY` in `app-config.schema.ts:72-78,146` (default false), wired in `main.ts:26` (`set('trust proxy', …)`), `docker-compose.yml:87`, `.env.example:29-32`, `docs/08-admin-operations.md:19`, with spec coverage in `app-config.schema.spec.ts:127-141`. Session cookie flags verified in `main.ts:29-42` (httpOnly, SameSite=lax, secure in production, 8h maxAge).

### Fresh findings (new in this pass)

- [Medium] `prisma/migrations/20260731120000_ap16_global_roles_local_registration/migration.sql:117-128` — READ_ONLY role derivation demotes mixed MEMBER+VIEWER users
  - Evidence: The second role UPDATE sets `role='READ_ONLY'` when `role='USER'` AND any `VIEWER` membership exists (`WHERE u."role" = 'USER' AND EXISTS (… hm."role" = 'VIEWER')`). It does not implement the "ausschliesslich VIEWER" exclusivity stated in the comment. A user who was `MEMBER` in household A and `VIEWER` in household B (multi-household membership is possible under the old model) starts at the `'USER'` default from `MEMBER` and is then silently downgraded to `READ_ONLY` because of the unrelated `VIEWER` membership. This contradicts the documented max-wins derivation in ADR-007 (`OWNER/ADMIN → ADMIN, MEMBER → USER, VIEWER → READ_ONLY`) and the AP-16 "verlustfreie Migrationsstrategie" requirement: the user permanently loses write access after migration.
  - Required fix: Only set `READ_ONLY` when the user has *no* higher membership — e.g. `WHERE u."role" = 'USER' AND EXISTS (VIEWER) AND NOT EXISTS (MEMBER)` (or compute per-user max membership in a single pass).
- [Minor] `apps/web/src/components/ui/nav-config.ts:18-33` — Admin navigation entry is shown to every authenticated user
  - Evidence: `NAV_SECTIONS` unconditionally includes `{ href: '/admin', … }` under "Verwaltung"; the app shell (`app-shell.tsx`) renders it for all roles. A `READ_ONLY`/`USER` user sees an Admin link that always ends in the /forbidden page once the API returns 403. Server-side enforcement is correct, so this is purely a UX inconsistency against the AP-16 UI criterion ("READ_ONLY sieht … keine editierbaren Einstellungen"; admin UI not to be offered).
  - Required fix: Gate the Admin nav item on the current user's role (via `useCurrentUser`) or remove it from the shared config for non-ADMIN roles.

## Verification
- Tests/checks reviewed: none executed (read-only environment). The implementer reports the canonical docker-compose contract green (prisma migrate deploy, lint, typecheck, 33 API test files / 398 tests) and `./scripts/compose-smoke-test.sh --build` green; these claims were not re-run.
- Areas inspected: round-1 review and all 8 findings against the current code/docs; AP-16 prompt + ADR-007; both AP-16 migrations (20260731120000 global-roles, 20260801120000 ai_extraction_jobs schema drift); full identity feature (auth service/controller/guards/decorators, OIDC strategy, user-admin service+controller, bootstrap, password hashing, rate limiter, module); write-path gating and `@Roles` in policy/cost/documents/family-sharing/user-preferences/admin-settings controllers; web middleware, hooks, register/login/pending/forbidden/settings/admin-users pages; app-config schema + spec; main.ts session/trust-proxy; docker-compose.yml; .env.example; docs 07/08; stale-reference audit; worker processor.
- Checked and found correct: bcrypt cost-12 with per-password salt; generic login errors and 409-scoped register exception; session regeneration on login and OIDC callback and destroy on logout; `Math.min` rank logic in `roles.guard.ts` (no escalation/lockout); READ_ONLY read restriction to READ shares; household isolation on all household-scoped routes; last-admin protection in a serializable transaction with bounded P2034 retry; audit redaction (no password/hash/session values); OIDC non-provisioning binding with `(issuer,subject)` uniqueness and ACTIVE-only login; fail-fast when no auth method is configured; production-safe bootstrap (env-gated, idempotent); web UI does not bypass server-side enforcement; `ai_extraction_jobs` drift migration matches the Prisma model.
- Remaining risks (not verifiable within the step limit): test-spec accuracy for the remaining identity specs; README consistency with the role model; audit admin controller role gating; `ai-assist.controller.ts` READ_ONLY gating; `policy-registry.service.ts` covered-persons/portal-link write paths (pattern-consistent with the verified update/remove/hardDelete); `DROP INDEX users_email_key`/`credentials_identifier_key` being plain indexes vs. constraints (claimed green migrate-deploy supports plain indexes).

## Severity counts (one line)
Critical: 0, High: 0, Medium: 1, Minor: 1 — Verdict: CHANGES REQUIRED
