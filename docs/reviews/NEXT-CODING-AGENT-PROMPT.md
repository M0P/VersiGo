# Next Coding Agent Prompt

**Next work package:** **NONE — await an explicit instruction from the user.**

There is no further numbered implementation package in `prompts/`. Do not
select one, do not create one, and do not start anything automatically.

## Why there is no next package

Every numbered package is implemented and referenced in commit history:

- `AP-02` … `AP-24` (and `AP-13` … `AP-23` feature work) — done.
  `AP-01-repository-scaffold.md`, `AP-01.1-persistence-foundations.md` and
  `AP-01.2-identity-access.md` are superseded early drafts: `AP-01.1` is a
  byte-identical copy of `AP-02-persistence-foundations.md` (verified with
  `cmp`), and the
  scaffold (`apps/api`, `apps/web`, `apps/worker`, `packages/foundation`)
  exists. The repository contains no `AP-11`/`AP-12` files (numbering skips
  from `AP-10` to `AP-13`).
- `BugFix-01` … `BugFix-11`, `BugFix-18`, `BugFix-21`, `BugFix-22` (both
  files) — done. `BugFix-23` was performed without a prompt file (commit
  `c89fecf`).
- `00-gemeinsame-regeln.md` is shared rules, not a package.
  `PR-REVIEW.md` is a role prompt for independent PR review, not an
  implementation package.

If the user supplies a new file under `prompts/`, implement **only** that one
package and ignore all others.

## Previously completed package (this session)

**Package:** `prompts/BugFix-22-KOSTENBERECHNUNG_BRUTTO_NETTO.md` **+**
`prompts/AP-24-detailverbesserungen.md` (combined), including the folded-in
**BugFix-24** enum-migration defect (E824D00).

**Branch:** `feature/ap-24-detailverbesserungen` (created from `868bc78`)
**Commit:** `a812a59` — 82 files, +8384/−710.
**Not pushed, not merged, no PR.** `main` and `origin/main` are in sync at
`868bc78` (ref state at last fetch, 2026-10-18 13:15); the feature branch is
the only unpushed work — 1 commit ahead of `origin/main`. The user pushes and
merges manually. Do not assume `main` has unpushed commits; verify with
`git rev-list --count origin/main..main` before making claims about it.

What landed:

- **BugFix-22** — billing-period/money maths extracted into
  `apps/api/src/features/cost-tracking/cost-schedule.ts` so the API is the
  single source of truth (the web app previously ran its own diverging
  variant); gross *or* net accepted with no silent cross-basis fallback; a
  missing amount renders as `–` and never as `0`; dates unified on
  `TT.MM.JJJJ`; every amount labelled with its basis.
- **BugFix-24** — migration
  `20261018120000_bugfix24_missing_insurance_policy_type_values` adds
  `RENTENVERSICHERUNG`, `KRANKENVERSICHERUNG`,
  `KRANKENVERSICHERUNG_AUSLAND` to `InsurancePolicyType` (present in
  `schema.prisma` but never in a migration, so Postgres rejected them), plus
  drift-guard `apps/api/src/__tests__/schema-enum-sync.spec.ts`.
- **AP-24 §1.1/§1.2** — Paperless sync progress; `PAPERLESS_TAG_SYNC_ENABLED`
  + `PAPERLESS_TAG_SYNC_INTERVAL_MS` presets and a deterministic per-policy
  stagger (`packages/foundation/src/config/paperless-sync-schedule.ts`).
- **AP-24 §2** — `DocumentClass` per `PolicyDocument`, bulk classify (max
  200), filter, UI. Invariant: the tag sync never overwrites
  `documentClass`.
- **AP-24 §3** — coverage summary from an explicit user-selected list of
  `CONTRACT` documents; versioned JSON output (Variante A,
  `COVERAGE_SUMMARY_SCHEMA_VERSION = 1`) with one bounded retry; rendered by
  a restricted block parser (`apps/web/src/lib/coverage-summary.ts`) — **no**
  `react-markdown`, **no** `dangerouslySetInnerHTML`.
- **AP-24 §4** — billing-document sidebar with `<iframe>` preview and
  `GET .../costs/billing-documents` (declared *before* `:entryId`); AI cost
  extraction producing a **proposal only**
  (`POST :policyId/documents/:documentId/cost-suggestion`, `BILLING` docs
  only, `sourceDocumentId` with `onDelete: SetNull`).
- **AP-24 §5** — person/object labels.

### Review outcome

Three rounds through the `code-reviewer` subagent (Task, session
`ses_eaf8effbdffeA2u4PLTxgcH3b2`), reports stored verbatim:

| Report | Outcome |
|---|---|
| `docs/reviews/AP-24-review-1.md` | **No verdict** — reviewer hit `maxSteps: 35`; a continuation was required. Kept as an incomplete iteration. |
| `docs/reviews/AP-24-review-2.md` | `VERDICT: PASS`, but 2 Medium + 1 Minor |
| `docs/reviews/AP-24-review-3.md` | **`VERDICT: PASS` — 0 Critical, 0 High, 0 Medium, 1 Minor** |

Both Medium findings (Prisma mocks did not pin the `where` argument) were
fixed with five new assertion tests — 3 in `cost-tracking.service.spec.ts`,
2 in `documents.service.spec.ts` — and re-verified before round 3.

### Verification actually executed

- `podman build --no-cache -f Dockerfile.test --target build -t versigo-test:latest .`
  → exit 0, `/app/scripts` and `/app/docs` confirmed present in the image.
- `docker compose -f docker-compose.test.yml down -v` then
  `docker compose -f docker-compose.test.yml up --no-build --abort-on-container-exit --exit-code-from test`
  → **exit 0**, `All checks passed!`
  - `prisma migrate deploy` OK
  - lint 3/3 · typecheck 4/4
  - **1288 tests passing** — web 234/17, foundation 122/13, worker 59/4, api 873/68
  - license check `Checked 563 packages` OK · version sync `1.0.0-beta.4` OK
  - i18n guard OK (67 files)
- `./scripts/compose-smoke-test.sh --build` → **exit 0**,
  `=== All smoke tests passed ===`
- Host `npx tsc --noEmit` (api + web) and `npx eslint` on touched files → clean.

## Known open items (not blockers)

1. **Minor (accepted):** `apps/web/src/__tests__/bugfix22-ui-guards.spec.ts`
   verifies UI contracts by string scan — fragile against renames and
   refactors. The suggested remedy (React Testing Library + JSDOM) would add a
   dependency and was outside this package's scope.
2. **Not performed, disclosed:** the manual quality assessment of the
   cost-extraction prompt against a representative anonymised sample of
   billing documents (delivery item 4 of AP-24) was **not** carried out — no
   assigned review scope, no sample. Recorded as a known limitation at
   `docs/06-integrations.md:94-97`. No test result or quality figure was
   fabricated.
3. **Drift guard scope:** `schema-enum-sync.spec.ts` covers **enums only**,
   not column/table drift.
4. **Pre-existing working-tree deletions:** ` D .opencode/agents/code-reviewer.md`
   and ` D .opencode/agents/coding-agent.md` predate this package and must
   **not** be staged by anyone. They are still present, unstaged.
5. `docs/third-party-notices.md` fails the license check **on the host only**
   (see lesson 2 below) — it is correct in the container.

## Operational lessons learned this session

These cost significant time; read them before touching the build.

1. **`podman build` needs `-f Dockerfile.test`, always.** Without `-f` podman
   builds the root `Dockerfile` (the production image), which has no
   `COPY scripts/...`, `COPY docs/third-party-notices.md`, `COPY docker-compose*.yml`
   or `COPY .env.example`. Tagging that build stage as `versigo-test:latest`
   makes the license/version-sync/i18n steps fail with
   `MODULE_NOT_FOUND`, or silently never run. Three gate runs were invalidated
   this way; only their test results stayed valid, because the application
   sources are identical. Correct invocation:
   ```bash
   podman build --no-cache -f Dockerfile.test --target build -t versigo-test:latest .
   podman run --rm --entrypoint sh localhost/versigo-test:latest -c 'ls /app/scripts /app/docs'
   ```
   (`docker-compose.test.yml` pins `dockerfile: Dockerfile.test`, so
   `up --build` is always correct — only manual builds are at risk.)
2. **The host `node_modules` is stale (dated 2026-08-08) while the lockfile is
   from 2026-10-18.** `node scripts/dependency-licenses.mjs check` therefore
   fails on the host (`578` packages vs `563` in the container,
   "third-party-notices.md is out of date"). This is environmental, not a
   regression. Do **not** run a host `pnpm install` to paper over it — the
   container gate is the authoritative path (AGENTS.md: Docker Compose is the
   mandatory verification environment).
3. **`code-reviewer` has no shell.** It can only `read`/`glob`/`grep`. It
   cannot run `git diff`, so the full diff and the complete contents of new
   untracked files must be provided as readable files. This session staged
   them in a git-ignored scratch directory `.turbo/ap24-review/`
   (`01-tracked-changes.diff`, `02-new-files.txt`, `03-diffstat.txt`,
   `04-gate-check-output.txt`, `05-modified-tracked.txt`,
   `06-untracked.txt`, `07-change-set-manifest.md`,
   `08-smoke-check-output.txt`).
4. **The reviewer may exhaust `maxSteps: 35` without reaching a verdict.** A
   "review" that returns no `VERDICT:` line is *not* an acceptable PASS.
   Continue the same session (`sessionID`) with a narrowed scope and an
   explicit requirement to end on `VERDICT: PASS` / `VERDICT: CHANGES REQUIRED`.
5. **Podman-compose reuse trap.** Start every gate with
   `docker compose -f docker-compose.test.yml down -v`; `up --build` alone
   does not recreate existing containers. After any source edit the image must
   be rebuilt `--no-cache`, after which `up --no-build` avoids the flaky layer
   cache.
6. **`sed -i` fails on this filesystem** ("Rechte für … werden beihalten") —
   use Python for in-place edits.
7. **A mock that ignores its `where` filter lets a test pass for the wrong
   reason.** Prefer `mockResolvedValue(null)` when the real query would return
   no row (e.g. a document belonging to another policy), and always assert the
   argument passed to Prisma for isolation-critical queries.

## Standing workflow rules

1. Read the supplied work package completely, then inspect `AGENTS.md`,
   relevant code, tests, configuration and docs.
2. Record the starting commit and inspect the working tree before editing; do
   not overwrite or stage pre-existing unrelated changes.
3. Implement the smallest coherent change; add behaviour-focused tests for
   success and failure cases (red–green where practical).
4. Run the container gate and the Compose smoke test; fix failures you caused
   before requesting review. Record exact commands and observed outcomes —
   never claim a check passed that did not run.
5. Invoke `@code-reviewer` via Task with the complete change set. Save every
   response verbatim at `docs/reviews/<work-package>-review-<iteration>.md`
   and retain earlier iterations.
6. Fix all Critical/High/Medium findings; address Minor findings when safe and
   in scope. Re-run checks and re-review after any implementation change.
7. Acceptance = latest completed review is **PASS**, zero Critical/High/Medium,
   all required criteria evidenced, required checks actually passing. Minor
   findings do not block.
8. Clean up every Podman image, container, volume and `/tmp` file you created
   *before* committing. Never remove shared base images or pre-existing
   containers (`tk-epa-ubuntu`, `libation-env`, `tools`, `openwrt-*`, `maya`).
   Never redirect Podman storage.
9. Stage only the package's files (plus its review reports), inspect the
   staged diff, and commit with the package number at the start of the message.
10. Document the completed package in the Trilium note `BRpbPoqTaGKk`
    ("VersiGo (Versicherungsverwaltung)") — `get_note` for the current
    `blobId`, then `update_note` with `mode: 'append'`, then re-read to verify.
    Do not store secrets there.
11. **Stop after committing.** No push, no merge, no pull, no force-push, no
    history rewrite, no branch deletion, no pull request, no next package.
