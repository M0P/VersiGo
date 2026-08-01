# AP-16 Review — Iteration 1

Review executed: 2026-08-01 by the `@code-reviewer` subagent (read-only) against the
uncommitted AP-16 change set on `feat/AP-16-roles-rechte-lokale-registrierung`
(HEAD `9c9f19300bef078f0c1e326445916a593a285625`).

Review result saved verbatim below (as returned by the code-reviewer):

---

**STATEMENT: Maximum steps for this agent have been reached — no further tool calls were possible. The review below is based on the files inspected before the limit. I was unable to inspect the test specs (user-admin.service.spec.ts, auth.service.spec.ts, auth.controller.spec.ts, roles.guard.spec.ts, household-membership.guard.spec.ts, household-isolation.integration.spec.ts), the `docs/` updates, `README.md`, `packages/foundation/src/config/__tests__/app-config.schema.spec.ts`, the prompts directory listing, `apps/api/src/main.ts` (session/cookie/`trust proxy` settings), the worker processor, and the audit feature. Those areas are flagged as remaining risks rather than findings.**

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 2
- Minor: 6
- Verdict: CHANGES REQUIRED

## Findings

- [Medium] `apps/api/src/features/policy-registry/policy-registry.service.ts:115-236` (and controllers `policy-registry.controller.ts:60-89`, `cost-tracking.service.ts:134-221`, `documents.service.ts:284-386`)
  - Evidence: All write paths (`update`, `remove`, `hardDelete`, covered persons, portal links, cost `update`/`remove`, document `updateMetadata`/`remove`) enforce only household membership, never ownership. Any `USER` in a household can modify/archive/delete another member's policies, costs, and documents. This contradicts the AP-16 acceptance criterion "USER verwaltet ausschließlich eigene Verträge" and the ADR-007 consequence that write access follows the existing ownership/share boundaries; it also lets a USER delete a policy that a READ_ONLY partner only has a read share on.
  - Required fix: For `USER` role, gate write operations on `ownerUserId` (or the applicable object owner) and keep household-membership as a precondition; if cross-user write within a household is intended to be retained, the ADR-007/AP-16 documentation must state this explicitly, and the acceptance criterion must be reconciled.

- [Medium] `prisma/migrations/20260731120000_ap16_global_roles_local_registration/migration.sql:59-66`
  - Evidence: The one-shot collision-resolution UPDATE appends an id-derived suffix to every duplicated username. If a pre-existing (non-duplicated) username is identical to a suffixed form (e.g. a natural `foo-abc123` and a duplicate `foo` that becomes `foo-abc123`), the subsequent `CREATE UNIQUE INDEX "users_username_key"` fails and the whole migration aborts on that dataset. The suffix step is non-iterative and can therefore produce a new collision instead of resolving the old one.
  - Required fix: Resolve collisions in a loop until no duplicate remains (or use a deterministic, guaranteed-unique scheme such as a sequence-based suffix), and add a pre-check that suffixed names do not collide with existing names before creating the unique index.

- [Minor] `apps/api/src/features/identity/auth.controller.ts:68-87` — `POST /auth/register` has no rate limiting, so an unauthenticated caller can create an unlimited number of `PENDING_APPROVAL` accounts, flooding the admin approval queue.
  - Required fix: Apply the existing Redis-based rate limiter (per IP) to the register endpoint, or add a separate registration limiter.

- [Minor] `apps/api/src/features/identity/user-admin.service.ts:120-142,164-186` — the serializable transactions for `disable`/`setRole` never retry Prisma serialization failures (P2034); under concurrent last-admin operations one request surfaces as an unhandled 500 instead of a clean `ConflictException`. The protection itself holds (SSI predicate reads abort the conflicting transaction), so this is a robustness/UX issue, not a security hole.
  - Required fix: Catch P2034 and retry (bounded) or map it to a `ConflictException`/`409`.

- [Minor] `apps/api/src/features/identity/auth.service.ts:193-194` — registration returns `409 "Benutzername ist bereits vergeben"`, revealing username existence, although AP-16 requires response texts not to "unnötig offenlegen" user existence. The login path is correctly generic; only the register path leaks.
  - Required fix: Decide explicitly whether registration conflicts may reveal username availability; if strict non-enumeration is required, return a generic error on P2002.

- [Minor] `apps/web/src/app/admin/users/page.tsx:111-135` — the role-change action (including ADMIN→USER/READ_ONLY downgrade) has no confirmation dialog, while AP-16 requires "gefährliche Admin-Aktionen verlangen eine klare Bestätigung" (confirmations exist only for reject/disable).
  - Required fix: Add a confirm step for role changes, especially downgrades.

- [Minor] `prompts/` renumbering (AP-18 internally numbered AP-11; AP-99 renamed AP-19; new AP-20) — cross-references to these AP numbers in `docs/`, `PR_DESCRIPTION.md`, or other prompts may now point to stale identifiers.
  - Required fix: Audit all references to AP-11/AP-18/AP-19/AP-20/AP-99 and update them; if renumbering was intentional, document the mapping.

- [Minor] `apps/api/src/features/identity/auth.controller.ts:104` — rate limiting keys on `req.ip`; if Express `trust proxy` is not configured in `main.ts` for the production deployment, all clients behind a reverse proxy share one counter (global lockout) and per-IP limiting is ineffective.
  - Required fix: Verify/configure `app.set('trust proxy', ...)` in `main.ts` (or key on a correctly extracted client IP) and confirm the session cookie flags (httpOnly/SameSite/secure) there.

## Verification
- Tests/checks reviewed: none executed (read-only environment; no test specs could be inspected before the step limit). The implementer reports the canonical docker-compose test contract ("All checks passed!", 390 API tests + lint/typecheck/migrate deploy) and `./scripts/compose-smoke-test.sh` passed; these claims could not be re-run.
- Areas inspected: AP-16 prompt + ADR-007, both migrations, full Prisma schema, identity feature (auth service/controller/guards/decorators, OIDC strategy, user-admin, bootstrap, password hashing, rate limiter, module), policy/cost/documents/family-sharing/ai-assist/admin-settings/user-preferences controllers+services, web middleware/hooks/register/login/pending/forbidden/admin/settings pages, app-config schema, docker-compose(.test).yml, smoke-test script, .env.example.
- Checked and found correct: bcrypt cost-12 hashing with per-password salt and no plaintext in DB/logs/audit/API; generic login errors; session regeneration on login and destroy on logout; `Math.min` rank logic in `roles.guard.ts` (no escalation/lockout — @Roles min-rank semantics match ADR-007); READ_ONLY read access restricted to READ-only shares (WRITE shares grant nothing); household isolation guard on all household-scoped routes; last-admin protection in a serializable transaction; audit redaction (no passwords/hashes/sessions); OIDC non-provisioning binding with `(issuer,subject)` uniqueness; fail-fast when no auth method is configured; production-safe bootstrap (env-gated, idempotent, no default credentials); web UI does not bypass server-side enforcement.
- Remaining risks (not verifiable within the step limit): session/cookie/`trust proxy` settings in `main.ts`; test-spec accuracy vs controller/service signatures; docs/README consistency with the role model; audit feature role gating; worker processor interaction with the new `ai_extraction_jobs` table; correctness of `DROP INDEX "users_email_key"` / `DROP INDEX "credentials_identifier_key"` against the constraint vs plain-index creation in the AP-2/AP-14 migrations (claimed green migrate-deploy run suggests they are plain indexes).

## Severity counts (one line)
Critical: 0, High: 0, Medium: 2, Minor: 6 — Verdict: CHANGES REQUIRED
