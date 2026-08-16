# BugFix-18 Review — Round 2

Date: 2026-08-16
Scope: delta applied after round-1 minors (auth.controller.ts, oidc.strategy.ts, oidc.strategy.spec.ts)
Reviewer: code-reviewer subagent (session `ses_ff6dae964ffefcPELdlGufoOzq`)

## Reviewer result (verbatim)

> I have verified all four fixes against the current working-tree state of the three files, plus the supporting web layer and tests. Here is my round-2 review.
>
> ## Verification performed
>
> **Fix 1 — ConflictException handled before warn log** (`auth.controller.ts:289-304`)
> - The `if (error instanceof ConflictException)` branch (line 292) with redirect to `/settings?error=oidc-link-conflict` and `return` is executed *before* the `logger.warn` at line 298. Only non-conflict failures reach the warn log. ✓
> - The web layer fully supports the new error param: `settings/page.tsx:105` maps `oidc-link-conflict` → `t('settings.oidcLinkConflict')`, and i18n keys exist in both `en.ts:500` and `de.ts:494`. No unhandled error state. ✓
> - `instanceof` is sound: `auth.service.ts:214` throws `@nestjs/common` `ConflictException` (same class as the controller import at line 3). ✓
> - Test coverage exists: `auth.controller.spec.ts:500-525` asserts the conflict redirect. ✓
> - Session cleanup (`oidcCodeVerifier`/`oidcState`/`oidcLinkMode`) happens at lines 274-276 *before* the try, so it occurs regardless of the catch branch. ✓
>
> **Fix 2 — null return when `originalUrl` missing** (`oidc.strategy.ts:245-248`)
> - `if (!originalUrl) { return null; }` matches the described fix; `!` also guards the empty-string case. Consistent with the fallback path (line 265). ✓
> - New test at `oidc.strategy.spec.ts:426-435` asserts the null return. ✓
> - No regression to the query-preservation test (`oidc.strategy.spec.ts:402-412`): that request *has* `originalUrl: '/auth/callback'`, so the null branch is not hit; `queryIndex === -1` leaves `url.search = '?flow=link'` intact. ✓
>
> **Fix 3 — documented merge behavior** (`oidc.strategy.ts:253-259`)
> - Comment present and accurate. Assessment: acceptable. A query string inside `OIDC_CALLBACK_URL` is a misconfiguration; the merge is deterministic, and the primary flow (no query in the configured URL) is unaffected. The remaining duplicate-parameter edge case is explicitly documented as out-of-scope. ✓
>
> **Fix 4 — session-rotation log format** (`auth.controller.ts:312-316`)
> - Now logs `${err.constructor.name}: ${err.message}` with a `typeof` fallback, matching the other catch blocks (lines 298-301, 328-332). No secret material is included in any log line: link-mode failure logs only error name/message (generic errors); session-rotation logs only the store error. ✓
>
> ## Report
>
> CRITICAL:
> - None.
>
> HIGH:
> - None.
>
> MEDIUM:
> - None.
>
> MINOR:
> - None.
>
> ## Verdict
>
> ACCEPT
>
> All four round-1 minor findings are correctly resolved in the working tree; the delta introduces no new Critical/High/Medium/Minor findings. The documented query-merge behavior (finding 3) is acceptable as kept. Note: this review is read-only verification of the described delta; the coordinator's reported test results (679 API tests incl. the new `originalUrl` test, lint/typecheck pass) are consistent with the code as inspected.

## Final counts

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- MINOR: 0
- Verdict: ACCEPT — acceptance condition met after 2 review rounds.
