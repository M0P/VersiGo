# NEXT-CODING-AGENT-PROMPT.md

## Ready-to-paste prompt for the next coding-agent session

> Copy everything between the two `--- PROMPT START/END ---` markers into a new
> session. It is self-contained. Because there is currently **no** unimplemented
> work package in `prompts/`, the prompt tells the next agent to wait for an
> explicit instruction instead of inventing work.

--- PROMPT START ---

You are the coding agent for the **VersiGo** repository at
`/var/mnt/data/Dokumente/Informatik/VibeCode/VersiGo` (branch
`fix/policy-delete-ui`, HEAD `ff04f14`).

### 1. Current state (2026-10-17)

- **BugFix-21** — "Paperless document list: no live lookups, controlled sync,
  document metadata + type icons" — commit **`ff04f14`**, 25 files, user bug
  report of 2026-10-17. Review reports:
  `docs/reviews/BugFix-21-review-1.md` … `-4.md` (round 4: **PASS**, 0
  Critical / 0 High / 0 Medium / 0 Minor). Original work package:
  `prompts/BugFix-21-paperless-document-sync-metadata.md`.
- Earlier packages on this branch: BugFix-20 (`1200bdc`, `b4445c0`), AP-22 and
  its follow-up (`84e15ea`, `e5e91ac`) — see the package history below.
- The Docker gate is green after BugFix-21: lint (4 packages), typecheck (4),
  tests (api 755 / 62, web 111 / 7, worker 48 / 4, foundation 107 / 12),
  dependency-licence check, version-sync check, i18n guard →
  "All checks passed!".

### 2. The work package you must implement

**There is none.** `prompts/` contains no unimplemented numbered work package
after `prompts/BugFix-21-paperless-document-sync-metadata.md`:

- `prompts/` files that are already implemented and must **not** be
  re-implemented: `AP-01 … AP-22`, `BugFix-01 … BugFix-21`,
  including `prompts/BugFix-18-oidc-reverse-proxy-caddy.md` (commit `f9d6166`,
  reviews `docs/reviews/BugFix-18-review-1.md` / `-2.md`).
- `prompts/00-gemeinsame-regeln.md` and `prompts/PR-REVIEW.md` are not work
  packages.
- There is no `prompts/BugFix-22-*.md`; `AP-23` is unused/reserved and has no
  prompt file.

**Therefore: do not start, invent, or partially implement any work package.**
Wait for the user's explicit instruction. If the user supplies a new numbered
prompt file in `prompts/` (or an equivalent direct request), implement **only
that one package** and **do not start any later package**, not even
partially. If a new prompt file appears, the whole procedure of section 4
applies to it; paste its full content into your working context before
touching any file.

### 3. What BugFix-21 changed (context, do not redo)

User findings after the AP-22 release, verbatim:

> "die automatisch verknüpften paperless dokumente sollen nicht jedes mal live
> geladen werden, es soll einen geteuerten automatischen sync geben und die
> möglichkeit soll bleiben, es manuell zu triggern. zudem fehlen metadaten der
> dokumente, diese müssen in der ui angezeigt werden: datum vom dokument, url zu
> dem dokument in paperless. die info "common.uploadedAt" muss nicht angezeigt
> werden. "Paperless-Dokument" wird doppelt aufgeführt, einmal reicht."

Plus the follow-up requirement: "der dokument typ soll durch ein passendes icon
dargestellt werden".

Delivered:

- `PaperlessNgxService.getDeepLink()` is a **pure local computation** from
  `PAPERLESS_URL` (no HTTP request per linked document) and also returns a link
  for a document that no longer exists in Paperless.
- The controlled tag sync (periodic reconcile via
  `PAPERLESS_TAG_SYNC_INTERVAL_MS`, default 5 min, plus the manual
  "Jetzt aktualisieren" button) persists title, document date and MIME type.
  The worker requests `fields=id,title,created,mime_type` and falls back to
  `fields=id,title` on HTTP 400. Automatically managed rows are refreshed;
  manually linked rows are only gap-filled — user values are never overwritten.
- Manual links store the fetched MIME type; re-linking fills only metadata that
  is still NULL. An unusable external date is dropped (`parsePaperlessDate`)
  instead of being persisted as `Invalid Date`.
- The document list shows the type as an icon (pure mapping in
  `apps/web/src/lib/document-type.ts`, new icon paths, `policies.documentTypeKind*`
  keys in both catalogs), the document date and the Paperless URL. The
  `common.uploadedAt` line and the duplicate "Paperless-Dokument" label are gone.
- New guard test `apps/web/src/__tests__/documents-tab-i18n.spec.ts` pins the
  defect class: every static `t('…')` key in `documents-tab.tsx` must resolve in
  both catalogs, and `common.uploadedAt` must not reappear.
- Docs synced: `docs/06-integrations.md` (incl. the accepted boundary that
  API-side metadata edits of tag-assigned documents are overwritten by the next
  sync), `docs/05-feature-slices.md`, `docs/ui-control-matrix.md`,
  `docs/end-user-guide.md`.

Known limits of BugFix-21 (accepted, documented): pre-BugFix-21 rows only get
metadata at the next sync (or on re-link); `parsePaperlessDate` is intentionally
duplicated in `apps/api` and `apps/worker`; the API-side
`PaperlessNgxService.listDocumentsByTag` is unused by production code and still
requests the minimal field list — the sync runs exclusively through the worker's
`PaperlessTagClient`.

### 4. Required process for any package you are given

1. Read the applicable `AGENTS.md` files, the prompt file and the touched
   sources/tests before editing. Use test-driven development (observe the red
   phase) for changed behaviour.
2. Use a feature branch (`feature/<short-name>`, or the repository's existing
   task branch). Never implement on `main`/`master`/release branches. Do not
   push, merge, rebase, amend or rewrite history.
3. Keep the change inside the work package; do not start the next one.
4. Run the **Docker-only** gate (`docker compose -p versigo-test -f
   docker-compose.test.yml down -v`, then `up --build
   --abort-on-container-exit --exit-code-from test`). The host has no working
   vitest/rollup; host `tsc --noEmit` works for fast pre-checks.
5. Review loop: invoke the `code-reviewer` **subagent via the Task tool** for
   every round (a review is valid only if the subagent actually runs — never
   self-review, never simulate it) and write each report verbatim to
   `docs/reviews/<package>-review-<n>.md`. Fix every Critical/High/Medium
   finding and every Minor that is reasonable and safe. Acceptance: 0 Critical,
   0 High, 0 Medium, ≤ 8 Minor, plus passing checks. The loop is capped at
   **five rounds**; if the bar is not met, stop without committing and ask the
   user to decide.
   **Model caveat:** `.opencode/agents/code-reviewer.md` configures
   `opencode/deepseek-v4-flash-free`, which the provider currently rejects with
   "Model unavailable". In BugFix-21 every round was therefore invoked with
   `model: opencode/deepseek-v4.1-flash-free` (note this in the report). If no
   `code-reviewer` model is available, stop and report
   "REVIEW AUTOMATION FAILED: DeepSeek code-reviewer could not be invoked."
6. Commit only the files belonging to the package, with a message beginning
   with the package number (e.g. `BugFix-22: …`), then update this handoff file
   for the package after it.
7. Synchronise the Trilium project note (section 6) and clean up all
   Docker/Podman artifacts and scratch files the session created (section 5).

--- PROMPT END ---

## Project state after BugFix-21 (2026-10-17)

Branch: `fix/policy-delete-ui`, HEAD `ff04f14` (BugFix-21).

### Package history relevant to this handoff

- **BugFix-21** (user bug report 2026-10-17) — commit **`ff04f14`**, 25 files.
  Work package `prompts/BugFix-21-paperless-document-sync-metadata.md`, reviews
  `docs/reviews/BugFix-21-review-1.md` … `-4.md` (4 → 2 → 2 → 0 Minor, final
  verdict PASS). All four rounds were run by the `code-reviewer` subagent; the
  reports note the model override (`opencode/deepseek-v4.1-flash-free`).
- **BugFix-20** — commit **`1200bdc`** (policy delete UI) plus `b4445c0`
  (documentation/handoff). Review report `docs/reviews/BugFix-20-review-1.md`
  is a **self-review** (no reviewer subagent was available in that session).
- **AP-22** — tag-based Paperless document assignment (`84e15ea`, follow-up
  `e5e91ac`), review reports `docs/reviews/AP-22-*-review-*.md`.
- Older history is listed in the previous revision of this file (git history of
  this path).

### Verification performed for BugFix-21

- Containerised gate (twice, after the round-1 and round-2/3 fixes):
  `docker compose -p versigo-test -f docker-compose.test.yml down -v` then
  `up --build --abort-on-container-exit --exit-code-from test` →
  prisma migrate deploy → lint (4 packages) → typecheck (4) → tests →
  licence check → version-sync check → i18n guard → "All checks passed!".
  Final counts: api 755 / 62 files, web 111 / 7, worker 48 / 4,
  foundation 107 / 12.
- TDD: the red phase was observed by stashing the implementation and running
  the new specs against the old code (API 5 failures, worker 16, web 2) before
  the green run.
- Host `tsc --noEmit` for `apps/api` and `apps/web` — clean.
- **Not covered:** the repository still has no browser/e2e or accessibility
  harness, so the document-list UI (type icon, date, URL, removed lines) was
  verified only by unit tests, type/build checks and source reading. State this
  honestly in any follow-up report.

## THERE IS NO NEXT WORK PACKAGE

`prompts/` contains **no** unimplemented numbered work package after
`prompts/BugFix-21-paperless-document-sync-metadata.md` (the last numbered
file). Everything defined so far (AP-01 … AP-22, `BugFix-*` up to BugFix-21) is
implemented, reviewed and committed.

- `prompts/BugFix-18-oidc-reverse-proxy-caddy.md` still exists but is **already
  implemented** (commit `f9d6166`); do **not** re-implement it.
- `prompts/00-gemeinsame-regeln.md` and `prompts/PR-REVIEW.md` are not work
  packages.
- `AP-23` is unused/reserved and has no prompt file.

**A new coding-agent session must NOT auto-start any work package.** Wait for an
explicit user instruction. If a new numbered prompt file appears in `prompts/`,
implement only that one and do not begin any later package.

## Environment reminders (Podman host)

- `docker` is a Podman shim → podman-compose. Always
  `docker compose -p versigo-test -f docker-compose.test.yml down -v` before
  `up`; `up --build` alone does not recreate containers on this machine.
- `docker-compose.yml` and `docker-compose.test.yml` both declare
  `name: versigo`, so always pass `-p versigo-test` for the test stack; a plain
  `down` against the test file would disturb the dev stack.
- Node/pnpm/vitest do not work on the host (missing
  `@rollup/rollup-linux-x64-gnu`); run gates in the test container. Host `node`
  and `npx tsc --noEmit` do work for fast pre-checks.
- Fast iteration without a rebuild (used for BugFix-21):
  `podman run --rm -v "$PWD/apps/api/src:/app/apps/api/src:ro" … versigo-test:latest sh -c 'pnpm --filter @versigo/api exec vitest run <spec>'`.
- `scripts/compose-smoke-test.sh` is destructive (its last phase drops the dev
  schema); run it only when losing the current dev data is acceptable.
- `/var/home` is ~123 GB and fills quickly. Check `df -h /var/home`, use
  `podman system prune -a -f` when needed, never relocate podman storage, and
  delete every scratch file/container/image/volume the session created before
  finishing (AGENTS.md point 9). Do not touch pre-existing containers
  (`tk-epa-ubuntu`, `libation-env`) or the `versigo_*` dev stack.
- BugFix-21 added no runtime dependency, environment variable, migration, port,
  queue, storage path or health endpoint, so the Compose stack, `.env.example`
  and the smoke test needed no change; keep it that way.

## Documentation status (Trilium)

Trilium MCP is available and writable. The VersiGo project note is:

- Note **"VersiGo (Versicherungsverwaltung)"**, `noteId BRpbPoqTaGKk`, at the
  Trilium root, labels `#project = versigo`, `#repository = VibeCode/VersiGo`,
  `#status = in Arbeit`.
- Content: project overview, verification/process conventions, the
  destructive-smoke-test warning, and one entry per package (AP-22 `84e15ea`,
  AP-22 follow-up `e5e91ac`, BugFix-20 `1200bdc`, and — added by the BugFix-21
  session — BugFix-21 `ff04f14`).
- Writes are verified by reading the note back. Extend this note for future
  packages instead of creating a second VersiGo note.

Repository documentation (`docs/05`, `06`, `ui-control-matrix`, end-user-guide)
is updated and committed with BugFix-21.
