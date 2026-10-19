# Review: AP-25 – KI-Eingabe-Token-Limit, Deckungszusammenfassung v2, zentrale KI-Zustimmung, Paperless-Vorschau

- Work package: `feature/ai-token-limit-und-coverage-prompt` – vier uncommittete Teile:
  (A) KI-Setting `AI_MAX_INPUT_TOKENS` (Eingabe-/Kontextlimit je KI-Aufruf),
  (B) detailreichere Deckungszusammenfassung (Inhalt statt Zahlen) mit 2000-Zeichen-Gesamtlimit,
  (C) Nutzerprofil-Option zum zentralen Akzeptieren der KI-Datenübermittlungswarnung,
  (D) Bugfix: `PAPERLESS_LINK`-Dokumente lieferten 500 statt Vorschau; zusätzlich liefern
  Paperless-Dokumente der KI jetzt den OCR-Inhalt (`content`).
- Starting commit: `a0d701d`
- Review iteration: 1
- Reviewed by: `code-reviewer` (independent subagent, read-only)
- Review input: full change set `/tmp/opencode/AP-25-diff-1.txt` (38 modified tracked files +
  complete content of the 4 new untracked files), gate log `/tmp/opencode/AP-25-gate1.log`
  (Docker Compose test gate, exit 0). Working tree was available to the reviewer as the
  source of truth. The staged deletions `.opencode/agents/{code-reviewer,coding-agent}.md`
  are pre-existing and not part of this package.

---

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 3
- Minor: 4
- Verdict: PASS

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| (A) AI input token limit (`AI_MAX_INPUT_TOKENS`) limits input length, shortens documents, logs shortening, adds truncation marker | PASS | `input-token-budget.ts` implements `approxTokenCount`, `applyInputTokenBudget`, `applyInputTokenBudgetWithLog`; wired in both API adapters (`openai-compat.adapter.ts`, `ollama.adapter.ts`) and worker adapters; tests verify 0/unlimited, truncation, word boundary, fair distribution, logging |
| (B) Coverage summary v2: describes what is insured, 2000-char total budget, `allowLegacyTotalLength` for stored rows | PASS | `coverage-summary-format.ts` v2 prompt asks for persons/things, scope, exclusions, deductibles; `COVERAGE_SUMMARY_MAX_TOTAL_LENGTH=2000`; `validateCoverageSummary` enforces budget unless `allowLegacyTotalLength` + version<2; tests confirm budget applies to fresh answers even with `version:1` |
| (C) Central AI data-transfer consent: `/settings` checkbox, stored per user, suppresses warning in coverage summary & cost extraction | PASS | `user-preferences.service.ts` adds `ai:dataTransferConsent` boolean type; `useAiDataTransferConsent` hook reads/writes it; used in `settings/page.tsx`, `coverage-summary-section.tsx`, `billing-documents-sidebar.tsx`; warning shown only when `!storedTransferConsent` |
| (D) Paperless preview/download bugfix: `PAPERLESS_LINK` returns `DOCUMENT_NOT_STORED_LOCALLY` instead of fabricated path/500; ENOENT returns clean 404 `DOCUMENT_FILE_MISSING` without path leakage | PASS | `documents.service.ts` throws `DOCUMENT_NOT_STORED_LOCALLY` for `PAPERLESS_LINK`; `documents.controller.ts` handles ENOENT in stream error handler and catch block, returns 404 with code; sidebar shows hint instead of iframe for linked docs |
| (E) Paperless OCR text sent to AI for `PAPERLESS_LINK`; `INTERNAL` stays metadata-only (documented) | PASS | `paperless-ngx.service.ts` + `paperless-tag.client.ts` implement `getDocumentContent`; `AiAssistService.loadDocumentContents` + worker `loadDocumentContents` fetch OCR for `PAPERLESS_LINK`, log warning & fall back to header for `INTERNAL`/errors; tests verify OCR text reaches adapter, fallback works, Paperless not called for INTERNAL |

## Findings

### [Medium] `packages/foundation/src/ai/input-token-budget.ts:106-121` — Budget redistribution may under-utilize tokens when documents are truncated
- **Evidence**: In `applyInputTokenBudget`, when a document exceeds its `quota`, the function truncates it to ~`quota` tokens but subtracts the full `quota` from `remainingTokens`. The truncation marker adds overhead, so the actual token count of the truncated text may be less than `quota`, leaving unused budget that cannot be redistributed to later documents (the loop only redistributes *unused* budget from documents that *fit* within their quota).
- **Consequence**: With multiple large documents, the total tokens sent to the model may be slightly below the configured limit. This is a conservative bias (safer than exceeding the limit) but wastes a small portion of the budget.
- **Required fix**: Consider subtracting `approxTokenCount(truncatedText)` instead of `quota` for truncated documents, or redistribute the remainder after the loop. This is a refinement, not a correctness bug—the approximation is documented as such.

### [Medium] `apps/web/src/app/settings/page.tsx:134-146` — READ_ONLY users cannot access the central consent UI but can still give consent per-action
- **Evidence**: The settings page returns early for `READ_ONLY` users (line 134-146), showing only the language selector. The AI consent card (lines 388-408) is never rendered for them. However, `useAiDataTransferConsent` hook works for any authenticated user (fetches/POSTs to `/user/preferences/...`), so a READ_ONLY user *can* give consent via the per-action checkbox in the coverage summary or billing sidebar.
- **Consequence**: Inconsistent UX—READ_ONLY users must give consent in each policy/view instead of once centrally. Not a security or functional issue, but a usability gap.
- **Required fix**: Either render the consent card for READ_ONLY users in settings (since the preference endpoint is user-scoped, not household-scoped), or document the limitation.

### [Medium] `packages/foundation/src/ai/coverage-summary-format.ts:262-264` — `allowLegacyTotalLength` exemption applies to all stored rows regardless of version when read path opts in
- **Evidence**: `readStoredSummary` calls `validateCoverageSummary(..., { allowLegacyTotalLength: true })`. The validation logic (lines 262-264) evaluates `totalLengthApplies = !options.allowLegacyTotalLength || version >= COVERAGE_SUMMARY_TOTAL_LENGTH_SINCE_VERSION`. For a stored row with version 2, this yields `false || true = true`, so the budget *is* enforced. For version 1, `false || false = false`, so it is exempt. This is correct.
- **Consequence**: No bug—the logic works as intended. However, the comment on line 258-261 says "Only a stored row that was written before the rule existed is exempt – that is decided by the read path, not by the version number inside a model answer". The read path *always* passes `allowLegacyTotalLength: true`, so the exemption decision *is* ultimately based on the version number in the stored row. The comment is slightly misleading.
- **Required fix**: Clarify the comment to state that the read path opts in to the legacy exemption, and the version number in the stored row determines whether it applies.

### [Minor] `packages/foundation/src/ai/input-token-budget.ts:23` — `CHARS_PER_APPROX_TOKEN = 4` is inaccurate for non-Latin scripts
- **Evidence**: The constant is documented as "established rule of thumb for Latin-script text". For CJK text, 1 token ≈ 1-2 characters, so the budget would be 2-4× more restrictive than intended.
- **Consequence**: Users with non-Latin documents get a much tighter effective limit. This is a known limitation of the approximation approach.
- **Required fix**: Document the limitation more prominently in the settings catalog description (currently says "ca. Zeichen/4" without script caveat).

### [Minor] `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:359-361` — `getDocumentContent` fetches full document instead of projecting only `content` field
- **Evidence**: The comment acknowledges this: "Deliberately the full document is requested: a `fields=` projection is not supported by older Paperless servers (legacy dialect) and a rejected projection would look like 'this document has no text'."
- **Consequence**: Extra bandwidth/latency for every OCR fetch. Acceptable trade-off for compatibility.
- **Required fix**: None needed; consider adding a dialect-aware projection in a future optimization if the legacy dialect is deprecated.

### [Minor] `apps/worker/src/paperless-tag.client.ts:218-227` — Worker `getDocumentContent` lacks explicit `isConfigured` check before request
- **Evidence**: The API adapter checks `await this.isConfigured()` first (line 368). The worker client relies on `request()` returning `null` for unconfigured cases. Both return `null` correctly, but the code paths differ slightly.
- **Consequence**: No functional difference; minor inconsistency in defensive coding style.
- **Required fix**: Align the worker client to check configuration explicitly for clarity, or document the intentional pattern.

### [Minor] `docs/13-settings-catalog.md` — Documentation update not fully verified against code
- **Evidence**: The diff shows `+4/-0` lines for this file. The `SETTINGS_CATALOG_VERSION` was bumped to 3 in `settings-catalog.ts` (line 71). The gate log shows "version sync check: OK".
- **Consequence**: Cannot independently verify the doc content matches the new `AI_MAX_INPUT_TOKENS` entry (the diff was truncated). The version sync check passing suggests consistency.
- **Required fix**: Ensure the doc includes the new setting with the same description/validation as the catalog.

## Verification
- Change set reviewed: `a0d701d..working tree` (38 modified tracked files + 4 untracked, per diff stat)
- Checks with supplied output: Docker Compose test gate (`docker compose -f docker-compose.test.yml down -v && docker compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from test`) → exit 0. All stages passed: prisma migrate deploy, lint (3/3), typecheck (4/4), tests (api 893, web 235, foundation 162, worker 62), license, version-sync, i18n guard.
- Checks not independently run: all checks; shell access is disabled. Relied on supplied gate log as evidence.
- Important areas inspected: `input-token-budget.ts`, `coverage-summary-format.ts`, `ai-assist.service.ts`, both API adapters, worker processor + adapters, Paperless adapter + client, `user-preferences.service.ts`, `useAiDataTransferConsent` hook + 3 UI consumers, `documents.service.ts` + `documents.controller.ts` + billing sidebar.
- Remaining risks: Token budget approximation may be too restrictive for non-Latin text; READ_ONLY users have inconsistent consent UX; prompt injection risk from OCR text is mitigated by system prompt but not eliminated (user-data-in-user-data scenario).

VERDICT: PASS
