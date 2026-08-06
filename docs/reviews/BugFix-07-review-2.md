# BugFix-07 Review 2

Date: 2026-08-06
Scope: uncommitted changes for work package `prompts/BugFix-07-ui-fixes-and-branding.md` (Package A) — re-review after the round-1 Minor fixes
Reviewer: DeepSeek code-reviewer (invoked via Task tool)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Findings

- [Minor] `apps/api/src/features/identity/auth.service.ts:175` — `bindOidcIdentityForUser` re-implements issuer normalization inline instead of using the shared `normalizeIssuerUrl`
  - Evidence: The work package (Q3) explicitly requires respecting the existing issuer normalization (`normalizeIssuerUrl`). The implementation duplicates the logic as `oidcIssuer.trim().replace(/\/+$/, '')`, which is byte-identical to `normalizeIssuerUrl` in `oidc.strategy.ts:46-48` but is a second copy. The behavior is correct today, but the two implementations can silently diverge (e.g., if normalization is ever extended to lowercase or IDN handling), and the spec's "shared helper" intent is not honored.
  - Required fix: Import `normalizeIssuerUrl` from `./oidc.strategy` and call it in `bindOidcIdentityForUser` instead of the inline expression.

- [Minor] `apps/api/src/features/identity/auth.controller.ts:47-62` — `GET /auth/login` does not clear a stale `req.session.oidcLinkMode`
  - Evidence: `POST /auth/oidc/link` sets `oidcLinkMode = true` (line 356). If a user starts a link flow and abandons it, the flag persists in the session. `GET /auth/login` sets `oidcCodeVerifier`/`oidcState` but never clears `oidcLinkMode`, and the callback checks `oidcLinkMode` first (line 264). A logged-in user who later clicks the OIDC login button would have the callback enter link mode and bind the identity to their own account instead of performing a login. Impact is benign (the user is already authenticated and the identity is bound to their own account), but the session state machine is inconsistent with the login path.
  - Required fix: Clear `req.session.oidcLinkMode` in `GET /auth/login` (alongside the existing verifier/state handling), or defensively clear it in the callback's non-link branch.

## Verification
- Tests/checks reviewed: `auth.controller.spec.ts` (new `oidcReady`/`oidcError`/`oidcConfigured` cases, GET/POST/DELETE `/auth/oidc/link`, link-mode callback incl. conflict and not-authenticated paths), `documents.service.spec.ts` (PAPERLESS_LINK create, dedupe, NotFound, P2002 race fallback), `paperless-ngx.controller.spec.ts` (search), `policy-registry.dto.spec.ts` (portal URL normalization create/update), `portal-url.spec.ts` (web helper). Verified facts from the implementer (813 tests, tsc, eslint, i18n guard, `docker compose config`, smoke test with 15 migrations incl. the dedupe migration) are consistent with the inspected code.
- Important areas inspected: Q1 admin settings single page (`FEATURE_KEYS` exclusion, `/admin/features` redirect, nav-config), Q2 OIDC readiness (`getStatus()` in `oidc.strategy.ts`, sanitized public `oidcError`, login-page gating), Q3 self-service linking (session link-mode, PKCE/state validation, P2002→ConflictException, `normalizeIssuerUrl` usage), Q4 Paperless search/link (household guard + `@Roles`, DTO bounds, transaction + partial unique index + idempotent P2002 path, migration SQL), Q5 portal URL normalization (DTO `@PortalUrlTransform` on all four create/update fields, web helper), Q6 Docker (migration target/service, Prisma CLI+engines pruned in `prod-deps` before COPY, `start.sh` polling `finished_at IS NOT NULL`, `depends_on service_completed_successfully`, documented sizes api ~371 MB / worker ~365 MB / web ~207 MB / migration ~431 MB), Q7b branding (web Dockerfile copy order, `layout.tsx` metadata, default assets in `apps/web/public/branding/`, docs), and de/en i18n parity for all new keys.
- Remaining risks: the two Minor findings above; otherwise the changes are consistent with the work package, project conventions (German API messages, P2002 handling pattern, partial unique index documented in schema comments), and the future-feature contract (migration service, `.env.example`, docs, smoke test all updated).

## Overall assessment
Both Minor findings were fixed in the follow-up pass: `bindOidcIdentityForUser` now calls the shared `normalizeIssuerUrl` (imported from `./oidc.strategy`, consistent with the existing `user-admin.service.ts` pattern; the reverse import in `oidc.strategy.ts` is type-only and elided, so no runtime cycle), and `GET /auth/login` now clears a stale `req.session.oidcLinkMode` (with a regression test asserting the flag is undefined after login). All gates re-verified green (813 tests, tsc, eslint).
