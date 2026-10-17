# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| 1. Unit tests prove `PaperlessNgxService.getDeepLink` performs no HTTP call and builds the link from config | Met | `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:304-308` → `isConfigured()` + local `buildDeepLink(id)` (settings only). Tests `paperless-ngx.service.spec.ts:137-170` stub `http.get`/`http.request` and assert `not.toHaveBeenCalled()` (200, "deleted" doc, disabled → `null`). Single implementer of `IPaperlessAdapter` — no other implementer missed. |
| 2. Unit tests prove the tag sync persists document date + MIME type and leaves user values of manual links untouched | Met | `deriveTagLinkMetadata`/`parsePaperlessDate` (`paperless-tag.processor.ts:43-93`), wiring at `:396-427` with widened `select` (`:369-379`). Tests `paperless-tag-metadata.spec.ts` (7 cases) and `paperless-tag.processor.spec.ts` (new create metadata, auto refresh, never-overwrite, gap-fill-only). |
| 3. Manual link stores the Paperless MIME type | Met | Create branch `documents.service.ts:367`; gap-fill `:449-453`; interface field `paperless-ngx.interface.ts:31`. Tests `documents.service.spec.ts:312-323`, `:645-735`, `paperless-ngx.service.spec.ts:212-245`. |
| 4. Unit tests for type detection (MIME, extension, fallback) | Met | `apps/web/src/lib/document-type.ts` (pure) + `apps/web/src/__tests__/document-type.spec.ts` (MIME, extension-only, case-insensitivity, bare dot, `other` fallback, icon/label mapping, catalog resolution for all 5 kinds). |
| 5. Guard test: every static `t('…')` key in `documents-tab.tsx` exists in the catalog | Met | `apps/web/src/__tests__/documents-tab-i18n.spec.ts` reads the component, asserts `keys.length > 5`, resolves each key in `de`+`en`, and asserts `common.uploadedAt` is gone. |
| 6. Lint, typecheck, build, tests green via Docker Compose | Met (reported) | Package reports the full gate green (lint, typecheck, api 755 / worker 48 / web 111 / foundation 107, license check, version sync, i18n guard). Not independently executable in this read-only review; accepted as supplied. No compose/`.env`/migration files appear in the change set, so the stack is unchanged. |
| 7. Documentation updated (4 docs) | Met | Change set updates `docs/06-integrations.md`, `docs/ui-control-matrix.md`, `docs/end-user-guide.md`, `docs/05-feature-slices.md`, including the accepted trade-offs (link for a deleted Paperless doc, auto-managed metadata being overwritten by the next sync, pre-BugFix-21 rows lacking metadata until the next sync). |

## Findings
- No findings.

## Verification
- Change set reviewed: `/tmp/opencode/BugFix-21-r4.patch` (1796 lines) plus a hunk-level comparison against `/tmp/opencode/BugFix-21-r3.patch`. The only differences are the two added tests (API +34 lines, web +11 lines); every production hunk is byte-identical between r3 and r4, so no regression can have been introduced by the round-4 delta.
- Round-3 finding 1 fix is discriminating: the new `documents.service.spec.ts` test links a **not-yet-existing** document (`findFirst → null`, so the create path runs) with `createdAt: 'not-a-date'` and asserts `policyDocument.create` data contains `documentDate: null`. Reverting the guard yields an `Invalid Date`, which fails the assertion.
- Round-3 finding 2 fix is discriminating for the thing it guards: `documents-tab-i18n.spec.ts` feeds the collector `t('policies.a'); t("policies.b"); notT('policies.c')` and requires exactly `['policies.a','policies.b']`. Narrowing the regex to single quotes fails it.
- Behavioural re-check of the final production state: `applyManualLinkOrigin` arity 4 with all 3 call sites updated; the no-tag branch stays write-free when there is nothing to record; the tag branch merges `...gaps` without overwriting existing values; `getDeepLink` local-only; worker create respects the `fileName` fallback and conditional `documentDate`/`mimeType`.
- Web regression surface: `uploadedAt` removed from the `Document` type and the view; no remaining references in `apps/web`. `Icon` supports `size`, all five new icon names exist in `ICON_PATHS`, `documentTypeKind` edge cases resolve to `other`, and the second action-column badge is gone per the requirement.
- Not independently executable here (read-only, no shell): the Docker Compose gate and its test counts are accepted from the package report. Remaining risks are the ones already documented in `docs/06-integrations.md`, plus the intentional `parsePaperlessDate` duplication between `apps/api` and `apps/worker`.
- Reviewer model: `opencode/deepseek-v4.1-flash-free` (configured for this subagent).

## Reviewer metadata
- Reviewer subagent: `code-reviewer` (model `opencode/deepseek-v4.1-flash-free`)
- Round: 4
- Note: the agent configuration at `.opencode/agents/code-reviewer.md` names the model `opencode/deepseek-v4-flash-free`, which the provider reports as unavailable ("Model unavailable"); the review was therefore invoked with the available `opencode/deepseek-v4.1-flash-free` model.
