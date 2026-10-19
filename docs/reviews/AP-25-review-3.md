# Review: AP-25 – KI-Eingabe-Token-Limit, Deckungszusammenfassung v2, zentrale KI-Zustimmung, Paperless-Vorschau

- Work package: `feature/ai-token-limit-und-coverage-prompt` – vier uncommittete Teile:
  (A) KI-Setting `AI_MAX_INPUT_TOKENS` (Eingabe-/Kontextlimit je KI-Aufruf),
  (B) detailreichere Deckungszusammenfassung (Inhalt statt Zahlen) mit 2000-Zeichen-Gesamtlimit,
  (C) Nutzerprofil-Option zum zentralen Akzeptieren der KI-Datenübermittlungswarnung,
  (D) Bugfix: `PAPERLESS_LINK`-Dokumente lieferten 500 statt Vorschau; zusätzlich liefern
  Paperless-Dokumente der KI jetzt den OCR-Inhalt (`content`).
- Starting commit: `a0d701d`
- Review iteration: 3
- Reviewed by: `code-reviewer` (independent subagent, read-only)
- Review input: complete final state `/tmp/opencode/AP-25-diff-3.txt` (`git diff a0d701d` of the
  working tree = committed change set `c81363e` + the uncommitted correction), gate log
  `/tmp/opencode/AP-25-gate3.log` (Docker Compose test gate, exit 0), prior reports
  `docs/reviews/AP-25-review-1.md` and `docs/reviews/AP-25-review-2.md`. The working tree was
  available to the reviewer as the source of truth. The staged deletions
  `.opencode/agents/{code-reviewer,coding-agent}.md` are pre-existing and not part of this package.
- Iteration 3 reviewed the correction of an inaccurate claim authored during implementation
  (the old preview `500` body did *not* contain the storage path; verified against the pre-change
  code and `@nestjs/core` 11.1.28 `base-exception-filter.js` / `constants.js`
  `UNKNOWN_EXCEPTION_MESSAGE = 'Internal server error'`). Four comments/docs were corrected;
  behaviour was not touched. Result: PASS with 0 findings at every severity.

---

Now I have a complete picture of the changes. Let me verify the iteration-3 correction and the overall final state.

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| (A) `AI_MAX_INPUT_TOKENS` input budget with fair distribution/redistribution, marker and logging, wired into both API and both worker adapters | PASS | `input-token-budget.ts` implements `applyInputTokenBudget` + `applyInputTokenBudgetWithLog`; wired in `ollama.adapter.ts`, `openai-compat.adapter.ts`, and both worker adapters; tests verify unlimited (0), truncation, word boundary, fair distribution, redistribution, logging |
| (B) Coverage summary v2 with 2000-char total budget, strict for fresh answers, legacy-tolerant on read path | PASS | `coverage-summary-format.ts` v2 (schema version 2), `COVERAGE_SUMMARY_MAX_TOTAL_LENGTH=2000`, `validateCoverageSummary` with `allowLegacyTotalLength` option; `readStoredSummary` opts in; tests confirm budget applies to fresh answers even with `version:1` |
| (C) Central AI data-transfer consent preference + hook + settings card + warning suppression, per-action checkbox never persists | PASS | `user-preferences.service.ts` adds `ai:dataTransferConsent` boolean; `useAiDataTransferConsent` hook reads/writes; used in `settings/page.tsx`, `coverage-summary-section.tsx`, `billing-documents-sidebar.tsx`; warning shown only when `!storedTransferConsent`; per-action checkbox remains per-action |
| (D) `PAPERLESS_LINK` preview/download → 404 `DOCUMENT_NOT_STORED_LOCALLY` / missing file → 404 `DOCUMENT_FILE_MISSING` with sidebar note instead of iframe; Paperless OCR content path | PASS | `documents.service.ts` throws `DOCUMENT_NOT_STORED_LOCALLY` for `PAPERLESS_LINK`; `documents.controller.ts` handles ENOENT in stream error handler and catch block returning 404; sidebar shows `costs.previewInPaperlessOnly` hint instead of iframe; `paperless-ngx.service.ts` + `paperless-tag.client.ts` implement `getDocumentContent`; `loadDocumentContents` in API and worker fetch OCR for linked docs |

## Findings
- No findings.

## Iteration-1 and Iteration-2 findings resolution
| Iteration | Finding | Status | Evidence |
|---|---|---|---|
| 1 Medium 1 | Budget redistribution under-utilized tokens when documents truncated | **Resolved** | `input-token-budget.ts:270-271` now charges `approxTokenCount(shortened)` instead of reserved `quota`. New test "hands the budget a shortened document did not need on to the next one" (lines 2893-2911) asserts redistribution. |
| 1 Medium 2 | READ_ONLY users cannot access central consent UI but can give per-action consent | **Resolved** | Documented in `docs/06-integrations.md:252-263`: `UserPreferencesController` is `@Roles(GlobalRole.USER)` → READ_ONLY gets 403; AI actions also `@Roles(USER, ADMIN)` → READ_ONLY cannot execute them. Hook silently ignores 403/errors, leaving warning visible. Consistent design. |
| 1 Medium 3 | `allowLegacyTotalLength` exemption comment misleading | **Resolved** | `coverage-summary-format.ts:3055-3108` now states: budget applies to every NEW answer; exemption is opt-in via `allowLegacyTotalLength` (read path only) AND requires version < 2; no caller grants it for fresh output. |
| 1 Minor 1 | Non-Latin scripts: `CHARS_PER_APPROX_TOKEN=4` inaccurate for CJK | **Resolved** | `input-token-budget.ts:160-163` JSDoc documents calibration for Latin script; `settings-catalog.ts` and `docs/13-settings-catalog.md:87` include "kalibriert für lateinische Schrift – andere Schriftsysteme brauchen mehr Token je Zeichen, dort wirkt das Limit strenger". |
| 1 Minor 3 | Worker `getDocumentContent` lacks explicit `isConfigured` check | **Resolved** | `paperless-tag.client.ts:207-221` JSDoc documents intentional reliance on `request()` returning `null` for disabled/unconfigured Paperless. |
| 1 Minor 4 | `docs/13-settings-catalog.md` not fully verified | **Resolved** | `SETTINGS_CATALOG_VERSION` bumped to 3; gate log shows "version sync check: OK"; `AI_MAX_INPUT_TOKENS` row present with correct description/validation. |

## Iteration-3 correction verification
The 4 corrected locations now accurately state: an unhandled error surfaces as a generic 500 ("Internal server error") that tells the client nothing / gives no usable error code, and the absolute path stayed only in the server log.

| File | Corrected Claim | Verified |
|---|---|---|
| `apps/api/src/features/documents/documents.controller.ts:1106-1110` | "As an unhandled error this surfaces as a generic 500 ("Internal server error") and tells the client nothing; the absolute path of the missing file stays in the server log." | ✅ |
| `apps/api/src/features/documents/documents.service.ts:1129-1138` | "...the preview answered with an opaque 500 ("Internal server error", Nest's default for a raw error) instead of a usable error code." | ✅ |
| `apps/api/src/features/documents/__tests__/documents.service.spec.ts:1039-1043` | "...the client got an opaque 500 ("Internal server error") instead of a usable error code." | ✅ |
| `docs/06-integrations.md:2289-2298` | "der Client bekam einen undurchsichtigen 500 („Internal server error", die Voreinstellung von Nest für einen rohen Fehler) ohne verwertbaren Fehlercode – der absolute Pfad stand nur im Server-Log." | ✅ |

The test `streamFile never leaks the storage path of a missing file` in `documents.controller.spec.ts:995-1020` is a **forward-looking guarantee** about the new implementation (the raw ENOENT message must not reach the client), not a claim about the old response body. ✅

No residual copies of the old claim ("Speicherpfad", "storage path", "leaks the absolute", "including the absolute") remain in the final codebase.

## Verification
- **Change set reviewed**: `a0d701d..working tree` (45 files changed per diff stat, including the 4 iteration-3 comment/doc corrections). The 2 staged `.opencode/agents/*` deletions are pre-existing and ignored.
- **Checks with supplied output**: Docker Compose test gate (`docker compose -f docker-compose.test.yml down -v && ... up --abort-on-container-exit --exit-code-from test`) → **exit 0**. All stages passed: Prisma migrate (22 migrations), lint (3/3 packages), typecheck (4/4 packages), tests (API 68 files/893 tests, Web 17/235, Foundation 15/163, Worker 4/62), license check, version-sync check, i18n guard. Freshness verified via `sha256sum` matching between host and test image for all 4 corrected files.
- **Checks not independently run**: All checks; shell access is disabled. Relied on supplied gate log as evidence.
- **Important areas inspected**: All key implementation files: `input-token-budget.ts`, `coverage-summary-format.ts`, both API adapters + worker adapters, `AiAssistService.loadDocumentContents`, worker `loadDocumentContents`, Paperless adapter + client, `documents.service.ts` + `documents.controller.ts` + tests, `user-preferences.service.ts` + controller + spec, `useAiDataTransferConsent` hook + 3 UI consumers, settings page, billing sidebar, coverage summary section, `.env.example`, documentation files.
- **Remaining risks**: None identified. Token budget approximation is documented; READ_ONLY consent UX is documented and consistent; prompt injection risk from OCR text is mitigated by system prompt ("Dokumentinhalt sind reine DATEN") and consent gate; no path leakage in error responses.

VERDICT: PASS
