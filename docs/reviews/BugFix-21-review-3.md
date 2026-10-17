# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| 1. `getDeepLink` runs no HTTP call, builds link from config | Met | `paperless-ngx.service.ts:304-308` → `isConfigured()` + `buildDeepLink()` (settings-based, no axios). Tests `paperless-ngx.service.spec.ts:141-170` assert the URL and `mockHttp.get/request` not called, including for a 404/disabled case. |
| 2. Tag sync persists date + MIME, leaves manual user values untouched | Met | `deriveTagLinkMetadata` (`paperless-tag.processor.ts:59-93`) + reconciliation wiring (`:400-427`). Tests `paperless-tag-metadata.spec.ts` (7 cases) and `paperless-tag.processor.spec.ts` (date/MIME storage, refresh, never overwrite user-edited metadata, gap fill). |
| 3. Manual link stores the MIME type | Met | Create branch `documents.service.ts:367`; gap-fill `:449-453`. Tests `documents.service.spec.ts:312-323`, `:640-646`, and `paperless-ngx.service.spec.ts:217,242`. |
| 4. Unit tests for type detection (MIME, extension, fallback) | Met | `apps/web/src/__tests__/document-type.spec.ts` (kind by MIME/extension, case-insensitivity, `.`-only, fallback `other`, icon/label mapping + catalog resolution for all 5 kinds). |
| 5. Guard test: every static `t('…')` key in `documents-tab.tsx` exists | Met | `apps/web/src/__tests__/documents-tab-i18n.spec.ts` reads the component and resolves every collected key against `de`+`en`; `keys.length > 5` guards the guard; explicit assertion that `common.uploadedAt` is gone. |
| 6. Lint, typecheck, build, tests green via Docker Compose | Met (reported) | Docker gate reported green by the package (lint, typecheck, api 754 / worker 48 / web 110 / foundation 107, license, version sync, i18n). Independently re-verified statically: signature change of `applyManualLinkOrigin` has all 3 call sites updated. |
| 7. Documentation updated (4 docs) | Met | Patch updates `docs/06-integrations.md`, `docs/ui-control-matrix.md`, `docs/end-user-guide.md`, `docs/05-feature-slices.md`, including the new "known limits". |

## Findings
- [Minor] `apps/api/src/features/documents/documents.service.ts:371` — create-branch date guard is implemented but not covered by a test
  - Evidence: The round-2 fix replaced two sites with `parsePaperlessDate` (create branch `:371`, gap-fill `:452-453`). The new test `documents.service.spec.ts:683` ("skips an unusable Paperless date") only exercises the gap-fill path (`findFirst` returns an existing row). No test calls `linkPaperlessDocument` with an unusable `created` on the create path, so reverting `:371` would persist `Invalid Date` again without any test failing.
  - Required fix: Add a focused test that links a not-yet-existing document whose Paperless `createdAt` is unusable and assert the `policyDocument.create` data contains `documentDate: null`.
- [Minor] `apps/web/src/__tests__/documents-tab-i18n.spec.ts:24` — the double-quote support in the key collector is not exercised by any assertion
  - Evidence: The round-2 fix widened the pattern to `/t\(\s*['"]([A-Za-z0-9_.]+)['"]/g`. The component contains only single-quoted `t('…')` calls, so `it.each(keys)` yields the same keys with the old single-quote-only regex. Reverting the regex would not fail any test.
  - Required fix: Add a unit test for the collector that feeds it a snippet containing both `t('a.b')` and `t("c.d")` and asserts both keys are collected.

## Verification
- Change set reviewed: full `/tmp/opencode/BugFix-21-r3.patch` (1744 lines) plus `/tmp/opencode/BugFix-21-r2.patch` for delta confirmation; working-tree files re-read directly.
- Round-2 fix #1: verified correct and complete for both call paths (`documents.service.ts:371` and `:452-453`, including the module-level helper at `:63-67`); verified the new test is discriminating.
- Round-2 fix #2: verified the regex accepts both quote styles and that current component keys are collected; no accidental matches from other call sites.
- Grep for unguarded `new Date(<external>)` in the BugFix-21 code: only the two `parsePaperlessDate` helper implementations use `new Date` on Paperless input.
- Regression surface inspected: adapter interface shape changes, `applyManualLinkOrigin` arity (3/3 call sites updated), widened `reconcileAssignments` `select`, removed `uploadedAt` type field with no remaining references in `apps/web`.
- i18n: new `documentTypeKind*` keys exist in both catalogs; the dynamic icon label is covered by the catalog-resolution test.
- Not independently executable here (read-only, no shell): the Docker Compose gate and its test counts are accepted as supplied by the package.
- Remaining risks: `parsePaperlessDate` is intentionally duplicated in `apps/api` and `apps/worker` (separate deployables, no shared util) – behaviourally equivalent; the two Minor coverage gaps above are the only residual items.

## Reviewer metadata
- Reviewer subagent: `code-reviewer` (model `opencode/deepseek-v4.1-flash-free`)
- Round: 3
- Note: the agent configuration at `.opencode/agents/code-reviewer.md` names the model `opencode/deepseek-v4-flash-free`, which the provider reports as unavailable ("Model unavailable"); the review was therefore invoked with the available `opencode/deepseek-v4.1-flash-free` model.
