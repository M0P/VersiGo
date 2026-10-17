# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 4
- Verdict: PASS

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| 1. `getDeepLink` performs no HTTP call and builds the link from configuration | Met (inspected) | `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:304-308` returns `buildDeepLink(id)` after `isConfigured()`; `isConfigured` only resolves settings, no dialect probe. `__tests__/paperless-ngx.service.spec.ts:141-160` stubs `mockHttp.get`/`request` and asserts `not.toHaveBeenCalled()`; the 404 case still returns the URL; disabled → `null` (spec 162-170) |
| 2. Tag sync persists document date + MIME type; user values of manual links untouched | Met (inspected) | `paperless-tag.processor.ts:59-93` (`deriveTagLinkMetadata`), `:367-380` (select metadata), `:400-425` (update/create with `documentDate`/`mimeType`); tests `paperless-tag-metadata.spec.ts` (7 cases) and `paperless-tag.processor.spec.ts` (metadata cases) |
| 3. Manual links store the fetched MIME type | Met for the create path; idempotent re-link gap noted below | `documents.service.ts:341` (create), `applyManualLinkOrigin` (dedup path) |
| 4. Web: type icon, document date, Paperless URL, no `uploadedAt`, single "Paperless-Dokument" | Met (inspected) | `apps/web/src/app/policies/[id]/documents-tab.tsx` (icon `:51-76`, metadata line `:561-588`), `apps/web/src/lib/document-type.ts`, `apps/web/src/components/ui/icons.tsx`, `apps/web/src/i18n/locales/{de,en}.ts`, tests `document-type.spec.ts`, `documents-tab-i18n.spec.ts` |
| 5. Worker requests `created`/`mime_type`, falls back to the minimal field list on HTTP 400 | Met (inspected) | `apps/worker/src/paperless-tag.client.ts` (`TAG_DOCUMENT_METADATA_FIELDS`, `TAG_DOCUMENT_MINIMAL_FIELDS`, fallback), `paperless-tag.client.spec.ts` |
| 6. Documentation updated | Met (inspected) | `docs/06-integrations.md`, `docs/ui-control-matrix.md`, `docs/end-user-guide.md`, `docs/05-feature-slices.md` |
| 7. Automated checks green | Reported by the author, not independently verifiable here | Full Docker gate reported: lint, typecheck, tests, license, version sync, i18n guard; shell is disabled for this review |

## Findings

- [Minor] `apps/worker/src/paperless-tag.processor.ts:63` — only `linkOriginManual` protects user values; an edit of a tag-assigned document is reverted by the next sync
  - Evidence: `deriveTagLinkMetadata` treats a row as automatically managed whenever `linkOriginManual` is false and then unconditionally refreshes `fileName`/`documentDate`/`mimeType`. `DocumentsService.updateMetadata` lets a user rename/re-date *any* document, including one that only carries `linkOriginTag`, without setting `linkOriginManual`. There is no UI editor for document metadata, so this is only reachable through the API (`PATCH …/documents/:id`).
  - Required fix: either persist a per-row "user-edited metadata" marker and gap-fill such rows too, or state in `docs/06-integrations.md` that API-side edits of automatically tag-assigned documents are intentionally reverted by the next sync.
- [Minor] `apps/api/src/features/documents/documents.service.ts:341` — re-linking an existing Paperless document discards the just-fetched MIME type
  - Evidence: `linkPaperlessDocument` fetches `getDocumentMetadata` (HTTP), but the idempotent branch (`applyManualLinkOrigin`) only writes `linkOriginManual`/`taggingStatus`; `mimeType` (and a missing `documentDate`) is written only in the create branch. Documents linked before BugFix-21 therefore keep `mimeType = NULL` until a tag sync runs – and if the policy has no configured tag, no sync will ever run, so the type icon falls back to the filename extension only.
  - Required fix: in the idempotent/`applyManualLinkOrigin` path, fill only NULL `mimeType`/`documentDate` from the already fetched metadata (never overwrite existing values), or document this limitation alongside the existing "Bekannte Grenze" note.
- [Minor] `apps/web/src/__tests__/document-type.spec.ts:65` — the icon's dynamic catalog keys are not verified against the catalogs
  - Evidence: the guard test `documents-tab-i18n.spec.ts` only collects *static* `t('…')` literals, but the new icon renders `t(documentTypeLabelKey(kind))` with keys defined in `document-type.ts`. `document-type.spec.ts` only asserts the key matches `/^policies\.documentTypeKind/`, so a typo or renamed key would render the raw key as the accessible name – exactly the failure mode this package fixes.
  - Required fix: add an assertion that `createTranslator('de')`/`createTranslator('en')` of `documentTypeLabelKey(kind)` never returns the key itself, for every `DocumentTypeKind`.
- [Minor] `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:665` — the parallel API-side `listDocumentsByTag` was left at `fields=id,title` and silently diverges from the documented sync contract
  - Evidence: the worker client now requests `id,title,created,mime_type`, while the API adapter still builds `fields=id,title` and `PaperlessTagDocumentRef` carries no `createdAt`/`mimeType`. A full-text search shows no production caller of the API-side method (only specs and adapter mocks), so this is currently dead but identical-looking code.
  - Required fix: either update the API-side method/interface to the same field set (or remove the unused method), or add a comment/doc line that the tag sync intentionally runs only through `PaperlessTagClient`.

## Verification
- Change set reviewed: all 20 files of `/tmp/opencode/BugFix-21.patch` (verified file-by-file against the working tree, including the two new web tests, `document-type.ts` and `paperless-tag-metadata.spec.ts`).
- Checks with supplied output: only the author's report of the full Docker gate (lint 3 packages, typecheck 4, tests api 751 / worker 48 / web 109 / foundation 107, license/version/i18n guards) plus the red/green runs of the new tests. The reviewer could not re-run anything (shell disabled; read-only review) and did not verify test counts or build output independently.
- Areas inspected: `paperless-tag.client.ts`, `paperless-tag.processor.ts`, `paperless-ngx.service.ts`/`.interface.ts`, `documents.service.ts`, `documents-tab.tsx`, `document-type.ts`, `icons.tsx`, `de.ts`/`en.ts`, all changed/new tests, `prisma/schema.prisma` (`documentDate`/`mimeType` exist, no migration needed), the four docs, and the `AGENTS.md` compose contract (no new env var, port, queue or dependency).
- Remaining risks: (a) the automated gate is taken on report only – no independent Docker/typecheck run was possible; (b) the extended `fields` list is only retried on HTTP 400 – a server that rejects it with another status is not covered; (c) the extended `fields` list behaviour against older Paperless releases is covered by unit tests only, not against a live instance.

## Reviewer metadata
- Reviewer subagent: `code-reviewer` (model `opencode/deepseek-v4.1-flash-free`)
- Round: 1
- Note: the agent configuration at `.opencode/agents/code-reviewer.md` names the model `opencode/deepseek-v4-flash-free`, which the provider reports as unavailable ("Model unavailable"); the review therefore had to be invoked with the available `opencode/deepseek-v4.1-flash-free` model.
