# NEXT-CODING-AGENT-PROMPT.md

## Project state after AP-22 (tag-based Paperless-ngx document assignment)

AP-22 (`prompts/AP-22-paperless-ngx-ext`) is implemented, reviewed and
committed on branch `fix/BugFix-09-ci-fix-community-standards-dockerhub`
(commit `84e15ea`, 46 files). Review reports:
`docs/reviews/AP-22-paperless-ngx-ext-review-1.md` … `-review-6.md`.
Final review round: **PASS — 0 Critical / 0 High / 0 Medium / 1 Minor**
(the Minor is an accepted, documented error-code mis-mapping in the legacy
`bulk_edit` fallback path of `assignTagToDocument`; see review 6).

### What AP-22 delivered

- Data model: `policy_documents.linkOriginManual` / `linkOriginTag` (two
  independent origins), `taggingStatus` / `taggingErrorCode`; new
  `PolicyPaperlessTag` (1:1 policy, `connectionRef`, `configVersion`, sync
  state) and `PaperlessTagJob` outbox (`SYNC_POLICY` / `TAG_DOCUMENT`).
  Migration `20261017100000_ap22_paperless_tag_assignment` is additive and
  backfills existing `PAPERLESS_LINK` rows with `linkOriginManual = true`.
- Queue `paperless-tag-sync` with durable-outbox semantics (DB row first, in
  the same transaction as the change; BullMQ is transport only; `PENDING` rows
  are re-dispatched by the periodic reconcile tick). Every job re-checks
  `configVersion` and the connection before acting.
- API config service/controller/DTOs with a read/write role split; worker
  processor (sync, manual-link backfill, tag-removal semantics, reconcile
  tick, connection-drift guard) plus a worker-side transport that reuses the
  existing `PAPERLESS_*` settings (no second connector, no second auth path).
- Frontend tag section (search/select/change/remove/retry) and origin/tagging
  badges on the policy documents tab.
- Docs/.env/compose/settings-catalogue updates, including the
  `PAPERLESS_TAG_SYNC_INTERVAL_MS` smoke assertion.

### Verification performed (AP-22)

- Containerised gate, Docker only (AGENTS.md mandate):
  `docker compose -p versigo-test -f docker-compose.test.yml down -v` then
  `up --build --abort-on-container-exit --exit-code-from test` →
  prisma migrate deploy → lint → typecheck → tests → dependency-licence check
  → version-sync check → i18n guard → "All checks passed!"
  (api 61, worker 3, foundation 12, web 4 test files).
- `bash -n scripts/compose-smoke-test.sh` (syntax) — passed.
- **Not covered:** this repository has no browser/e2e or accessibility harness,
  so no UI, keyboard, responsive or visual verification was performed.

## THERE IS NO NEXT WORK PACKAGE

`prompts/` contains **no** numbered work package after
`prompts/AP-22-paperless-ngx-ext` (the last numbered file). All defined
packages (AP-01 … AP-22 plus the `BugFix-*` series) are committed.

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
6. Commit only the files belonging to the package, with a message starting
   with the package number, and then write a new handoff file (this file).

### Reviewer quirks (learned across AP-06 … AP-22)

- The `code-reviewer` subagent MUST be invoked with
  `model: "opencode/deepseek-v4.1-flash-free"`; without it the Task call fails
  with `Model unavailable`.
- It is read-only and has **no shell**. Give it the diff as a single repo file
  (generate one: `git add -N` the untracked files, `git diff > patch`,
  `git reset`, then point it at the patch) and keep its reading list short.
- It exhausts its step budget quickly: instruct it to "be economical" and to
  emit the final formatted report as the very next text it writes. That single
  instruction is what produced complete reports in AP-22 rounds 3–6.
- It can end a session at "maximum steps reached" with only a candidate list;
  the coordinator may then finalize the classification and must say so in the
  report file.
- Some of its findings can be artefacts of the review setup (e.g. file modes
  reported as `100755` when only the patch generator was at fault). Verify a
  finding against the real file/commit before changing code.

## Environment reminders (Podman host)

- `docker` is a Podman shim → podman-compose. Always
  `docker compose -p versigo-test -f docker-compose.test.yml down -v` before
  `up`; `up --build` alone does not recreate containers on this machine.
- `docker-compose.yml` and `docker-compose.test.yml` both declare
  `name: versigo`, so always pass `-p versigo-test` for the test stack;
  a plain `down` against the test file would disturb the dev stack.
- Node/pnpm/vitest do not work on the host (missing
  `@rollup/rollup-linux-x64-gnu`); run all gates in the test container.
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

## Documentation status (Trilium)

Trilium MCP is available and writable. No VersiGo note existed before AP-22,
so the project note was created and verified during that package:

- Note **"VersiGo (Versicherungsverwaltung)"**, `noteId
  BRpbPoqTaGKk`, at the Trilium root, labels `#project = versigo`,
  `#repository = VibeCode/VersiGo`, `#status = in Arbeit`.
- Content: project overview, verification/process conventions, the
  destructive-smoke-test warning, and the AP-22 package entry (commit
  `84e15ea`, handoff `7e4a557`, verification results, the accepted Minor).
- Writes are verified by reading the note back (`get_note`,
  `search_notes`). Extend this note for future packages instead of creating a
  second VersiGo note.

Repository documentation (`docs/04`, `05`, `06`, `13`, end-user-guide,
ui-control-matrix) is updated and committed with AP-22.
