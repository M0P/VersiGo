# BugFix-22 – UI/UX: Dokumente, Stammdaten-Portallink, Kostenerhöhung, versicherte Personen/Objekte

Package number: **BugFix-22**
Branch: `fix/policy-delete-ui` (existing task branch)
Source: user report 2026-10-17 (five findings, verbatim below)

## User report (verbatim)

> weitere verbesserungen:
> Dokumente: Layout der maske muss grundlegend verbessert werden. link zu
> paperless als button ausreichend, nicht doppelt. Text für automatisch
> zuordnung nimm zu viel platz ein, evtl icon?
> Datum ist viel zu klein
> Sortieren nach datum und alphabetisch sollte möglich sein
>
> versicherung stammdaten: portallink entfernen, oder direkt in portal link
> maske übernehmen, aktuell inkonsistent
>
> erfassung kostenerhöhung:
> brutto betrag ist aktuell pflichtfeld -> änderin in brutto oder netto ist
> pflichtfeld eines ist ausreichend
>
> versichte personen:
> erweitern auf personen oder objekte (z.b. kft, haus)
> beziehung kein pflichtfeld mehr

## Scope

### A. Documents tab layout (`apps/web/src/app/policies/[id]/documents-tab.tsx`)

1. **Paperless link only once, as a button.** The deep-link URL text is removed
   from the metadata line; the "In Paperless öffnen" button remains (and is the
   only link to the document).
2. **Automatic assignment with an icon instead of text.** The text badge for the
   origin (`paperlessOriginAuto`/`Manual`/`Both`) and the "automatically managed"
   hint text are replaced by a compact icon badge with an accessible name
   (`role="img"` + `aria-label`, `title`). No information is lost – the label is
   still available to screen readers and on hover.
3. **Document date is too small.** The date gets its own line in the base font
   size (16 px) instead of being appended to the 12 px metadata line.
4. **Sorting.** A sort control (`policies.documentsSort`) offers
   "Datum – neueste zuerst" (default), "Datum – älteste zuerst",
   "Name – A bis Z" and "Name – Z bis A". Sorting is a pure, tested function.

### B. Master data: remove the duplicate portal link

5. The `insurerPortalUrl` field is removed from the master-data forms
   (`policies/new/page.tsx`, `policies/[id]/edit/page.tsx`) – the
   "Portal-Verknüpfungen" tab is the single place for a portal URL.
6. The value is **adopted into the portal-link mask**: when a portal link is
   created and the policy still carries a legacy `insurerPortalUrl`, the
   portal-link form is pre-filled with it (no data loss, no second field).
   The API contract keeps `insurerPortalUrl` (backward compatibility for
   existing rows and API clients) and is documented as legacy.

### C. Cost entry: gross **or** net is sufficient

6. `PolicyCostEntry.grossAmount` becomes nullable (`netAmount` already was).
   Validation: **at least one of `grossAmount`/`netAmount` is required** on
   create; an update must not clear both.
7. Cost calculations use the amount basis "gross if set, otherwise net"
   (period amount, annualisation, current cost of the policy). `null` values
   must never leak into sums, audit diffs or the privacy export.
6. The web form no longer marks "Bruttobetrag" as required, validates "at least
   one of gross/net" client-side and shows "—" for a missing amount.

### C. Insured persons → persons **or** objects

7. `CoveredPerson` gets a `subjectType` (`PERSON` | `OBJECT`, default `PERSON`)
   and `relationType` becomes optional (nullable). The UI offers
   "Art" (Person/Objekt), the relation is optional, the birth date is only
   offered for persons. The list shows the kind as an icon + accessible label.

## Acceptance criteria

- A document row renders exactly one Paperless link target and it is the
  "In Paperless öffnen" button; the deep-link URL text is gone.
- Origin/auto-managed information is rendered as an icon with an accessible
  name; the text badges take no space anymore.
- The document date is rendered at `--versigo-font-size-base`.
- The list can be sorted by date (desc default/asc) and by name (A–Z/Z–A) via a
  labelled control; sorting is covered by unit tests (null dates last, stable).
- `policies/new` and `policies/[id]/edit` no longer render an
  `insurerPortalUrl` input; creating a portal link pre-fills the portal URL from
  the policy's legacy `insurerPortalUrl` when it exists.
- `POST .../cost-entries` succeeds with only `netAmount` and with only
  `grossAmount`; with neither it returns 400. `PATCH` cannot clear both.
  Cost/period/annual calculations fall back to `netAmount` when `grossAmount`
  is `NULL`; privacy export and audit records stay serialisable.
- `POST .../covered-persons` works without `relationType` and with
  `subjectType: 'OBJECT'`; the relation is optional in the UI; the birth date is
  only offered for persons.
- Migration applies cleanly (`prisma migrate deploy`) and the migration matches
  `prisma/schema.prisma` (`prisma migrate diff` empty).
- Lint, typecheck, tests (api/web/worker/foundation) and the i18n guard pass in
  the Docker gate. New UI strings exist in both catalogs (de/en).
- Docs updated: `docs/04-data-model.md`, `docs/05-feature-slices.md`,
  `docs/06-integrations.md`, `docs/ui-control-matrix.md`,
  `docs/end-user-guide.md`.

## Decisions & non-goals

- No destructive migration: existing `insurerPortalUrl` values stay in the
  database (legacy, still returned by the API) and are picked up by the
  portal-link form as a default.
- No redesign of the whole documents tab beyond the items above (no table
  component, no pagination, no filtering).
- No browser/e2e/accessibility harness exists in the repository; the UI changes
  are verified by unit tests, type/build checks and source guards. This
  limitation is reported honestly.
- The API-side `listDocumentsByTag` divergence (BugFix-21) is untouched.

## Extension A (user request, 2026-10-17): AI functions unavailable

The user reported: **"KI-Funktionen sind nicht verfügbar. Der konfigurierte Provider antwortet nicht. openai-compat ist über die admin einstellungen konfiguriert und alle verbindungstests sagen HTTP 200: OK"**

This is addressed in the same BugFix-22 package:

- `OpenAiCompatAdapter.runtimeConfig()` no longer requires a non-empty API key (keyless OpenAI-compatible endpoints supported). `Authorization` header is only sent when a key exists.
- Detailed health check with secret-free reasons (`disabled`, `not-configured`, `unauthorized`, `timeout`, `unreachable`, `http-error`) via `healthStatus()` (with fallback from `GET /models` → `POST /chat/completions` when models list is not implemented, memoized).
- `AiAssistService.healthCheck()` returns `reason` (maps NoOp-while-enabled → `not-configured`).
- Worker adapters align to keyless openai-compat configuration.
- Admin connectivity tests for AI keys now append a runtime verdict (`Lauftest: …`) and may downgrade success if the runtime adapter reports unavailable while HTTP probe succeeded; the verdict is secret-free.
- Web `coverage-summary-section.tsx` displays the concrete reason (using new i18n keys `ai.reason*`).
- Tests extended for adapters, service, error classification, system-config cross-check.

All changes are additive, backwards compatible and limited to the AI integration. No destructive migrations.

## Acceptance criteria (extension A)

- Keyless OpenAI-compatible endpoints work (no API key configured, HTTP 200 on connectivity test).
- `/ai/status` includes `reason` (or `null`) and the web UI shows an actionable, secret-free hint instead of the generic "provider antwortet nicht".
- Admin AI connectivity tests include the runtime verdict and do not produce a misleading "OK" while the runtime would be unavailable.
- Lint/typecheck/tests pass (Docker gate) with the extended test coverage.
