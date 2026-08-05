# BugFix-05 Review 7 (findings #1–#8, round 5)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_02e987e59ffenVw6HPtl3Pw8td`), 2026-08-05.

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: **READY TO MERGE**

## Round-4 finding status

**VERIFIED RESOLVED** — the submit/delete SUCCESS-path reload is now seq-guarded in all three policy tabs.

Verification against the four required sub-checks:

1. **Stale closure cannot reload A's data under B.** After a `policyId` change, the effect cleanup runs `requestSeq.current += 1` (covered-persons-tab.tsx:86, documents-tab.tsx:88, portal-links-tab.tsx:92) and the new effect's `reloadX()` increments again. A stale success path then evaluates `seq === requestSeq.current` against the bumped counter and skips the reload. Trace confirmed: submit (seq read at covered-persons-tab.tsx:96 / documents-tab.tsx:102 / portal-links-tab.tsx:102), A→B navigation bumps the counter twice, stale `seq` no longer matches → reload skipped; B's mount effect loads B's data. Delete path identical (covered-persons-tab.tsx:157,167; documents-tab.tsx:142,152; portal-links-tab.tsx:166,176).
2. **No legitimate reload skipped.** In the normal single-policy flow nothing bumps `requestSeq` between the seq capture and success, so `seq === requestSeq.current` holds and `reloadPersons/reloadDocuments/reloadLinks` still fire (covered-persons-tab.tsx:132, documents-tab.tsx:127, portal-links-tab.tsx:140 for submit; :167/:152/:176 for delete). List refresh after create/edit/delete is preserved; the acceptance criterion "Upload → Wechsel → zurück → Dokument sichtbar" is served by the remount effect.
3. **No double-increment / stuck-submitting.** `setSubmitting(false)` / `setUploading(false)` remain unconditional in `finally` (covered-persons-tab.tsx:138, documents-tab.tsx:133, portal-links-tab.tsx:146). The delete `++requestSeq.current` followed by `reloadX()`'s own `++` is the pre-existing two-increment pattern; both internal `seq` comparisons resolve correctly (verified ordering for concurrent delete + in-flight reload, delete-fails case, and delete-during-reload case — final state always consistent).
4. **Pattern consistent + comments.** Identical structure in all three tabs; guards placed after the form-reset/`throw` so error paths never reload; comments reference BugFix-05/Round-4 in all six locations (covered-persons-tab.tsx:128-131,164-166; documents-tab.tsx:123-126,149-151; portal-links-tab.tsx:136-139,173-175).

## New findings

- [Minor] `apps/web/src/app/policies/[id]/{covered-persons,documents,portal-links}-tab.tsx` — submit success path form-reset writes are not seq-guarded
  - Evidence: on the successful POST/PATCH path the writes `setForm({...empty})`, `setEditingId(null)`, `setShowForm(false)` run unconditionally before the newly guarded reload (covered-persons-tab.tsx:125-127, documents-tab.tsx:120-122, portal-links-tab.tsx:133-135). These are post-await state writes from a stale closure: if a submit for A is in flight while the user navigates A→B, opens B's form and starts typing, A's late success response closes B's form and wipes the typed input. The error path is already guarded (`setFormError` only when `seq === requestSeq.current`, e.g. covered-persons-tab.tsx:134-136), so this is only the success-path form state — a very narrow race with low impact (idempotent resets in the common case, since B's effect already reset the form).
  - Required fix: optionally guard the three form-reset writes with the already-captured `seq`, e.g. wrap them in `if (seq === requestSeq.current) { ... }` for full consistency with the reload guard — non-blocking hardening, no behavior change in the normal flow.

## Scope check

- **PASS.** Every inspected change maps to findings #1–#8 of `prompts/BugFix-05-feature-config-portal-url-costs-spinner.md` and the round-4 review-driven fix (success-path reload seq-guards). Finding #9 (worker/api Dockerfile package-`node_modules` COPYs + per-service store mount IDs, `apps/worker/Dockerfile:26,41-43`) is untouched and remains as committed in e1ca357. Re-verified no regressions: `/ready` fail-soft try/catch around `capabilities.snapshot()` returning `{}` (health.controller.ts:58-65) with the DB-down spec case (`health.controller.spec.ts:88-108`); form-state reset on policyId change in all three tab effects; `page.tsx:74-94` cancelled-flag guard covering `.then`/`.catch`/`.finally`; `PortalUrlTransform` on both Create/Update DTOs with the new spec cases; client `normalizePortalUrl` in `apps/web/src/lib/portal-url.ts` + 5-case spec with no duplicate definition anywhere (only the intentional server-side copy in the DTO); OIDC/identity DB-down env fallbacks (`oidc.strategy.ts:64-74`, `identity.module.ts:48-63`) plus both spec cases; app-shell `/ready` capability effect keyed on `[pathname]` (`app-shell.tsx:58-74`); `costs.perYear`/`paidToDate`/`perPeriod` i18n en/de parity and usage (`costs/page.tsx:175`, `costs-overview-card.tsx:110-118`); `/costs/overview|annual|compare` still declared before `:entryId` (`cost-tracking.controller.ts:47-78`); `familySharing` capability + `FAMILY_SHARING_ENABLED` catalog entry intact. No scope creep found.

## Verification
- Tests/checks reviewed: `health.controller.spec.ts` (snapshot-rejection case + all pre-existing cases), `policy-registry.dto.spec.ts` (transform/security/MaxLength cases), `portal-url.spec.ts`, `oidc.strategy.spec.ts` (both DB-down cases), family-sharing guard/service/controller specs referenced, cost-tracking service/controller route ordering. The Docker Compose gate (build 4/4, lint 3/3, typecheck, 590 API + 47 web tests, i18n guard) was reported green and trusted per instructions, not re-run.
- Important areas inspected: all three tab seq-guard fixes (submit + delete success paths, form-reset effects, finally blocks), race traces for A→B navigation and concurrent delete/reload interleavings, health fail-soft completeness, DTO transform ordering vs. `transform: true` ValidationPipe, OIDC/identity boot fallbacks, app-shell pathname effect, costs i18n parity, duplicate-helper grep.
- Remaining risks: the single Minor finding above (narrow stale-submit form-wipe race, non-blocking); no other material risks identified.

## Acceptance condition
- Met: **0 Critical / 0 High / 0 Medium / 1 Minor** (≤ 8 Minor). Round-4 finding verified resolved; the one new Minor is a non-blocking consistency hardening. **READY TO MERGE.**
