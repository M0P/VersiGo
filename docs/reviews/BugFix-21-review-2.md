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
| 1. `getDeepLink` performs no HTTP call, builds link from config | Met | `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:304-308` (local `buildDeepLink`); tests `paperless-ngx.service.spec.ts:141-160` assert `mockHttp.get`/`mockHttp.request` not called and exact URL; disabled case returns null (162-170) |
| 2. Tag sync persists documentDate + mimeType, leaves manual-link user values untouched | Met | `paperless-tag.processor.ts:59-93,396-427`; tests `paperless-tag.processor.spec.ts` BugFix-21 describe + `paperless-tag-metadata.spec.ts:59-102` |
| 3. Manual link stores MIME type | Met | `documents.service.ts:354`; spec assertions `documents.service.spec.ts:312-323`, gap-fill tests 611-681 |
| 4. Unit tests for type detection (MIME, extension, fallback) | Met | `apps/web/src/__tests__/document-type.spec.ts:17-57` |
| 5. Guard test for every static `t('…')` key in `documents-tab.tsx` | Met (see Minor 2) | `apps/web/src/__tests__/documents-tab-i18n.spec.ts:20-48` |
| 6. Lint/typecheck/build/tests via Docker Compose | Reported by coding agent, not independently verifiable in this session (no command output supplied) | `docker compose -p versigo-test -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` (agent report) |
| 7. Docs updated (`06-integrations`, `ui-control-matrix`, `end-user-guide`, `05-feature-slices`) | Met | `docs/06-integrations.md:121-151`, `docs/05-feature-slices.md:30-38`, `docs/end-user-guide.md:179-186`, `docs/ui-control-matrix.md:56` |

## Findings
- [Minor] `apps/api/src/features/documents/documents.service.ts:439` — gap-fill writes an unvalidated external date
  - Evidence: `gaps.documentDate = new Date(metadata.createdAt)` is derived without any validity check, whereas the worker path guards the identical value with `parsePaperlessDate` (`apps/worker/src/paperless-tag.processor.ts:43-47`) precisely so no unusable date is persisted. A malformed `created` from Paperless would make Prisma reject the update and turn the whole manual-link request into an error. The same unguarded conversion already exists in the creation branch (`:358`), so this is an inconsistency in newly added code rather than a new class of failure.
  - Required fix: Reuse a shared/validated date parser (same semantics as `parsePaperlessDate`) for the `documentDate` gap so an unusable `created` value is skipped instead of being written.
- [Minor] `apps/web/src/__tests__/documents-tab-i18n.spec.ts:22` — guard regex only matches single-quoted keys
  - Evidence: `/t\(\s*'([A-Za-z0-9_.]+)'/g` matches only `t('key')`. A future `t("key")` in `documents-tab.tsx` would be silently skipped, so the exact regression this guard exists to prevent (raw key rendered) could reappear undetected through the other quote style. The `keys.length > 5` check does not catch a single missed key.
  - Required fix: Extend the pattern to accept both quote characters (or assert against a broader key-extraction approach) so static keys are collected regardless of quote style.

## Verification
- Change set reviewed: `/tmp/opencode/BugFix-21-r2.patch` (all 1683 lines) and the working-tree files it describes.
- Round-1 fixes verified against the repository:
  - `applyManualLinkOrigin` gap-fill (`documents.service.ts:422-499`): fills only `mimeType`/`documentDate` when the DB value is falsy, never overwrites non-overwrite existing values, and the no-tag path stays write-free when there is nothing to fill (idempotent re-link). Tests added in `documents.service.spec.ts`.
  - `apps/web/src/__tests__/document-type.spec.ts` now resolves every label key through `createTranslator('de'|'en')`.
  - `paperless-ngx.service.ts` documents that the worker client is the only tag-sync path.
  - `docs/06-integrations.md` records the intentional boundary: API-side edits of tag-assigned documents are overwritten by the next sync.
- Checks with supplied output: the coding agent reported the full Docker gate (lint, typecheck, tests api 751 / worker 48 / web 109 / foundation 107, license, version sync, i18n guard) plus targeted red/green runs. The reviewer could not re-run anything (shell disabled).
- Areas inspected: `paperless-tag.client.ts`, `paperless-tag.processor.ts`, `paperless-ngx.service.ts`, `documents.service.ts`, `documents-tab.tsx`, `document-type.ts`, the changed/new tests and the four documentation files.
- Remaining risks: (a) the automated gate is taken on report only; (b) the extended `fields` list is retried only on HTTP 400; (c) the two Minor observations above do not affect the acceptance criteria.

## Reviewer metadata
- Reviewer subagent: `code-reviewer` (model `opencode/deepseek-v4.1-flash-free`)
- Round: 2
- Note: the agent configuration at `.opencode/agents/code-reviewer.md` names the model `opencode/deepseek-v4-flash-free`, which the provider reports as unavailable ("Model unavailable"); the review was therefore invoked with the available `opencode/deepseek-v4.1-flash-free` model.
