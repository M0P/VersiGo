# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 6
- Verdict: PASS

## Findings

- [Minor] `docs/06-integrations.md:61` — the documented `DELETE` behaviour is wrong
  - Evidence: the contract block claims `DELETE .../paperless-tag` answers `NO_PAPERLESS_TAG_CONFIGURED` → `404` when no tag configuration exists, but only `.../sync` (`paperless-tag.service.ts:505`) and `.../retry` emit that code; `removeTag` returns `200` with `{ tagRemoved: false }` for the idempotent case, so an integrator would expect a failure that never occurs.
  - Required fix: state the idempotent `200 { tagRemoved: false }` for `DELETE` and limit the `NO_PAPERLESS_TAG_CONFIGURED` → `404` statement to `.../sync` and `.../retry`.

- [Minor] `docs/06-integrations.md:54` — the documented success shape uses the raw Paperless field name
  - Evidence: the sentence says a successful run without hits stays `200` with an empty `results` list, but the VersiGo endpoint returns `PaperlessTagPage` = `{ items, page, pageCount }` (`paperless-ngx.interface.ts:55-61`) and the web client reads `data.items`.
  - Required fix: say `items`.

- [Minor] `apps/web/src/app/policies/[id]/paperless-tag-section.tsx:109-117` — a one-character search is still completely silent
  - Evidence: for a term shorter than two characters the effect returns early after clearing spinner, results and error, and no hint is rendered, so the user sees neither a result nor an explanation - the same user-visible class as the original report ("kein Fehler, aber auch kein Ergebnis"), independent of Paperless.
  - Required fix: render an explicit minimum-length hint (i18n key) in that state.

- [Minor] `apps/web/src/app/policies/[id]/paperless-tag-section.tsx:107-121` — clearing the search term does not invalidate an in-flight search
  - Evidence: `searchSeq` is only advanced inside the debounce callback; when the term is shortened below two characters the early return clears the visible results but leaves the sequence untouched, so a late response still satisfies `mySeq === searchSeq.current` and re-renders hits under an empty input.
  - Required fix: invalidate pending searches in the early-return branch.

- [Minor] `apps/api/src/features/paperless-ngx/__tests__/paperless-tag.service.spec.ts:140-148,188-191` — the documented `AUTH_FAILED` → `502` status is not pinned
  - Evidence: `UNREACHABLE`/`NOT_CONFIGURED` assert class and message and `REJECTED` asserts `BadGatewayException`, but the `AUTH_FAILED` cases only assert the message, so the `502` in `docs/06-integrations.md:46` is uncovered.
  - Required fix: add `rejects.toThrow(BadGatewayException)` for both `AUTH_FAILED` cases.

- [Minor] `apps/api/src/features/paperless-ngx/dto/paperless-tag.dto.ts:24-27` with `paperless-ngx.service.ts:600-601` — a whitespace-only name is reported as a Paperless rejection
  - Evidence: `@MinLength(1)` lets `'   '` through, the adapter then trims it to an empty tag name and reports `REJECTED`, which becomes `502 PAPERLESS_TAG_CREATE_FAILED` although Paperless was never asked.
  - Required fix: normalise/trim the DTO value so a blank name is rejected as a client error.

## Verification
- Reviewed the `-w` patch in full plus the white-space-only re-indentation of `documents-tab.tsx`, and re-read the current sources: `paperless-ngx.interface.ts` (40-171), `paperless-ngx.service.ts` (`searchTags` 532-579, `createTag` 599-643, `classifyTagRequest` 521-530, pagination/count logic), `paperless-tag.service.ts` (33-57, 142-197, 236-259), `paperless-tag.controller.ts`, `dto/paperless-tag.dto.ts`, `paperless-tag-error.ts`, `paperless-tag-section.tsx`, `documents-tab.tsx`, `page.tsx` (policy null-narrowing at :105 confirmed before `renderTabContent`), `edit/page.tsx` (import/section removal), both locales, and the four touched docs.
- Round-3 delta confirmed present in the code, not only in the report: dedicated `tagSeq` (bumped at lookup start and in cleanup, `documents-tab.tsx:115-133,160`); PUT lookup contract documented (`docs/06-integrations.md:57-63`) and `PAPERLESS_TAG_NOT_FOUND: …` given an explanation (`paperless-tag.service.ts:251-256`); `pageCount` comment matches the three-way rule and the `next` fallback is pinned by the new test (`paperless-ngx.service.spec.ts:620-647`); the `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>` doc comment names only `AUTH_FAILED | UNREACHABLE` (`paperless-tag-error.ts:31-36`); the plain `REJECTED` compatibility limitation is recorded in the contract.
- Reachability checks: `searchTags`/`createTag` have no production callers besides `PaperlessTagService`; the worker has its own client and does not consume the changed adapter methods; `paperless-tag.controller.spec.ts` mocks the service (still type-correct); `DocumentsTab` has a single caller, updated with the new prop.
- Cross-package guard: the codes matched by the web spec are exactly the seven emitted with a colon in `paperless-tag.service.ts`; the `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>` template resolves for every kind the lookup can return.
- Intentional decisions judged acceptable: the plain `REJECTED` compatibility mapping (no raw upstream text, historical codes retained) and the duplicated per-policy config fetch when the Documents tab opens (idempotent, authenticated, read-only; merging would require re-plumbing without a React test harness).
- Not verifiable here (consistent with the handover): no browser/e2e/accessibility harness, so the tab move was reviewed by code inspection only; the Docker Compose run and host `tsc` results were taken as reported.
- Residual risk (pre-existing, not introduced): a 200 tag-search answer whose results were dropped only by the client-side refilter still renders the silent "Kein passender Tag gefunden." state; only detectable failures are now named.

TOTAL: 0 Critical / 0 High / 0 Medium / 6 Minor
