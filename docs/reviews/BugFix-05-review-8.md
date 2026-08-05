# BugFix-05 Review 8 (findings #1–#8, round 6 — final confirmation)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_02e905ce0ffedCcXM85ygtZIjo`), 2026-08-05. Final confirmation
> round on the exact diff to be committed.

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: **READY TO COMMIT**

## Round-5 finding status: VERIFIED RESOLVED

The stale-closure race (submit success of policy A resolving after navigation to B) is fixed identically in all three tabs. Evidence:

1. **Guard covers every post-await setState in the submit success path:**
   - `apps/web/src/app/policies/[id]/covered-persons-tab.tsx:128-136` — `setForm({…})`, `setEditingId(null)`, `setShowForm(false)` and `reloadPersons()` all inside `if (seq === requestSeq.current) { … }`.
   - `apps/web/src/app/policies/[id]/documents-tab.tsx:123-131` — `setFile(null)`, `setForm({…})`, `setShowForm(false)`, `reloadDocuments()` all guarded (no `editingId` in this tab — upload-only, correct).
   - `apps/web/src/app/policies/[id]/portal-links-tab.tsx:136-144` — `setForm({…})`, `setEditingId(null)`, `setShowForm(false)`, `reloadLinks()` all guarded.
   - No post-await state write remains outside the guard in any success path.
2. **Normal single-policy flow unaffected:** `seq` is captured at `handleSubmit` start (covered-persons:96, documents:102, portal-links:102); nothing increments `requestSeq` during a plain submit await, so `seq === requestSeq.current` still holds at success → form reset + reload fire → list refreshes after create/edit. No regression.
3. **`finally` unconditional:** `setSubmitting(false)` (covered-persons:141-143, portal-links:149-151) and `setUploading(false)` (documents:136-138) run on every path; no stuck submitting/uploading.
4. **Pattern identical, comments reference the round:** all three tabs carry the `BugFix-05 (Befund 8, Review-Runde 5)` comment (covered-persons:125, documents:120, portal-links:133) with identical structure and semantics.
5. **Delete success-path guard unchanged:** `if (seq === requestSeq.current) reloadX();` after `if (!res.ok) throw` intact (covered-persons:171, documents:156, portal-links:180); `const seq = ++requestSeq.current;` at delete start unchanged (covered-persons:161, documents:146, portal-links:170).

## Findings

- [Minor] `docs/reviews/` — round-5 review record (0/0/0/1, READY TO MERGE) was delivered in conversation but never written to a file
  - Evidence: `docs/reviews/` contains `BugFix-05-review-1.md` … `review-6.md` only; the round-5 result is missing. The work package's documented review-loop convention (`prompts/BugFix-05-feature-config-portal-url-costs-spinner.md:199`: "Befunde verbatim unter `docs/reviews/BugFix-05-review-N.md`") is not met for this iteration.
  - Required fix: write the round-5 result (and this final round) verbatim to `docs/reviews/BugFix-05-review-7.md` alongside the commit — documentation only, non-blocking.
  - **Resolution:** done — round-5 result written to `docs/reviews/BugFix-05-review-7.md`, this final round to `docs/reviews/BugFix-05-review-8.md`.

## Scope check: PASS

- Every inspected change maps to findings #1–#8 of the work package or the review-driven fixes (rounds 3–5).
- Finding #9 (Dockerfiles / compose-smoke, committed `e1ca357`) untouched — out of scope.
- Dead feature-flags fully removed: grep for `feature-flags|featureFlags|FeatureFlags` in `apps/` returns nothing; no UI/service remains.
- No duplicate `normalizePortalUrl`: exactly two definitions exist — the intentional server copy in `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts:26` and the exported client helper `apps/web/src/lib/portal-url.ts:14`.
- No scope creep found in any reviewed file.

## Verification

- **Tests/checks reviewed:** `health.controller.spec.ts:88-108` (snapshot-rejection case asserting `degraded`/`down`/`{}`), `policy-registry.dto.spec.ts:99-158` (transform output, `javascript:`/`data:` rejection, `@MaxLength(2048)` on both DTOs), new `portal-url.spec.ts` (5 cases), `oidc.strategy.spec.ts:163-203` (DB-down fallback, discovery call counts), `family-sharing.guard.spec.ts`, `capability-flags.service.spec.ts`. The Docker Compose gate (build 4/4, lint 3/3, typecheck, 590 API + 47 web tests, i18n guard) is trusted as reported, not re-run.
- **Areas inspected:** all three tab success/catch/finally/delete paths; `health.controller.ts:58-65` fail-soft `snapshot()` try/catch; `page.tsx:74-94` cancelled-flag + `setPolicy(null)`/`setLoading(true)` reset; `app-shell.tsx:58-74` `[pathname]`-keyed `/ready` effect; `oidc.strategy.ts:64-79` + `identity.module.ts:48-63` env-snapshot fallbacks; `main.ts:19-22` `transform: true` ValidationPipe (transform-before-validate ordering); en/de `costs.perYear` parity (en:292 / de:285) and usage (`costs/page.tsx:175`, `costs-overview-card.tsx` uses the frequency label); `FAMILY_SHARING_ENABLED` in settings-catalog:273 + app-config.schema:170 + capability key `familySharing`; `FamilySharingGuard` on both shares controllers.
- **Remaining risks:** The theoretical race of a delete during an in-flight submit sharing the single `requestSeq` counter (both old and new code are racy in that hand-overlapping interaction) is not evidenced by the repo and is outside the package's scope; not raised as a finding. Round-5 review file gap noted above.

## Acceptance condition

**Met:** 0 Critical / 0 High / 0 Medium / 1 Minor (≤ 8 Minor). All five round-5 verification points pass; all earlier-round items re-verified without regression; scope check passes.
