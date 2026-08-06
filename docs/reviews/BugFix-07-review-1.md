# BugFix-07 Review 1

Date: 2026-08-06
Scope: uncommitted changes for work package `prompts/BugFix-07-ui-fixes-and-branding.md` (Package A, Q1–Q8)
Reviewer: DeepSeek code-reviewer (invoked via Task tool)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 5
- Verdict: PASS

## Findings

- [Minor] `apps/api/src/features/paperless-ngx/paperless-ngx.noop.ts:14` — `NoOpPaperlessAdapter` is dead code in production
  - Evidence: `paperless-ngx.module.ts`'s `PAPERLESS_ADAPTER` factory unconditionally returns `PaperlessNgxService` (self-degrading), so the NoOp adapter is never injected at runtime. Its only references are the re-export (`paperless-ngx.noop.ts:14`, `index.ts:2`) and the test file (`__tests__/paperless-ngx.service.spec.ts:6,343`).
  - Required fix: remove `NoOpPaperlessAdapter` and its re-export, or keep it only if a future env-driven switch is planned; at minimum document why it remains.

- [Minor] `docker/start.sh:25` + `docker-compose.yml:127-137,181-185` — migration wait detects only "at least one" migration, and api/worker do not depend on the `migration` service
  - Evidence: `SELECT 1 FROM _prisma_migrations LIMIT 1` returns as soon as the first migration row exists; if `migrate deploy` fails partway, api/worker start against a partially migrated schema. api/worker `depends_on` only `db`/`redis` (healthy), so they boot in parallel with the migration service; the 60 s poll timeout (30×2 s) is the only gate.
  - Required fix: add `migration: condition: service_completed_successfully` to api/worker `depends_on` (keep the start.sh poll as belt-and-braces), or poll `SELECT 1 FROM _prisma_migrations WHERE finished_at IS NOT NULL LIMIT 1`.

- [Minor] `apps/web/src/app/policies/[id]/documents-tab.tsx:295-301` — search Input has no `maxLength={200}`, diverging from server-side `@MaxLength(200)` validation
  - Evidence: the client sends any term ≥2 chars; a term >200 chars passes the client gate but gets a 400 from the API (`@MaxLength(200)` / `@Matches(/^[\w\s.:",'-]{0,200}$/)` in `PaperlessSearchQueryDto`), surfacing as a generic `paperlessSearchError` instead of a helpful hint.
  - Required fix: add `maxLength={200}` to the search `Input` (and consider mirroring the regex constraint client-side).

- [Minor] `apps/api/src/features/documents/documents.service.ts:313-321` — paperless link dedupe is not race-safe
  - Evidence: the `existing` lookup is a plain `findFirst` outside the `$transaction` and there is no unique index on `(policyId, storageRef)` (schema has only non-unique indexes on `[policyId]` and `[policyId, checksum]`; checksum is null for `PAPERLESS_LINK`). Two concurrent link requests (or two users) for the same Paperless document can both pass the check and create duplicate rows.
  - Required fix: add a partial unique index `@@unique([policyId, storageRef])` filtered on `archivedAt IS NULL` (keeps re-linking after archive possible) and map the resulting P2002 to the idempotent success path.

- [Minor] `apps/api/src/features/identity/auth.controller.ts:93` + `apps/web/src/app/(auth)/login/page.tsx:267` — raw OIDC init error exposed to unauthenticated callers
  - Evidence: `getAuthConfig()` is `@Public()` and returns `oidcError` (the raw `discoverClient()` error message, `oidc.strategy.ts:147`), which can contain internal IdP URLs/endpoints; the login page renders it verbatim for anonymous visitors.
  - Required fix: return a generic diagnostic string (e.g. "Discovery fehlgeschlagen — Details im Server-Log") in `GET /auth/config` / the login page, and keep the detailed `initError` in the authenticated `GET /auth/oidc/link` response.

## Verification
- Tests/checks reviewed: `auth.controller.spec.ts` (501 when not ready, config shape, link-mode callback paths), `oidc.strategy.spec.ts` (`normalizeIssuerUrl` trailing-slash/trim, `getStatus` ready/false-with-error/false-disabled), `documents.service.spec.ts` (link + audit event, dedupe "erneutes Verbinden liefert den bestehenden Eintrag", deepLink enrichment, not-found when metadata null), `paperless-ngx.controller.spec.ts` (hits, empty result on blank/whitespace term, adapter not called), `paperless-ngx.service.spec.ts` (runtime settings resolution, trailing-slash normalization, HTTPS warning, degradation), `policy-registry.dto.spec.ts` (Q5 DTO). Gates green per work package: API 661/661, web 47/47, tsc, eslint, i18n, compose smoke test.
- Areas inspected and found clean: Q1 `FEATURE_KEYS` exclusion (`features-section.tsx:121` flatMap vs `admin/settings/page.tsx:89-92` — no catalog duplicates), `/admin/features` redirect, nav-config; Bug2 login gating (`oidcConfigured && oidcReady` at `login/page.tsx:252`, warning at 263-270) and callback link-mode state cleanup (verifier/state/linkMode deleted before bind; ConflictException → `/settings?error=oidc-link-conflict`); Q3 link endpoint guards (`HouseholdMembershipGuard` + `@Roles(USER, ADMIN)`, search `@Roles(READ_ONLY, USER, ADMIN)`), `CreatePaperlessLinkDto` (`IsInt`/`Min(1)`/`Max(2147483647)`/`@Type(Number)`); Q6 Docker split (migration target/service, CLI+`@prisma/engines` pruned from runners, generate in prod-deps, `@prisma/engines-version` kept, `entrypoint: []` on migration service, smoke test uses `$COMPOSE run --rm migration` at lines 239/1110, `docs/release-notes-template.md:50` wording matches); Q7b branding copy order (web Dockerfile line 39 after `COPY apps/web` so root `branding/` overrides defaults, `layout.tsx` metadata icons, files present in both locations); de/en i18n parity for all new keys. Client min-chars gate (≥2, line 128) matches the hint; server is merely more permissive — acceptable.
- Remaining risks: diff boundary not mechanically verified (`git status`/`git diff` unavailable in this session — review based on file reads + spec); global (non-household-scoped) Paperless search is accepted per the work package spec (auth-only, response contains no document contents/secrets) but should be revisited if Paperless is ever multi-tenant per household; dedupe race-safety depends on the suggested unique index.

## Overall assessment
The work package is accepted (PASS). All five Minor findings were fixed in the follow-up pass: the dead `NoOpPaperlessAdapter` was removed together with its re-export and tests; `docker/start.sh` now polls `finished_at IS NOT NULL` and api/worker `depends_on` the `migration` service via `service_completed_successfully`; the Paperless search Input gained `maxLength={200}`; the link dedupe is now race-safe (check-then-insert inside one transaction plus a partial unique index on `(policyId, storageRef)` with the P2002 mapped to the idempotent success path); and the public `GET /auth/config` returns only a generic OIDC hint while the authenticated link endpoint keeps the detailed diagnostics.
