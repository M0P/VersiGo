# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 3
- Verdict: PASS

## Findings

- [Minor] `apps/web/src/app/policies/[id]/documents-tab.tsx:358,381,387,393,399,432,473,475` — the mechanical 2-space re-indentation introduced trailing whitespace on eight previously empty lines
  - Evidence: the full patch replaces eight empty lines (`-` with no content, patch lines 792/798/804/816/849/999/1001) with lines that contain two spaces (`+  `, patch lines 808/887/893/899/905/941/990/992); `grep '^[ \t]+$'` still matches exactly those eight lines in the committed file. The repo has no prettier/formatter gate (lint and the hardcoded-German guard do not look at whitespace), so this was not caught by the recorded "All checks passed!" run and will show up as noise in every future whitespace-only diff of this file.
  - Required fix: remove the trailing spaces on those eight lines (hand-edit; no formatting tool available).

- [Minor] `docs/06-integrations.md:33-39` — the integration document still describes only the happy path of the interactive tag API, while the new, externally visible failure contract was not recorded there
  - Evidence: this work package changed the observable API contract (`GET /households/:id/paperless-tags` now returns 503 `PAPERLESS_NOT_CONFIGURED`/`PAPERLESS_UNREACHABLE`, 502 `PAPERLESS_AUTH_FAILED`, 502 `PAPERLESS_TAG_SEARCH_FAILED`; `POST /households/:id/paperless-tags` maps the same kinds and keeps `PAPERLESS_TAG_CREATE_FAILED` for a rejection). `docs/05-feature-slices.md`, `docs/ui-control-matrix.md` and `docs/end-user-guide.md` were updated, but the file that documents these exact endpoints only repeats the pre-change description ("serverseitige Suche in Paperless", "Tag anlegen, idempotent"). A reader integrating against these endpoints has no source for the new status/code semantics.
  - Required fix: add a short bullet to the "REST-API" section of `docs/06-integrations.md` listing the code prefixes and their HTTP statuses for both endpoints.

- [Minor] `apps/api/src/features/paperless-ngx/paperless-tag.service.ts:39-57` together with `apps/web/src/lib/paperless-tag-error.ts:18-25` — the code prefixes exist twice (API emitters and web parser) with no guard tying them together
  - Evidence: the API emits `PAPERLESS_NOT_CONFIGURED`, `PAPERLESS_AUTH_FAILED`, `PAPERLESS_UNREACHABLE`, `PAPERLESS_TAG_SEARCH_FAILED`, `PAPERLESS_TAG_CREATE_FAILED` as string literals; the web helper repeats them as a second literal table. The API spec pins the emitted strings, and the web spec pins the parsed strings, but nothing fails if the two lists drift (e.g. a renamed prefix keeps the API green, and the UI silently degrades to the generic `policies.paperlessTagSearchError`/`paperlessTagSaveError` text — the exact symptom class the ticket is about).
  - Required fix: derive both sides from one list (e.g. export the code constants from a shared location or add a check that asserts every `PaperlessTagRequestError['kind']`-derived prefix is present in the web mapping table).

## Verification
- Reviewed: the complete `-w` diff (all 17 files, semantically identical file set as the full patch) plus the white-space-only re-indentation of `documents-tab.tsx` in the full patch, and the current content of `paperless-ngx.interface.ts`, `paperless-ngx.service.ts` (lines 108-167, 420-660), `paperless-tag.service.ts` (30-196), `paperless-tag-section.tsx`, `documents-tab.tsx` (1-200, 330-594), `page.tsx` (60-219), `edit/page.tsx` (320-338), `lib/paperless-tag-error.ts`, both locales, and the three synced docs.
- Adapter callers: a repo-wide search shows `searchTags`/`createTag` are called only from `PaperlessTagService` (the `paperless-tag.controller.ts` delegation is unchanged and its spec still matches the service return types; the worker has its own client without these methods; `documents.service.ts` only carries an unused mock). No caller was left on the old `null`/`PaperlessTagPage` contract, and no smoke/e2e script hits `paperless-tags`.
- Correctness checked: `isConfigured()` now precedes `requestRaw` (which collapses unconfigured and network failure into `null`), so NOT_CONFIGURED is genuinely distinguishable from UNREACHABLE; `classifyTagRequest` is exclusive and exhaustive over the request kinds (the `Record<Exclude<…,'REJECTED'>>` makes a new kind a compile error); idempotent creation is preserved (exact-name pre-check, 201 identity check, 400/409 race re-lookup) and a bodyless 201 is deliberately reported as UNREACHABLE; `pageCount` 0 for an empty catalogue only replaces a previously misleading non-zero value and has no consumer in `apps/web` (no "load more" exists), so it is inert but not harmful.
- Web behaviour: the "no matching tag" paragraph is now suppressed exactly when `searchError` is set (`!searching && !searchError && …`), the error is cleared when the term drops below two characters, `setResults([])` plus the error alert prevent the "silent empty result" symptom, and the create path maps the API body through the helper. Dynamic `t()` with a runtime key follows the documented translator contract (`MessagePath<Messages> | (string & {})` in `apps/web/src/i18n/core.ts:81-89`), and the new key exists in both `de` and `en`.
- Security: the new messages contain no token/URL/credential material; `assertHouseholdAccess` still runs before any adapter call, and no guard/role annotation was changed. The section is still reachable for READ_ONLY users, but that was already true via the unguarded "Edit" link on the same detail page, so exposure did not increase.
- Docs: `docs/05-feature-slices.md`, `docs/end-user-guide.md` and `docs/ui-control-matrix.md` are consistent with the new tab location and error codes; no remaining reference to `/policies/[id]/edit` for tag assignment, and no i18n text mentioning the old location.
- Remaining risks / not reviewed by me: I could not re-run the Docker Compose gate (read-only, no shell), so the recorded "All checks passed!" run is taken as reported; the tab move and the alert replacement have no automated coverage (this repo has no component/browser harness — the web suite only tests pure helpers, and the new spec follows that convention), and `loadAssignedTag`'s pre-existing ungarded fetch is unchanged, so a cross-policy stale hint remains possible in principle; also note that `docs/reviews/` has no review document for this follow-up round, which the coordinating agent owns.

TOTAL: 0 Critical / 0 High / 0 Medium / 3 Minor
