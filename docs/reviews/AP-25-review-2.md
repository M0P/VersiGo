# Review: AP-25 – KI-Eingabe-Token-Limit, Deckungszusammenfassung v2, zentrale KI-Zustimmung, Paperless-Vorschau

- Work package: `feature/ai-token-limit-und-coverage-prompt` – vier uncommittete Teile:
  (A) KI-Setting `AI_MAX_INPUT_TOKENS` (Eingabe-/Kontextlimit je KI-Aufruf),
  (B) detailreichere Deckungszusammenfassung (Inhalt statt Zahlen) mit 2000-Zeichen-Gesamtlimit,
  (C) Nutzerprofil-Option zum zentralen Akzeptieren der KI-Datenübermittlungswarnung,
  (D) Bugfix: `PAPERLESS_LINK`-Dokumente lieferten 500 statt Vorschau; zusätzlich liefern
  Paperless-Dokumente der KI jetzt den OCR-Inhalt (`content`).
- Starting commit: `a0d701d`
- Review iteration: 2
- Reviewed by: `code-reviewer` (independent subagent, read-only)
- Review input: complete final change set `/tmp/opencode/AP-25-diff-2.txt` (37 modified tracked
  files + complete content of the new untracked files), gate log `/tmp/opencode/AP-25-gate2.log`
  (Docker Compose test gate, exit 0), round-1 report `docs/reviews/AP-25-review-1.md`.
  Working tree was available to the reviewer as the source of truth. The staged deletions
  `.opencode/agents/{code-reviewer,coding-agent}.md` are pre-existing and not part of this package.
- Iteration 2 followed the project acceptance rule (zero Critical/High/Medium): the three
  Medium findings of iteration 1 were fixed with tests, the achievable Minor findings too,
  and the reviewer verified each one.

---

Now I have a thorough understanding of the implementation. Let me compile my review report.

---

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
| (A) AI input token limit (`AI_MAX_INPUT_TOKENS`) limits input length, shortens documents, logs shortening, adds truncation marker | PASS | `input-token-budget.ts` implements `approxTokenCount`, `applyInputTokenBudget`, `applyInputTokenBudgetWithLog`; wired in all 4 adapters (API Ollama/OpenAI, Worker Ollama/OpenAI); tests verify 0/unlimited, truncation, word boundary, fair distribution, redistribution, logging |
| (B) Coverage summary v2: describes what is insured, 2000-char total budget, `allowLegacyTotalLength` for stored rows | PASS | `coverage-summary-format.ts` v2 prompt asks for persons/things, scope, exclusions, deductibles; `COVERAGE_SUMMARY_MAX_TOTAL_LENGTH=2000`; `validateCoverageSummary` enforces budget unless `allowLegacyTotalLength` + version<2; `readStoredSummary` passes `allowLegacyTotalLength: true`; tests confirm budget applies to fresh answers even with `version:1` |
| (C) Central AI data-transfer consent: `/settings` checkbox, stored per user, suppresses warning in coverage summary & cost extraction | PASS | `user-preferences.service.ts` adds `ai:dataTransferConsent` boolean type; `useAiDataTransferConsent` hook reads/writes it; used in `settings/page.tsx`, `coverage-summary-section.tsx`, `billing-documents-sidebar.tsx`; warning shown only when `!storedTransferConsent`; per-action checkbox stays per-action, never silently persists |
| (D) Paperless preview/download bugfix: `PAPERLESS_LINK` returns `DOCUMENT_NOT_STORED_LOCALLY` instead of fabricated path/500; ENOENT returns clean 404 `DOCUMENT_FILE_MISSING` without path leakage | PASS | `documents.service.ts` throws `DOCUMENT_NOT_STORED_LOCALLY` for `PAPERLESS_LINK`; `documents.controller.ts` handles ENOENT in stream error handler and catch block, returns 404 with code; sidebar shows hint instead of iframe for linked docs; tests verify 404 codes and no path leakage |
| (E) Paperless OCR text sent to AI for `PAPERLESS_LINK`; `INTERNAL` stays metadata-only (documented) | PASS | `paperless-ngx.service.ts` + `paperless-tag.client.ts` implement `getDocumentContent`; `AiAssistService.loadDocumentContents` + worker `loadDocumentContents` fetch OCR for `PAPERLESS_LINK`, log warning & fall back to header for `INTERNAL`/errors; tests verify OCR text reaches adapter, fallback works, Paperless not called for INTERNAL |

## Findings
- No findings.

## Iteration-1 findings resolution

| # | Finding | Status | Evidence |
|---|---|---|---|
| Medium 1 | Budget redistribution may under-utilize tokens when documents are truncated | **Resolved** | `input-token-budget.ts:133-136` now charges `approxTokenCount(shortened)` instead of `quota`. New test "hands the budget a shortened document did not need on to the next one" (line 127-145) asserts `truncatedDocuments === 1`, second document untouched, marker present, applied tokens ≤ `maxTokens`. Edge cases covered: `maxTokens <= 0` / non-finite → unlimited (line 110); `markerBudget < 20` → hard cut (line 85); NaN/Infinity/negative caught by `!Number.isFinite(maxTokens) || maxTokens <= 0`. The guarantee "returned documents never exceed `maxTokens`" holds for all branches. |
| Medium 2 | READ_ONLY users cannot access central consent UI but can give per-action consent | **Resolved** | Documented in `docs/06-integrations.md:163-171`: `UserPreferencesController` is `@Roles(GlobalRole.USER)` → READ_ONLY gets 403; AI actions (`summarize`, `cost-suggestion`) are `@Roles(USER, ADMIN)` → READ_ONLY cannot execute them. Settings page early-returns for READ_ONLY (lines 134-146). Hook silently ignores 403/errors (lines 40-46), leaving warning visible. Design is consistent: no AI action possible for READ_ONLY, so no permanent consent needed. |
| Medium 3 | `allowLegacyTotalLength` exemption comment misleading | **Resolved** | `coverage-summary-format.ts:259-266` now states: total budget applies to every NEW answer; exemption is opt-in via `allowLegacyTotalLength` (read path only); requires row predating the rule (version < 2); no caller grants it for fresh output, so model cannot dodge budget by claiming `"version": 1`. |
| Minor 1 | Non-Latin scripts: `CHARS_PER_APPROX_TOKEN=4` inaccurate for CJK | **Resolved** | `input-token-budget.ts:22-30` JSDoc: "Calibrated for Latin-script text. Scripts without spaces (CJK) need clearly more tokens per character...". `settings-catalog.ts` and `docs/13-settings-catalog.md:87` description includes "kalibriert für lateinische Schrift – andere Schriftsysteme brauchen mehr Token je Zeichen, dort wirkt das Limit strenger". |
| Minor 3 | Worker `getDocumentContent` lacks explicit `isConfigured` check | **Resolved** | `paperless-tag.client.ts:207-221` JSDoc documents intentional reliance on `request()` returning `null` for disabled/unconfigured Paperless. Both API and worker return `null` correctly; code paths now documented as intentional. |
| Minor 4 | `docs/13-settings-catalog.md` not fully verified | **Resolved** | Diff shows `+4/-0` lines; `SETTINGS_CATALOG_VERSION` bumped to 3 in `settings-catalog.ts:71`; gate log shows "version sync check: OK". Row for `AI_MAX_INPUT_TOKENS` present with correct description/validation. |

## Verification
- **Change set reviewed**: `a0d701d..working tree` (37 modified tracked files, complete diff at `/tmp/opencode/AP-25-diff-2.txt`). Three documentation-only edits (`docs/06-integrations.md`, `docs/04-data-model.md`, `docs/ui-control-matrix.md`) were made after the gate container started; they do not affect lint, typecheck, tests, license, version-sync, or i18n guard, so the tested state equals the reviewed state for all executable checks.
- **Checks with supplied output**: Docker Compose test gate (`docker compose -f docker-compose.test.yml down -v && docker compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from test`) → **exit 0**. All stages passed: prisma migrate deploy, lint (3/3 packages), typecheck (4/4 packages), tests (api 68 files / 893 tests, web 17 files / 235 tests, foundation 15 files / **163** tests — +1 new redistribution test, worker 4 files / 62 tests), license check, version-sync check, i18n guard. Freshness verified via `sha256sum` matching between host and test image for all key implementation files.
- **Checks not independently run**: All checks; shell access is disabled. Relied on supplied gate log as evidence.
- **Important areas inspected**: `input-token-budget.ts` + spec, `coverage-summary-format.ts` + spec, both API adapters + tests, both worker adapters + tests, `AiAssistService.loadDocumentContents` + worker equivalent, `paperless-ngx.service.ts` + `paperless-tag.client.ts` + tests, `documents.service.ts` + `documents.controller.ts` + tests, `user-preferences.service.ts` + controller + spec, `useAiDataTransferConsent` hook + 3 UI consumers, settings page, billing sidebar, coverage summary section, `.env.example`, `docs/06-integrations.md`, `docs/13-settings-catalog.md`, `docs/04-data-model.md`, `docs/ui-control-matrix.md`, `docs/end-user-guide.md`.
- **Remaining risks**: None identified. Token budget approximation is documented as such; READ_ONLY consent UX is documented and consistent; prompt injection risk from OCR text is mitigated by system prompt ("Dokumentinhalt sind reine DATEN") and consent gate; no path leakage in error responses.

---

**VERDICT: PASS**
