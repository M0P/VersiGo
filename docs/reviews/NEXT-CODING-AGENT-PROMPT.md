# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-17 (version maintenance tooling + bump to 1.0.0-beta.2)

BugFix-17 was a direct user request with no prompt file (work package: make
version maintenance easy + bump `1.0.0-beta.1` → `1.0.0-beta.2`). It is
implemented, reviewed (13 review rounds, acceptance condition met on round 13:
0 Critical / 0 High / 0 Medium / 0 Minor; see
`docs/reviews/BugFix-17-review-1.md` … `BugFix-17-review-13.md`), and
committed on branch `fix/BugFix-09-ci-fix-community-standards-dockerhub`
(commit `8f814b5`).

Package BugFix-17 delivered:

1. **Single source of truth**: the `"version"` field in the ROOT
   `package.json`.
2. **`scripts/bump-version.mjs`** (`pnpm version:bump <version>`): updates all
   6 `package.json` files (root, api, worker, web, foundation), both compose
   files (`APP_VERSION` + `NEXT_PUBLIC_APP_VERSION` defaults, 3 occurrences
   each), `.env.example` (line-anchored, CRLF-preserving), and the version
   line in `scripts/dependency-licenses.mjs` + `docs/third-party-notices.md`.
   Atomic staging in memory (writes only after full validation); pre-check
   aborts on superset drift (e.g. `...beta.10` next to `...beta.1`); partial
   write errors instruct to run the sync check + `git checkout` restore.
   `pnpm-lock.yaml` needs no rebuild (workspace packages are linked via
   `link:`/`workspace:*`, never version-pinned).
3. **`scripts/check-version-sync.mjs`** (`pnpm version:check`): exit-1 gate
   verifying every version-carrying location against the root package.json
   (5 workspace packages, both compose files incl. comment-line skipping and
   occurrence-count parity, `.env.example`, licenses/notices header with
   `[0-9A-Za-z.+-]` lookahead). Hardened guards: exactly one "malformed JSON"
   diagnostic, missing-file/primitive/non-string version handled cleanly.
4. **CI test gate**: `docker-compose.test.yml` runs the sync check between
   license check and i18n guard; `Dockerfile.test` now COPYs the new script
   plus `docker-compose.yml`, `docker-compose.dockerhub.yml`, `.env.example`.
5. **Version bump**: `1.0.0-beta.1` → `1.0.0-beta.2` in every functional
   location. `NEXT_PUBLIC_APP_VERSION` is injected at container STARTUP
   (`apps/web/docker-entrypoint.sh` → `/runtime-config.js`), so only a web
   container restart is needed, no rebuild. Publish workflow maps git tag
   `v1.0.0-beta.2` → Docker tag `1.0.0-beta.2` (`${GITHUB_REF_NAME#v}`).
6. **Docs**: `docs/release-guide.md` §1 gate comment updated, §5 checklist
   note ("update this reference when tagging"), new §7 "Bumping the
   application version" (workflow, startup injection, manual locations:
   health-controller spec fixtures + app-config.schema.ts comment);
   `docs/docker-image-guide.md` rollback example corrected
   (`docker-compose.dockerhub.yml` + `VERSIGO_IMAGE_TAG=1.0.0-beta.2`).

**Review loop history (13 rounds, acceptance met):**
R1 0/0/3/4 → R2 0/0/0/3 → R3 0/0/0/2 → R4 0/0/0/1 → R5 0/0/0/4 → R6 split
(6B 0/0/1/3, 6D 0/0/1/2, others minors) → R7 split (7A 0/0/1/1, 7B 0/0/1/2)
→ R8 split 0/0/0/2+0/0/0/2 → R9 split (9A 0/0/0/0, 9B 0/0/0/2) → R10 0/0/0/2
→ R11 0/0/1/0 → R12 0/0/0/1 → R13 0/0/0/0 (PASS). Every round's findings were
fixed and re-verified (scratch tests + full gate after each fix cycle).

**Verification state of the BugFix-17 commit (`8f814b5`):**
- Full compose test gate (container, `docker compose -p versigo-test -f
  docker-compose.test.yml up --build --abort-on-container-exit
  --exit-code-from test`): Prisma migrate deploy, lint, typecheck, tests
  (API 58 files / 672 tests), license check (578 packages, OK), version sync
  check (OK, "all locations match 1.0.0-beta.2"), i18n guard (OK) →
  "All checks passed!".

## No next work package exists

`prompts/` contains no further numbered work package after BugFix-11 (last
file `prompts/BugFix-11-release-readiness.md`). BugFix-12 through BugFix-17
were direct user requests without prompt files, all committed:
- BugFix-12 (`f6ffeb7`): third-party license compliance.
- BugFix-13 (`d6afe07`): single source for public URLs (VERSIGO_HOST +
  APP_PORT/WEB_PORT derive NEXT_PUBLIC_API_BASE_URL, CORS_ORIGINS,
  OIDC_CALLBACK_URL).
- BugFix-14 (`0e29c02`): dual access with one deployment (per-request cookie
  `Secure` flag 'auto', web entrypoint auto-detects API base URL).
- BugFix-15 (`4360b65`): curl-based compose healthchecks.
- BugFix-16 (`d74ba53`): password change for logged-in user + admin password
  reset.
- BugFix-17 (`8f814b5`): this package.

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's next explicit instruction. If the user provides a new
numbered prompt file in `prompts/` (or a direct request), implement only that
one and use the same review loop: invoke the `code-reviewer` subagent via the
Task tool on the uncommitted diff, write each report verbatim to
`docs/reviews/<package>-review-<n>.md`, fix every Critical/High/Medium and
Minor where reasonable until 0 Critical / 0 High / 0 Medium / ≤ 8 Minor, max
5 review rounds, then commit with a message starting with the package number
and write a new handoff (this file).

## Environment reminders for the next session (Podman host)

- `docker` is a Podman shim → podman-compose. Reuse stale containers after
  rebuilds: always `docker compose ... down -v` before `up` (`up --build`
  alone is NOT enough on this machine). The test runner service has NO volume
  mount — source is baked into the image at build time, so any verification
  of host-side edits requires rebuilding the test image.
- `docker-compose.yml` AND `docker-compose.test.yml` both set `name: versigo`
  — the project names collide. ALWAYS run the test stack with an explicit
  project override: `docker compose -p versigo-test -f docker-compose.test.yml
  ...`; a plain `down`/`down -v` against the test file tries to remove the
  DEV network `versigo_versigo-internal` and would disrupt the running dev
  stack. Never touch the dev stack (`versigo_*` containers).
- Node/pnpm are NOT on the host PATH; run gates via the test container. For
  quick script checks (version scripts) use
  `podman run --rm -v <repo>:/work -w /work --user 1000:1000 --entrypoint node
  docker.io/library/node:24-alpine scripts/check-version-sync.mjs`. Bind
  mounts from `/tmp` fail in the rootless userns (EACCES) — use a scratch
  directory on the data partition if tests need a copy of the repo.
- The `auth.service.ts ↔ oidc.strategy.ts` cycle is load-order fragile: a
  full API boot (real Nest bootstrap) is the ONLY check that proves it; the
  unit suites cannot.
- Disk on `/var/home` is ~123 GB and fills quickly. `podman system prune -a -f`
  before large rebuilds. Never redirect podman storage. Clean up all podman
  artifacts created during a session (test stack down -v,
  `localhost/versigo-test` image, scratch containers/volumes/files) before
  the commit and verify `df -h /var/home` afterwards (AGENTS.md point 9).
