# AP-16 Review — Iteration 5 (Final Verification)

Review executed: 2026-08-01 by the `@code-reviewer` subagent (read-only) against the
uncommitted AP-16 change set on `feat/AP-16-roles-rechte-lokale-registrierung`
(HEAD `9c9f193`). Focus: verification of the round-4 Minor fix (`/auth/config`
`oidcEnabled` reporting) plus a fresh-findings sweep of only the files changed
since round 4 (`auth.controller.ts`, `auth.controller.spec.ts`) and the
`/auth/config` web consumer contract. Docker gates were not re-run in this
read-only pass (implementer reports both green after the fix).

Review result saved verbatim below (as returned by the code-reviewer):

---

**STATEMENT: The round-4 Minor finding is FIXED and verified correct. `getAuthConfig()` now derives `oidcEnabled` from `this.oidc.isEnabled()` (auth.controller.ts:67), and `OidcStrategy.isEnabled()` (oidc.strategy.ts:93-94) returns `capabilities.isEnabled('oidc') && client !== null`, so a failed OIDC discovery (client=null) now correctly reports `oidcEnabled: false` in `/auth/config`, hiding the OIDC button in the web login page. All three `/auth/config` unit tests are consistent with the change, including the new discovery-failed case, and the combination logic is independently covered in oidc.strategy.spec.ts. The web login page contract (`{ oidcEnabled, localEnabled, registrationEnabled }`) is unchanged; no other endpoint, flow, or smoke test depends on the old capability-only reporting. No fresh findings in the two changed files. Acceptance criteria met: 0 Critical / 0 High / 0 Medium / 0 Minor, gates green. Verdict: APPROVED.**

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: APPROVED

## Findings

### Round-4 fix verification

- [Fixed] Minor — `apps/api/src/features/identity/auth.controller.ts:63-70` — `/auth/config` now reports `oidcEnabled` from the strategy, not the capability flag
  - Evidence: `getAuthConfig()` returns `oidcEnabled: this.oidc.isEnabled()` with an explanatory AP-16/Review-4 comment. `OidcStrategy.isEnabled()` (oidc.strategy.ts:93-94) is `return this.capabilities.isEnabled('oidc') && this.client !== null`, i.e. the strategy is only advertised as enabled when (a) the OIDC capability is on AND (b) discovery succeeded (`discoverClient()` left `client` non-null). In the discovery-failure path (oidc.strategy.ts:88-90, error logged, `client` stays null) `isEnabled()` returns false, so `/auth/config` now reports `oidcEnabled: false` and the web login page hides the OIDC button. This closes the round-4 gap where the capability flag (`OIDC_ENABLED=true`) could advertise the OIDC button while `GET /auth/login` returned 501 (auth.controller.ts:45-51). Fail-closed semantics preserved.
  - Consistency check (no other endpoint relies on the old behavior):
    - `GET /auth/login` (auth.controller.ts:45) and `GET /auth/callback` (auth.controller.ts:194) already gate on `this.oidc.isEnabled()` — all three now use the identical readiness signal, so config, login, and callback agree.
    - `identity.module.ts:41` still uses `capabilities.isEnabled('oidc')` for its startup gate/log — correct: the "no authentication method configured" fatal error must be based on configured capability, not on discovery success (a boot-time discovery failure must not prevent startup when OIDC is configured).
    - `admin-settings.controller.ts:291` uses `this.config.get('OIDC_ENABLED')` in a diagnostics health check — that reports configuration presence for admin diagnostics, not the login contract; unaffected and intentional.
    - `capability-flags.service.ts:36` (`oidc: this.isEnabled('oidc')` in the snapshot) serves the admin feature-flag surface, a separate contract; unaffected.
  - Test verification:
    - Spec test 1 (auth.controller.spec.ts:222-231): capabilities `isEnabled` returns true only for `'local'`, oidc mock `isEnabled` false → expects `{ oidcEnabled: false, localEnabled: true, registrationEnabled: true }`. Matches controller behavior. Correct.
    - Spec test 2 (auth.controller.spec.ts:233-242): capabilities all-true, oidc mock true → expects all true. Correct.
    - Spec test 3 (auth.controller.spec.ts:244-253): capabilities mock returns true only for `'oidc'` (capability says OIDC on), oidc strategy mock `isEnabled` returns false (discovery failed) → expects `{ oidcEnabled: false, localEnabled: false, registrationEnabled: false }`. Exactly documents the discovery-failed case. Correct.
    - The capability+client combination inside `OidcStrategy.isEnabled()` is independently exercised in oidc.strategy.spec.ts:106 (capability off → false), :138 (capability on + discovery ok → true), :160 (capability on + discovery rejected → false). Wiring is covered end-to-end across the two spec files.
  - Web contract check: `apps/web/src/app/(auth)/login/page.tsx` reads `oidcEnabled`/`localEnabled`/`registrationEnabled` from `/auth/config` (lines 12-14, 63-66, 132, 206-219). The response shape is unchanged; the only consumer of `/auth/config` in the web app is the login page (grep-confirmed). The OIDC button (line 210) and the separator (line 206) are now correctly suppressed when discovery failed, and `hasAnyAuth` (line 132) degrades to the "keine Anmeldeart konfiguriert" warning in the OIDC-only-discovery-failed edge case — the intended fail-closed UX, not a regression.

### Fresh findings (files changed since round 4)

- No findings.

## Verification
- Tests/checks reviewed: static inspection only (read-only environment, no Docker execution). Inspected the two files changed since round 4 — `auth.controller.ts` (getAuthConfig comment/implementation; confirmed `/auth/login` and `/auth/callback` unchanged and still gated on `this.oidc.isEnabled()`) and `auth.controller.spec.ts` (all three GET /auth/config tests, including the new discovery-failed case) — plus the supporting wiring in `oidc.strategy.ts` (isEnabled, discoverClient, onModuleInit), `oidc.strategy.spec.ts` (capability×client matrix at lines 106/138/160), `identity.module.ts` (startup gate), `admin-settings.controller.ts` (health-check OIDC block), and `apps/web/src/app/(auth)/login/page.tsx` (config consumer contract).
- Grep sweeps performed: `isEnabled('oidc')` (6 hits: 3 in oidc.strategy.ts/identity.module.ts, 1 in capability-flags.service.ts snapshot, 1 spec assertion, 1 review doc), `/auth/config` (only login page + controller spec + review doc), `oidcEnabled` (only auth.controller.ts:67, spec assertions, login page, review doc), `registrationEnabled|localEnabled` in web (only login page). No smoke-test or e2e consumer of the `/auth/config` OIDC field exists.
- Implementer-reported gates (both green AFTER the fix, not re-run here): `docker compose -f docker-compose.test.yml down -v` + `up --build --abort-on-container-exit --exit-code-from test` → 34 test files / 414 tests passed, lint + typecheck + prisma migrate deploy + build green; `docker compose down -v` + `./scripts/compose-smoke-test.sh --build` → all steps passed including worker startup (step 9) and BullMQ round-trip (step 10). The intermittent step-9 log-drop was previously established as a machine-specific rootless-podman journald rate-limit artifact, not an AP-16 defect.
- Remaining risks (unchanged, out of scope for this pass): live-runtime OIDC behavior against a real provider (specs fully mocked); real-browser CORS verification; worker processor DB path and prisma/schema.prisma diff (deferred from round 4, not related to this fix). None affect the acceptance criteria.

## Severity counts (one line)
Critical: 0, High: 0, Medium: 0, Minor: 0 — Verdict: APPROVED
