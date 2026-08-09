# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-12 (third-party license compliance)

The third-party license-compliance work package (no prompt file – direct user
request: "create a list of all used libraries and licenses, find the rules to
use each, then apply the rules so we use each library as intended") is
implemented, reviewed (2 review rounds, acceptance condition met: 0 Critical /
0 High / 0 Medium / ≤ 8 Minor – final round 0/0/0/4, three of the four Minors
fixed immediately, the fourth explicitly deferred to the next work package;
see `docs/reviews/BugFix-12-review-1.md` and
`docs/reviews/BugFix-12-review-2.md`), and committed on branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub` (commit `f6ffeb7`).

Package BugFix-12 delivered:

1. **Full dependency + license inventory.** `docs/third-party-notices.md`
   lists all 578 npm packages (direct and transitive, incl. dev tooling) with
   their license, generated from the installed pnpm virtual store
   (`node_modules/.pnpm`). License summary: MIT 482, Apache-2.0 35, ISC 28,
   BSD-2-Clause 12, BSD-3-Clause 10, BlueOak-1.0.0 5, Unlicense 2, 0BSD 1,
   CC-BY-4.0 1 (caniuse-lite), LGPL-3.0-or-later 1
   (@img/sharp-libvips-linuxmusl-x64), Python-2.0 1 (argparse). Four packages
   without a `license` field (busboy, streamsearch, passport-strategy, pause)
   confirmed MIT; `pause` handled via `KNOWN_LICENSES` override.
2. **License policy + usage rules.** `scripts/dependency-licenses.mjs` is the
   single source of truth (allowlist, restricted licenses, special cases) and
   `docs/10-quality-and-library-policy.md` gained a "Lizenzpolitik" section
   (German, matching the existing doc language) documenting the per-license
   usage rules: permissive (MIT/ISC/BSD/BlueOak/Unlicense/0BSD/Python-2.0)
   used unmodified as libraries with attribution; Apache-2.0 additionally
   ships NOTICE files; CC-BY-4.0 data-only; LGPL-3.0-or-later libvips binary
   used unmodified and dynamically loaded by sharp (replaceable, not statically
   linked). CC-BY-4.0 and LGPL-3.0-or-later are RESTRICTED to their named
   packages and the check fails for any other package carrying them.
3. **Test-gate license check.** `docker-compose.test.yml` now runs
   `node scripts/dependency-licenses.mjs check` after the tests (before the
   i18n guard): fails on non-allowlisted licenses, missing license
   declarations, restricted-license misuse, or a stale notices doc. The
   generation is deterministic (explicit name+version sort, no
   localeCompare/readdir dependence). Root `package.json` gained
   `licenses:generate` / `licenses:check` scripts.
4. **Web-image license collection.** Next.js standalone output traces only
   runtime files and dropped all LICENSE texts (the web image previously
   shipped zero). `apps/web/Dockerfile` now runs
   `node ../../scripts/dependency-licenses.mjs collect --pnpm-dir
   /app/node_modules/.pnpm --out .../standalone/THIRD_PARTY_LICENSES` after
   `pnpm run build`. Verified in the rebuilt image: 220 dirs / 221 files /
   3.3 MB, zero empty entries; each package keeps its own license text in
   `<entry>/<package>/` subdirs (no overwrites – next and styled-jsx each ship
   their own MIT text, libvips ships its README documenting the bundled
   LGPLv3/MPL-2.0/BSD/MIT libraries).
5. **Build plumbing.** `Dockerfile.test` COPYs the script + notices doc into
   the test image; `.dockerignore` changed `docs/` to `docs/*` +
   `!docs/third-party-notices.md` so the notices file reaches the test image.

**Known debt / deferred items:**
- No automated unit tests for `scripts/dependency-licenses.mjs` (check
  allowlist/restricted/stale-doc and collect no-overwrite/symlink-skip) –
  explicitly deferred with reviewer permission. The next work package that
  touches this tooling should add a fixture-based test.
- Re-running the compose smoke test without `--clean` against a leftover DB
  (two active admins) makes step 8m ("DELETE /privacy/account should return
  409") fail with 204 – pre-existing script characteristic (stale state), NOT
  a regression. Always run `./scripts/compose-smoke-test.sh --build --clean`.

## Verification state of the BugFix-12 commit

- Full compose test gate (container): lint, typecheck, `pnpm run test` 5/5
  tasks (API 58 files / 660 tests, web 47, foundation 107, worker 4),
  `License check: OK` (578 packages), i18n guard OK.
- Compose smoke test (`--build --clean`): "All smoke tests passed".
- Web image verified: `THIRD_PARTY_LICENSES` per-package layout correct
  (next own MIT text, styled-jsx own license.md, libvips README, zero empty
  entries).
- Review loop: 2 rounds, acceptance met 0/0/0/4 (round 1: 1 High + 1 Medium +
  6 Minor, all fixed; round 2: 0/0/0/4, three Minors fixed after; 1 Minor
  deferred).

## No next work package exists

`prompts/` contains no further numbered work package after BugFix-11 (the
last file is `prompts/BugFix-11-release-readiness.md`); BugFix-12 was a
direct user request with no prompt file. All currently defined work packages
are committed (AP-01 … AP-21, BugFix-01 … BugFix-12).

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's next explicit instruction. If the user provides a new
numbered prompt file in `prompts/`, implement only that one and use the same
review loop (invoke the `code-reviewer` subagent via the Task tool on the
uncommitted diff, write each report verbatim to
`docs/reviews/<package>-review-<n>.md`, fix every Critical/High/Medium and
Minor where reasonable until 0 Critical / 0 High / 0 Medium / ≤ 8 Minor,
max 5 rounds, then commit with a message starting with the package number and
write a new handoff).

## Environment reminders for the next session (Podman host)

- `docker` is a Podman shim → podman-compose. Reuse stale containers after
  rebuilds: always `docker compose ... down` (or `down -v`) before `up`; the
  smoke script supports `--clean`. The test runner service has NO volume mount
  — source is baked into the image at build time, so any verification of
  host-side edits requires rebuilding the test image
  (`docker compose -f docker-compose.test.yml build test`).
- `docker-compose.test.yml` sets `name: versigo`, which collides with the dev
  stack project name: `docker compose -f docker-compose.test.yml down -v`
  tries to remove the dev network `versigo_versigo-internal` and errors.
  Workaround: run `down` (drop `-v`) or remove test containers manually.
- Node/pnpm are NOT on the host PATH; run gates via the test container.
- The `auth.service.ts ↔ oidc.strategy.ts` cycle is load-order fragile: a
  full API boot (real Nest bootstrap) is the ONLY check that proves it; the
  unit suites cannot.
- Disk on `/var/home` is ~123 GB and fills quickly; `podman system prune -a -f`
  before large rebuilds. Never redirect podman storage. Clean up all podman
  artifacts created during a session before the commit and verify
  `df -h /var/home` afterwards.
