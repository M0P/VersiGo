# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 5
- Verdict: PASS

The work package matches its stated scope: the section is moved out of `edit/page.tsx` and rendered by `documents-tab.tsx`, all four interactive paths route through `paperless-tag-error.ts`, the adapter contract now carries explicit failure kinds, the `pageCount` fix is in, docs + i18n are updated on both sides, and the round-2 delta (PUT mapping, guard coverage, stale hint, trailing newline) is verifiably present. No regression in other consumers: `searchTags`/`createTag` are only called from `PaperlessTagService` (controller unchanged, roles unchanged), and `paperless-tag.controller.spec.ts` mocks the *service* whose return shapes are unchanged, so its old mock data is still valid. No token/URL leakage was added; `docs/end-user-guide.md` and the locales contain no stale reference to the edit page.

## Findings

- [Minor] `apps/web/src/app/policies/[id]/documents-tab.tsx:113-128` — `loadAssignedTag` writes state without the request-sequence guard its sibling uses
  - Evidence: the new failure branch calls `setAssignedTagName(null)` (line 120) and the success branch calls `setAssignedTagName(data?…)` (line 124) with no `requestSeq`/`seq` check, while the adjacent `reloadDocuments` (lines 86-108) invalidates in-flight requests via `requestSeq` and the effect cleanup (lines 152-156) bumps it. After a policy switch, a late failing response for policy A therefore clears the hint that was just loaded for policy B (transient wrong/empty "manueller Link erhält Tag …" hint).
  - Required fix: capture a sequence token at the start of `loadAssignedTag` (reuse `requestSeq` or add a dedicated ref) and only apply `setAssignedTagName` when it is still current.

- [Minor] `docs/06-integrations.md:40-56` — the documented error contract does not cover the PUT path that this delta changed
  - Evidence: the contract block is explicitly scoped to `GET`/`POST /households/:id/paperless-tags`, but round 2 changed the `PUT …/paperless-tag` messages (`paperless-tag.service.ts:249` bare `PAPERLESS_NOT_CONFIGURED`, `:254-256` now `PAPERLESS_TAG_NOT_FOUND: …`, `:258` `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>`) and the web client newly parses them (`paperless-tag-error.ts:27`, `:37`, `:74-79`). A grep for `TAG_LOOKUP_FAILED`/`TAG_NOT_FOUND` in `docs/` returns only the review notes, so an integrator cannot learn the PUT status/code semantics the docs claim to describe.
  - Required fix: extend the contract block (or add a short PUT sub-section) listing the PUT codes, their statuses (404 / 502) and the `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>` form.

- [Minor] `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:564-…` — the `pageCount` comment does not match the implementation and the `next` fallback is untested
  - Evidence: the comment explains the value as if it described the empty-catalogue case, while the code branches on `count === null`; the fallback branch (`count` missing from the payload) has no test, although `isTagPage` only asserts the presence of a results array and therefore lets a `count`-less payload through at runtime.
  - Required fix: align the comment with the actual rule and cover the fallback with a test (or drop it).

- [Minor] `apps/web/src/lib/paperless-tag-error.ts:37` — the doc comment lists `REJECTED` as a possible `<KIND>` of `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>`, but the producer cannot emit it
  - Evidence: the only producer is the adapter's tag lookup, which reports `NOT_FOUND`/`NOT_CONFIGURED`/`AUTH_FAILED`/`UNREACHABLE`; `REJECTED` would be resolved as `PAPERLESS_REJECTED`, which is not in `CODE_TO_KEY`, so it would fall back silently while the documentation claims it is handled.
  - Required fix: remove `REJECTED` from the vocabulary in the comment (or add a mapping entry plus a test).

- [Minor] `apps/api/src/features/paperless-ngx/paperless-tag.service.ts:154-162` with `apps/web/src/i18n/locales/de.ts:322` — the plain "rejected" case still names no cause
  - Evidence: every server-side refusal that is not `AUTH_FAILED`/`UNREACHABLE`/`NOT_CONFIGURED` collapses to `PAPERLESS_TAG_SEARCH_FAILED` / `PAPERLESS_TAG_CREATE_FAILED`, which the UI renders as "Paperless-ngx hat die Anfrage abgelehnt." The reported symptom was a failing creation, so that case still yields no reason, unlike the newly named kinds. The review raises this for an explicit accept/reject decision: the compatibility text is deliberate (see `docs/06-integrations.md`).
  - Required fix: record the accepted limitation in the documented contract (optionally surface a sanitised upstream hint).

## Verification
- Reviewed the `-w` patch in full plus the changed sources: `paperless-ngx.interface.ts`, `paperless-ngx.service.ts` (search/create/classify/`isConfigured`), `paperless-tag.service.ts`, `paperless-tag.controller.ts`, `paperless-tag-error.ts`, `paperless-tag-section.tsx`, `documents-tab.tsx`, `page.tsx` (`policy` narrowing confirmed before `renderTabContent`), `edit/page.tsx` (newline present, import removed), both locales, and the touched docs.
- Reachability checks: `searchTags`/`createTag` have no production callers besides `PaperlessTagService`; the worker has its own `PaperlessTagClient` and does not consume the changed adapter methods; `paperless-tag.controller.spec.ts` mocks the service (still type-correct); `DocumentsTab` has a single caller, updated with the new prop.
- Cross-package guard: the codes matched by the new web spec are exactly the seven emitted with a colon in `paperless-tag.service.ts`; the `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>` template now resolves for every kind the tag lookup can return.
- Judgement on the documented residual (per-policy config fetched twice): acceptable. The extra request is idempotent, authenticated, read-only and consistent with the "read-only roles may read" contract; merging it would require lifting state between components without a component test harness, and the callback keeps the hint in sync after PUT/DELETE. One consequence worth knowing (not a finding): after a tag change the *document list* is not reloaded, but new assignments are produced asynchronously by the worker, so an immediate reload would show nothing anyway.
- Not verifiable here (consistent with the handover): no browser/e2e/accessibility harness, so the tab move was reviewed by code inspection only; the Docker Compose run and host `tsc` results were taken as reported.
- Residual risk (pre-existing, not introduced): a 200 tag-search answer whose results were dropped only by the client-side refilter still renders the silent "Kein passender Tag gefunden." state; only detectable failures are now named.

TOTAL: 0 Critical / 0 High / 0 Medium / 5 Minor
