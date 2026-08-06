# BugFix-07 Review 3

Date: 2026-08-06
Scope: uncommitted changes for work package `prompts/BugFix-07-ui-fixes-and-branding.md` (Package A) — re-review after the round-2 Minor fixes
Reviewer: DeepSeek code-reviewer (invoked via Task tool)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: PASS

## Findings

- [Minor] `apps/api/src/features/identity/oidc.strategy.ts:8` (cycle with `auth.service.ts:18`) — the "type-only → elided at runtime" rationale for the `auth.service ↔ oidc.strategy` cycle is factually wrong; the cycle is real and its safety is load-order-dependent, so the constraint should be documented in code
  - Evidence: `apps/api/tsconfig.json:23` sets `emitDecoratorMetadata: true`. For `OidcStrategy` (`oidc.strategy.ts:67`, constructor parameter `private readonly authService: AuthService`), TypeScript emits `design:paramtypes` containing a *runtime value reference* to `auth_service_1.AuthService` inside the class decorator metadata. The import on `oidc.strategy.ts:8` is therefore **not** elided at runtime (only `AuthenticatedUser` in that same import is type-only). This makes the cycle bidirectional at runtime: `auth.service.ts:18` imports the value `normalizeIssuerUrl` from `oidc.strategy`, and `oidc.strategy` imports the value `AuthService` from `auth.service`. Whether the DI metadata captures the class correctly depends on module load order (auth.service.ts's static import of `./oidc.strategy` at line 18 executes before the `AuthService` class is defined in that file). It works today — verified empirically by the real API boot in the smoke test (`wait_for_api_health`/`wait_for_api_ready` in `scripts/compose-smoke-test.sh:189-216` require a full NestJS bootstrap including `OidcStrategy` instantiation) and by 813/813 tests. However, the incorrect rationale invites a future maintainer to "fix" the import to `import type { AuthService }`, which would remove the value reference from `design:paramtypes` and break NestJS DI resolution at bootstrap ("Nest can't resolve dependencies of the OidcStrategy").
  - Required fix: add a short comment on the import at `oidc.strategy.ts:8` (or at `auth.service.ts:18`) stating that `AuthService` must remain a **value** import because `emitDecoratorMetadata` references it in `design:paramtypes`, and that `auth.service.ts` must not introduce any module-evaluation-time dependency on `oidc.strategy`'s exports (currently only method-level use of `normalizeIssuerUrl` — keep it that way). Do not convert to `import type`.

## Verification
- Round-2 fix 1 (shared `normalizeIssuerUrl`): import correct at `auth.service.ts:18`; behavior parity exact (`issuer.trim().replace(/\/+$/, '')`); used before transaction and audit; `oidc.strategy.ts:259` uses the same helper for login lookup — admin-binding, self-service-binding and login comparison can no longer diverge. P2002 → `ConflictException` (German) preserved. Tests cover trailing-slash normalization, P2002 → conflict, unknown user → 404.
- Round-2 fix 2 (stale `oidcLinkMode`): `auth.controller.ts:64` deletes the flag before the redirect; regression test (`auth.controller.spec.ts:195-220`) pre-seeds `oidcLinkMode: true` and asserts `toBeUndefined()` after login; callback link branch still deletes all three session flags and guards on `session.userId`; local login regenerates the session.
- Full-package spot checks: dedupe migration (partial unique index + dedupe DELETE, applied on the fresh smoke DB as the 15th migration), branding assets present, de/en i18n parity, load-order analysis of the `main.ts → ... → auth.service ↔ oidc.strategy` module graph (empirical boot success outweighs theoretical fragility → Minor only).
- Gates reviewed (as provided, re-verified green): vitest 813/813, tsc (API+web), eslint, i18n guard, `docker compose config`, smoke `--clean` with fresh Postgres — all green.
- Remaining risks: the documented load-order fragility of the `auth.service ↔ oidc.strategy` cycle (Minor above, addressed with the required comment fix).

## Overall assessment
The single Minor finding was resolved with the reviewer-required documentation: the `oidc.strategy.ts:8` import now carries an explicit comment (mirrored at `auth.service.ts:18`) stating that `AuthService` must remain a value import for `emitDecoratorMetadata`/`design:paramtypes` and that no module-evaluation-time dependency may be introduced. The comment-only change was re-verified (tests, tsc, eslint green). Acceptance condition met: 0 Critical / 0 High / 0 Medium / 1 Minor (≤ 8).
