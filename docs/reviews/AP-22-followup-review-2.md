# Review result

## Findings

- [Minor] `apps/web/src/app/policies/[id]/paperless-tag-section.tsx:200–203` — the tag *assignment* (PUT) path still shows the raw API message instead of a translated cause
  - Evidence: `throw new Error(data?.message ?? t('policies.paperlessTagSaveError'))` renders whatever Nest returns, and the PUT handler emits raw codes: `paperless-tag.service.ts:249` (`'PAPERLESS_NOT_CONFIGURED'`), `:252` (`'PAPERLESS_TAG_NOT_FOUND'`), `:254` (`` `PAPERLESS_TAG_LOOKUP_FAILED: ${kind}` ``). The new helper is imported in this same file and already maps the first (substring match), but the `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>` form resolves to the fallback. So a user whose token lacks rights (the most likely AP-22 setup error) still sees a raw English technical string in the German UI — the exact symptom class the report is about — while the sibling search/create paths were fixed.
  - Required fix: route this branch through `paperlessTagErrorKey(..., 'policies.paperlessTagSaveError')` and either extend the mapping for the lookup codes or give the PUT handler the same `PAPERLESS_<KIND>` message shape as the other two endpoints.

- [Minor] `apps/web/src/__tests__/paperless-tag-error.spec.ts:71–88` — the new cross-package sync guard is incomplete and layout-coupled
  - Evidence: the extractor `/'(PAPERLESS_[A-Z_]+):/g` matches only single-quoted literals, yet the same API file already emits a code through a template literal (`` `PAPERLESS_TAG_LOOKUP_FAILED: ${code}` ``, `paperless-tag.service.ts:254`), proving such emissions are invisible to the guard — a future code added that way would silently escape the assertion instead of failing loudly. In addition the test reads a sibling package via a fixed relative path (`../../../../apps/api/...`), so it breaks if the web package is ever tested outside the monorepo layout (stand-alone build/checkout), and it only pins the API→web direction (nothing catches a stale entry in `CODE_TO_KEY` that is never produced).
  - Required fix: define the code list once (a shared/exported constant used by both the API emitters and the web map) and assert against it, or at minimum also match backtick literals and fail with an explicit message when the API source cannot be read.

- [Minor] `apps/web/src/app/policies/[id]/documents-tab.tsx:112–124` with `paperless-tag-section.tsx:68–89` — the moved section duplicates the config fetch and its hint can go stale
  - Evidence: opening the Documents tab now issues `GET .../policies/:id/paperless-tag` twice (once from `loadAssignedTag` via the mount effect at `documents-tab.tsx:145`, once from the section's `loadConfig`), and the tab's copy is only refreshed through the new `onConfigChange`. `loadAssignedTag` returns without touching state on a non-ok response (`:118`) and only resets to `null` in the `catch` (`:122`), so a failing refresh leaves the previously shown tag rendered in `policies.paperlessLinkAddsTag` — i.e. the tab can claim a tag will be added when the assignment no longer exists.
  - Required fix: load the per-policy tag config once (lift the fetch into the tab and pass state/callback down, or let the section own it and drop `loadAssignedTag`), and clear the hint on a non-ok response.

- [Minor] `apps/web/src/app/policies/[id]/edit/page.tsx:338` — the file still ends without a trailing newline
  - Evidence: the diff carries `\ No newline at end of file` on the result side of the hunk, i.e. the modified file still lacks the final newline that the rest of the tree uses; this change already edits the end of that file, and `lint` is eslint-only, so no gate catches it.
  - Required fix: add the trailing newline (no other content change).

## Verification
- Reviewed the full `-w` patch (18 files) plus the surrounding sources: `paperless-ngx.service.ts` (440–700, incl. `isConfigured`/`requestRaw`/`classifyTagRequest`, page-count and idempotent-race logic), `paperless-ngx.interface.ts` (40–171), `paperless-tag.service.ts` (140–199), `paperless-tag.controller.ts`, `paperless-tag.dto.ts`, `paperless-tag-section.tsx`, `documents-tab.tsx` (95–164, 340–594), `page.tsx`/`edit/page.tsx`, both locales, `docs/06-integrations.md` and the new web helper/spec.
- Adapter callers: repo-wide search confirms `searchTags`/`createTag` are called only from `PaperlessTagService`; the only other interface-typed mock (`paperless-ngx.controller.spec.ts`) uses bare `vi.fn()` and needs no shape update. The controller/service return type stays `PaperlessTagPage`, so `paperless-tag.controller.spec.ts:20` remains valid. No stale consumer of the old `null`/empty-page contract.
- HTTP mapping is consistent with the new docs bullet (NOT_CONFIGURED/UNREACHABLE → 503, AUTH_FAILED/REJECTED → 502, create rejection text unchanged); no token or URL values appear in any new message; the touched endpoints keep their existing guards/roles, so no authorization change.
- Verified absence of trailing whitespace in the two touched `apps/web` components (round-1 item 1) and that `paperlessTagErrorREJECTED` exists in both catalogs (parity test in `i18n.spec.ts` covers the key tree).
- Remaining risks / not covered: the tab move and the "no more misleading *no matching tag*" branch in `paperless-tag-section.tsx:409–414` have no component-level coverage (the web suite is pure-logic only, no React/jsdom harness), so the UI behaviour of the fix rests on the helper unit test plus manual reasoning; browsing/accessibility of the relocated section was not verified here either.

TOTAL: 0 Critical / 0 High / 0 Medium / 4 Minor
