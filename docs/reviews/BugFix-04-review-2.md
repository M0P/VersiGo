# BugFix-04 Review — Iteration 2

Date: 2026-08-04
Reviewer: code-reviewer subagent (via Task tool)
Scope: Re-review of the iteration-1 findings and the fixes applied since then (work package BugFix-04).

## Verdict

APPROVED

## Summary

- Critical: 0
- High: 0
- Medium: 0
- Minor: 2

## Findings

- [Minor] `apps/web/src/app/admin/monitoring/page.tsx:102-108` — `loadAll()` unconditionally commits `null` state slices before the 401/403 redirect navigates away
  - Evidence: `handleResponse` returns `Promise.resolve(null)` for 401/403 and sets `window.location.href`. `Promise.all(...).then(([q, f, a, i]) => { setQueues(q); setFailedJobs(f); ... })` then runs unconditionally, wiping all four state slices to `null` and rendering the "No queues available / No failed jobs / No integrations" empty states for the frame(s) before the browser navigates. The sibling pages are marginally more defensive: `audit/page.tsx:59` and `users/page.tsx:75` guard with `if (data)`, so they never overwrite already-loaded data on auth failure (they do still flash an empty state on a first load, so this is a cosmetic difference, not a functional one). Since the redirect fires synchronously on the first 401/403, the wipe is transient and invisible in the common case; it is only observable if navigation is delayed. This is consistent with the pattern used by the other pages and does not reintroduce the iteration-1 Medium (non-ADMINs now get 403 → `/forbidden`).
  - Required fix: Optional hardening only — skip the state commits when the tuple contains `null` values, e.g. check `if (q && f && a && i)` inside the `.then` before calling the setters (mirroring the `if (data)` guard in `audit/page.tsx`/`users/page.tsx`). Not required for correctness.

- [Minor] `apps/web/src/i18n/locales/en.ts:598` and `apps/web/src/i18n/locales/de.ts:591` — unused `admin.audit.count` key remains after replacing it with `shownCount`
  - Evidence: `admin.audit.count` (`'{count} events'` / `'{count} Ereignisse'`) is no longer referenced anywhere in `apps/web/src` (grep for `audit.count` returns zero matches). It is harmless: it exists in both catalogs so the key-tree parity test (`i18n.spec.ts:91`) still passes, it has no runtime cost, and removing it is a trivial cleanup. No consumer references it, so there is no dead-code risk.
  - Required fix: Optional cleanup — remove the key from both `en.ts` and `de.ts` (must be done in both to keep the parity test green). Safe to leave as-is; non-blocking.

No other issues were found. The four applied fixes are correct and complete (details in Verification).

## Verification (reviewer)

- `admin/monitoring/page.tsx`: `handleResponse` now redirects 401 → `/login`, 403 → `/forbidden`, rejects other non-ok statuses with `t('admin.monitoring.loadError')`, and `res.json()` on success. The dead `AuthRedirect` catch-branch is gone (grep for `AuthRedirect` returns nothing). `handleRetry` re-runs `loadAll()` after a successful retry (also refreshes queue counters, fixing the stale-counts Minor). The retry POST correctly handles 401/403 inline and keeps `handleResponse` out of the 204-no-body path.
- Type safety of `as const` + per-promise casts: the `as Promise<X | null>` casts narrow `Promise<unknown>`, and `as const` preserves the per-element tuple types through destructuring; the re-literal passed to `Promise.all` resolves to the correct `[A, B, C, D]` tuple via the tuple-constrained `Promise.all` overload. `typecheck` passing corroborates this.
- `settings/page.tsx`: export uses a dedicated `exported` state; `setSaved` is no longer triggered by export; the new `settings.exportSuccess` alert renders inside the export card. 401/403 handling is consistent with the sibling pattern.
- `admin/audit/page.tsx`: `shownCount` renders with `count` = `events.length`, `total` = `total`; server caps `take` at 200 and returns `{events, total}` (audit.service.ts:39), so the "{count} of {total} … max 100 per page" wording is accurate (page requests `take: '100'`).
- i18n parity: `admin.monitoring.loadError`, `settings.exportSuccess`, `admin.audit.shownCount` exist in both `en.ts` and `de.ts`; key-tree equality is enforced by the runtime parity test plus `satisfies Messages`. All other keys used by the three pages (`common.error`, `common.actions`, `common.unknownError`, `policies.experimental`, every `admin.monitoring.*` / `admin.audit.*` / `settings.*` key) verified present in both catalogs.
- API response-shape consistency re-verified: `monitoring.service.ts` (queues/failed/ai-jobs/integrations incl. `portalConnectors`), `audit.service.ts` (`{events,total}`), `privacy.controller.ts` (`PrivacyExport`) all match the UI types. Status-code contract confirmed: missing session → 401 (`auth.guard.ts:35`), insufficient role → 403 (`roles.guard.ts:39,47`), so the redirect mapping in `handleResponse` is correct.

## Remaining risks

- The new audit/monitoring/export pages still have no dedicated unit tests covering `loadAll`/`handleResponse` error paths (noted in iteration 1; unchanged). A small test around 401/403 handling would prevent regression.
- Could not execute the test suite, typecheck, or Docker smoke test in this read-only environment; the iteration report's green results were taken at face value.

## Follow-up (after review)

Both Minor findings were addressed by the coding agent after this review:
- `loadAll()` now skips state commits when any tuple element is `null` (mirrors `if (data)` guard of sibling admin pages).
- Unused `admin.audit.count` key removed from both `en.ts` and `de.ts`.
