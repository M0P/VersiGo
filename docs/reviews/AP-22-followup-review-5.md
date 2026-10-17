# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 5
- Verdict: PASS

## Findings

- [Minor] `apps/web/src/app/policies/[id]/paperless-tag-section.tsx:418-423` — the new minimum-length explanation duplicates the field hint that is already rendered above it
  - Evidence: the search input already carries `hint={t('policies.paperlessTagSearchHint')}` (`:397`), which `FormField` always renders as `<span class="form-hint">` (and links via `aria-describedby`). The paragraph added by this delta prints the **same** key directly below it, so after typing exactly one character the identical sentence ("Mindestens 2 Zeichen eingeben…") appears twice in a row. The round-4 premise that this state was "completely silent" was already covered by the static hint.
  - Required fix: drop the extra paragraph (the field hint states the minimum), or use a distinct, differently-styled message key instead of re-rendering `paperlessTagSearchHint`.

- [Minor] `docs/06-integrations.md:40-43` — the contract sentence "Jede Fehlerantwort enthält eines dieser stabilen Präfixe" over-claims
  - Evidence: the two endpoints named there are guarded by `HouseholdMembershipGuard`/`@Roles` and validated by `SearchPaperlessTagsQueryDto`/`CreatePaperlessTagDto`. Their failure responses therefore also include `403` (`ForbiddenException('Isolation: no access to a foreign household')`, `paperless-tag.service.ts:115`), `401` from the auth guard, and `400` with `message: string[]` from DTO validation — none of which carry a `PAPERLESS_*` prefix. An integrator relying on "every error carries a prefix" would mis-parse those bodies (the web mapper itself only falls back to a generic key for them).
  - Required fix: scope the statement to tag/Paperless failures (for example "Jede Antwort, die einen Paperless- oder Tag-Fehler meldet, enthält …") and note that guard/validation errors keep the standard Nest shape.

- [Minor] `docs/06-integrations.md:44-45` — the `PAPERLESS_NOT_CONFIGURED` → `503` documentation omits one of the three trigger conditions
  - Evidence: the code path is `isConfigured()` = `enabled && baseUrl.length > 0 && apiToken.length > 0` (`paperless-ngx.service.ts:127-130`) and the emitted message itself says "(enabled, URL and API token are required)", but the doc lists only "deaktiviert oder die Basis-URL fehlt". An operator with `PAPERLESS_ENABLED=true`, a URL but no token would not recognise their state.
  - Required fix: add the missing/empty `PAPERLESS_API_TOKEN` case to the `503` bullet.

- [Minor] `docs/06-integrations.md:58-59` with `apps/api/src/features/paperless-ngx/paperless-tag.service.ts:248-250` — the same code `PAPERLESS_NOT_CONFIGURED` maps to `503` on `GET/POST .../paperless-tags` but `502` on `PUT .../paperless-tag`
  - Evidence: `tagRequestException` emits `ServiceUnavailableException` (503) for `NOT_CONFIGURED`, while `setTag` still throws `new BadGatewayException('PAPERLESS_NOT_CONFIGURED')` (502); the doc block records the divergence instead of reconciling it. Any client that maps codes/statuses generically (or a future caller) must special-case the same cause by endpoint.
  - Required fix: either route `setTag`'s `NOT_CONFIGURED` through the same 503 mapping, or add one sentence in the contract stating explicitly why the `PUT` case intentionally stays `502`.

- [Minor] `docs/end-user-guide.md:191` — the new troubleshooting row quotes a UI string the change removed from the UI
  - Evidence: the symptom text *"the tag could not be created in Paperless"* is the raw English API message; the web layer now always translates the code (`paperless-tag-error.ts` + `paperlessTagErrorREJECTED`), so a user will never see that string — in German they see "Paperless-ngx hat die Anfrage abgelehnt.", or one of the four specific causes.
  - Required fix: describe the symptom as it now appears (for example "Tag-Suche ohne Treffer oder Anlage mit einer der Ursachen-Meldungen") and keep the check-list unchanged, so the guide matches the shipped messages.

## Verification
- Read the full `-w` diff (20 files) and the changed sources directly: `paperless-ngx.interface.ts`, `paperless-ngx.service.ts` (100-170, 440-700), `paperless-tag.service.ts` (all), `paperless-tag.controller.ts`, `dto/paperless-tag.dto.ts`, `paperless-tag-section.tsx`, `documents-tab.tsx`, `page.tsx`, `edit/page.tsx`, `lib/paperless-tag-error.ts`, both locales, the four docs, plus `components/ui/form-field.tsx` and `apps/web/src/app/policies/[id]/edit/page.tsx` for the duplication/role context.
- Round-4 delta confirmed in code, not just claimed: doc `items` fix (`06-integrations.md:54`), idempotent `DELETE` (`:62-64`), `searchSeq` bump in the early return (`paperless-tag-section.tsx:115`), the min-length paragraph (`:418-423`), `AUTH_FAILED → BadGatewayException` for search **and** create (`paperless-tag.service.spec.ts:140-145,194-199`), and DTO `@Transform` trim (`dto/paperless-tag.dto.ts:27`) with `transform: true` verified in `apps/api/src/main.ts:19-22` (so the trim is effective in production, not only under the unit test's `plainToInstance`).
- Correctness/regression checks: `searchTags`/`createTag` have no production caller besides `PaperlessTagService`; the worker keeps its own client; `docs`-only changes for the tab move; `DocumentsTab` has exactly one caller, updated with the new `insurerName` prop (`policy.insurerName` is already non-null at that point, `page.tsx:235`). Mapper/code-sync guard now pins both directions (sorted `toEqual`) and both quote styles; the seven emitted codes match `PAPERLESS_TAG_ERROR_CODES`. No token/secret appears in any new message or log; roles/guards on the touched endpoints are unchanged.
- Not verifiable here (as stated in the handover): no browser/e2e/accessibility harness, so the tab move, the 403-button visibility and the "hint appears twice" rendering were assessed by source reading only. Docker Compose test run and host `tsc` were taken as reported, not re-executed.
- Residual risk (pre-existing, unchanged): a `200` tag answer whose hits are dropped only by the client-side re-filter still renders "Kein passender Tag gefunden."; a `201` without a usable body is reported as `UNREACHABLE` (documented as "unbrauchbare Antwort", self-heals on retry via the idempotent pre-check).

TOTAL: 0 Critical / 0 High / 0 Medium / 5 Minor
