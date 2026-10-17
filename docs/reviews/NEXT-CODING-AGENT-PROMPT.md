# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-20 (2026-10-17)

Branch: `fix/policy-delete-ui` (task branch for this package, branched off
`fix/BugFix-09-ci-fix-community-standards-dockerhub`).

### Package history relevant to this handoff

- **BugFix-20** (this package, user bug report 2026-10-17) — commit
  **`1200bdc`**, 7 files. Review report `docs/reviews/BugFix-20-review-1.md`.
  **Caveat:** the report is a **self-review**, not an independent review — all
  three reviewer subagents were unavailable in this session (`code-reviewer`
  and `code-reviewer_openrouter`: model unavailable;
  `code-reviewer_modal`: provider 404). See the blocker section in
  `docs/reviews/BugFix-20-review-1.md`.

User report (verbatim): *"ich vermisse in der aktuellen version einen weg eine
versicherung zu löschen"*.

- **Root cause:** the API already exposed a soft-delete endpoint
  (`DELETE /households/:householdId/policies/:policyId` → sets `archivedAt` +
  audit `ARCHIVE`), and `docs/ui-control-matrix.md` already specified the
  control, but the web UI had no entry point for it.
- **Fix:** the policy detail page header gained a danger button
  "Versicherung löschen" (window.confirm → DELETE → redirect to
  `/policies?archived=1`, inline error alert on failure); the list page shows a
  dismissible success notice when arriving with `?archived=1`. The API service
  now also sets `status=ARCHIVED` (and logs it in the audit diff) to match the
  control matrix; the policy remains hidden from all lists via `archivedAt`.
- **i18n:** `policies.deletePolicy/deleteConfirm/deleteSuccess/deleteError/
  deleting` plus `common.dismiss` (de + en).
- **Test:** `policy-registry.service.spec.ts` pins the update payload
  (`archivedAt` + `status: 'ARCHIVED'`); the red phase was observed before the
  service change.
- **Docs:** `docs/ui-control-matrix.md` row "Police löschen" updated to the
  actual behaviour (soft delete, inline notice instead of a toast).
- **Open follow-ups (Minors, not fixed):** no request-sequence guard in
  `handleDelete`; the button is also rendered for READ_ONLY (API returns 403,
  consistent with the sibling tabs); the `?archived=1` notice reappears on a
  manual reload; the codebase has no browser/e2e harness, so the UI was not
  verified in a browser.

### Package history (earlier)

- **AP-22** (`prompts/AP-22-paperless-ngx-ext`) — tag-based Paperless-ngx
  document assignment per insurance policy. Commit `84e15ea`, handoff
  `7e4a557` / `0948b6f`, review reports
  `docs/reviews/AP-22-paperless-ngx-ext-review-1.md` … `-review-6.md`
  (final round: 0 Critical / 0 High / 0 Medium / 1 Minor).
- **AP-22 follow-up** — commit **`e5e91ac`**, 25 files. Review reports
  `docs/reviews/AP-22-followup-review-1.md` … `-review-5.md`.
  Final round 5: **PASS — 0 Critical / 0 High / 0 Medium / 5 Minor**
  (round 5 was the cap of the review loop; the five remaining Minors are
  cosmetic doc/UI duplications documented in review 5 and in the session
  report — they were deliberately NOT changed because no further review round
  was available for a modified tree).


### What the AP-22 follow-up delivered

User report (verbatim): *"Die Tag verwaltung der versicherung sollte unter
dem dokumenten reiter sein, nicht unter basiseinstellungen jeder versicherung.
außerdem PAPERLESS_TAG_CREATE_FAILED: the tag could not be created in Paperless
und tags suchen funktioniert auch nicht (kein fehler, aber auch kein
ergebnis)"*. The Paperless connection itself was verified working by the user
(HTTP 200 from the admin menu).

- **UI move:** the per-policy tag management now lives in the policy's
  **Documents tab**. `apps/web/src/app/policies/[id]/documents-tab.tsx`
  renders `paperless-tag-section.tsx` (fragment + sibling-`Card` pattern of
  `costs-overview-card.tsx`); `edit/page.tsx` no longer renders it;
  `DocumentsTab` gained an `insurerName` prop and the section an optional
  `onConfigChange` callback that clears/refreshes the manual-link tag hint.
- **Silent failures removed (root cause of both symptoms):** the adapter
  contract changed from "empty page / `null`" to explicit results —
  `searchTags` → `PaperlessTagSearchResult` (`{ok:true;page}` |
  `{ok:false;error:{kind}}`), `createTag` → `PaperlessTagCreateResult`; kinds
  `NOT_CONFIGURED | AUTH_FAILED | UNREACHABLE | REJECTED` (401/403 →
  `AUTH_FAILED`, other 4xx → `REJECTED`, `requestRaw` null / 5xx / unusable
  payload → `UNREACHABLE`).
- **API mapping:** `paperless-tag.service.ts` maps the kinds to HTTP 503/502
  with stable `PAPERLESS_*` message prefixes (`PAPERLESS_NOT_CONFIGURED`,
  `PAPERLESS_AUTH_FAILED`, `PAPERLESS_UNREACHABLE`,
  `PAPERLESS_TAG_SEARCH_FAILED`; a create rejection keeps
  `PAPERLESS_TAG_CREATE_FAILED`). 401 is deliberately avoided so the web does
  not treat it as session expiry. PUT lookup paths emit
  `PAPERLESS_TAG_NOT_FOUND: …` / `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>`.
- **Web:** `apps/web/src/lib/paperless-tag-error.ts` maps the API message to
  an i18n key for search, create, assign and tag-lookup;
  `apps/web/src/__tests__/paperless-tag-error.spec.ts` pins the mapping and
  guards both directions against code drift with the API. New i18n key
  `paperlessTagErrorREJECTED` (de + en). The section shows the cause instead
  of "no matching tag".
- **Smaller fixes:** empty tag pages report `pageCount` 0;
  `CreatePaperlessTagDto.name` is trimmed via `@Transform` (blank name → 400,
  not a 502) with a new DTO spec; `searchSeq`/`tagSeq` guards against stale
  responses; a short search term renders an explanation.
- **Docs synced:** `docs/05-feature-slices.md`, `docs/06-integrations.md`
  (error/status contract incl. PUT/DELETE semantics and the accepted
  `REJECTED` limitation), `docs/end-user-guide.md`,
  `docs/ui-control-matrix.md`.

### Verification performed (AP-22 follow-up)

- Containerised gate (Docker only, AGENTS.md mandate):
  `docker compose -p versigo-test -f docker-compose.test.yml down -v` then
  `up --build --abort-on-container-exit --exit-code-from test` →
  prisma migrate deploy → lint → typecheck → tests → dependency-licence check
  → version-sync check → i18n guard → "All checks passed!"
  (api 750 tests / 62 files, web 58 / 5, foundation 107 / 12, worker 30 / 3).
- Host `tsc --noEmit` for `apps/web` and `apps/api` — clean.
- TDD: a red phase was observed (16 API + 1 web test failing against the old
  code) before implementation.
- **Not covered:** this repository still has no browser/e2e or accessibility
  harness, so neither the tab move nor the new UI error branches were verified
  in a browser.
- Side effect to be aware of: reproduction/verification created four tags in
  the user's **real** Paperless instance (ids 1184–1187, names "VersiGo –
  Testtag", "VersiGo – Wohngebäude Test", "versigo", "VersiGo – testtag").
  They were intentionally left in place.

## THERE IS NO NEXT WORK PACKAGE

`prompts/` contains **no** unimplemented numbered work package after
`prompts/AP-22-paperless-ngx-ext` (the last numbered file). All defined
packages (AP-01 … AP-22 and the `BugFix-*` series up to BugFix-19) are
implemented, reviewed and committed.

- `prompts/BugFix-18-oidc-reverse-proxy-caddy.md` still exists but is **already
  implemented** (commit `f9d6166`, reviews
  `docs/reviews/BugFix-18-review-1.md` / `-2.md`); do **not** re-implement it.
- `prompts/00-gemeinsame-regeln.md` and `prompts/PR-REVIEW.md` are not work
  packages.

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's explicit instruction. If the user supplies a new numbered
prompt file in `prompts/` (or a direct request), implement only that one and
do not begin any later package.

## Required process for the next package (unchanged)

1. Read the applicable `AGENTS.md` files, the new prompt file and the touched
   sources/tests before editing.
2. Work on a feature branch (`feature/<short-name>` or the repository's
   existing task branch); never on `main`/`master`/release branches. Do not
   push, merge, rebase or rewrite history.
3. Keep changes inside the work package; do not partially implement the next
   one.
4. Run the Docker-only gate before handing off; the host has no usable Node,
   pnpm or vitest.
5. Invoke the `code-reviewer` subagent through the Task tool for every review
   round and write each report to `docs/reviews/<package>-review-<n>.md`. Fix
   every Critical/High/Medium and every Minor that is reasonable and safe.
   Acceptance: 0 Critical, 0 High, 0 Medium, ≤ 8 Minor, plus passing checks.
   The loop is capped at **5 rounds**; if the bar is not met after 5 rounds,
   stop, do not commit, and ask the user to decide (they may authorize one or
   more extra verification rounds — that is what happened for AP-22, whose
   round 6 was explicitly approved by the user).
6. Commit only the files belonging to the package, using a message that begins
   with the package number, then update this handoff file.

## Environment reminders (Podman host)

- `docker` is a Podman shim → podman-compose. Always
  `docker compose -p versigo-test -f docker-compose.test.yml down -v` before
  `up`; `up --build` alone does not recreate containers on this machine.
- `docker-compose.yml` and `docker-compose.test.yml` both declare
  `name: versigo`, so always pass `-p versigo-test` for the test stack;
  a plain `down` against the test file would disturb the dev stack.
- Node/pnpm/vitest do not work on the host (missing
  `@rollup/rollup-linux-x64-gnu`); run all gates in the test container. Host
  `node` and `node_modules/.bin/tsc` do work for fast pre-checks.
- `scripts/compose-smoke-test.sh` is destructive: its final phase (step 12)
  runs `DROP SCHEMA public CASCADE` on the dev database and bootstraps a
  production admin. Run it only when losing the current dev data is
  acceptable (or make a DB dump first), and note that several steps assume a
  fresh database (e.g. step 8n asserts that the local admin's `users.locale`
  is `en`). An AP-22-time run aborted there because the long-lived dev DB had
  `de`; that is a precondition issue, not a product defect.
- `/var/home` is ~123 GB and fills quickly. Check `df -h /var/home`, use
  `podman system prune -a -f` when needed, never relocate podman storage, and
  delete every scratch file/container/image/volume the session created before
  finishing (AGENTS.md point 9). Do not touch pre-existing containers
  (`tk-epa-ubuntu`, `libation-env`) or the `versigo_*` dev stack.
- The AP-22 follow-up session added no new runtime dependency, environment
  variable, port, queue or health endpoint, so the Compose stack,
  `.env.example` and the smoke test needed no change; keep it that way.

## Documentation status (Trilium)

Trilium MCP is available and writable. The VersiGo project note is:

- Note **"VersiGo (Versicherungsverwaltung)"**, `noteId BRpbPoqTaGKk`, at the
  Trilium root, labels `#project = versigo`, `#repository =
  VibeCode/VersiGo`, `#status = in Arbeit`.
- Content: project overview, verification/process conventions, the
  destructive-smoke-test warning, the AP-22 package entry (commit `84e15ea`),
  the AP-22 follow-up entry (commit `e5e91ac`) and the BugFix-20 entry
  (policy delete UI, commit `1200bdc`, branch `fix/policy-delete-ui`).
- Writes are verified by reading the note back (`get_note`,
  `search_notes`). Extend this note for future packages instead of creating a
  second VersiGo note.

Repository documentation (`docs/04`, `05`, `06`, `13`, end-user-guide,
ui-control-matrix) is updated and committed with AP-22 and its follow-up.
