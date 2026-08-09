# Review 2 – BugFix-12 (Third-party license compliance)

Date: 2026-08-09
Reviewer: code-reviewer subagent (DeepSeek)
Scope: uncommitted changes of the license-compliance work package on branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub` after fixing all
round-1 findings.

## Review result (verbatim from the code-reviewer)

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 4
- Verdict: **APPROVE** (PASS)

All findings from review round 1 (1 High, 1 Medium, 6 Minor) are verified as fixed. The rewrite introduces no new Critical/High/Medium defects; only four Minor robustness notes remain, none blocking.

## Findings

- [Minor] `scripts/dependency-licenses.mjs:318` — license-file regex also matches non-license filenames
  - Evidence: `/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|UNLICENSE|License)/i` is a prefix match, so any file whose name starts with "license" (e.g. `licenses.json`, `license-map.json`) is copied as a license text. Harmless over-inclusion (extra file in the image), but imprecise.
  - Required fix: anchor the match to the full token, e.g. `/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|UNLICENSE)(\..*)?$/i` or check `f.toLowerCase().startsWith('license')` only for known suffixes.

- [Minor] `scripts/dependency-licenses.mjs:385` — README fallback is case-sensitive (`README.md` only)
  - Evidence: `existsSync(join(pkgDir, 'README.md'))` matches only the exact uppercase name. `pause@0.0.1` ships `Readme.md` (mixed case) and no license file, so it falls through to `writeMissingLicenseNotice` instead of shipping its README. No current package in the web store is affected (all checked stubs use `README.md`), but the full-store collect hits this for `pause`.
  - Required fix: probe case-insensitively (e.g. `readdirSync(pkgDir).find(f => f.toLowerCase() === 'readme.md')`) before falling back to the NOTICE.

- [Minor] `scripts/dependency-licenses.mjs:342` — `String(json.license)` renders object-form licenses as `[object Object]`
  - Evidence: `writeMissingLicenseNotice` uses `String(json.license)`; a package declaring `"license": {"type": "MIT", "url": "…"}` would produce `License: [object Object]` in the NOTICE.txt. Also, for packages with no license field (e.g. `pause`), the NOTICE states "License: unknown" and claims the license "is declared in package.json", which is inaccurate for that legacy package.
  - Required fix: reuse `normalizeLicense(json.license)` (or `json.license?.type`) and adjust the NOTICE wording for the no-declared-license case.

- [Minor] `scripts/dependency-licenses.mjs` (whole file) — no automated test for the script; `collect` still only exercised via the web image build
  - Evidence: the gate runs only `check`; `collect` is exercised only inside the web Dockerfile and the smoke test never inspects `THIRD_PARTY_LICENSES` content. This was explicitly deferred in review 1 ("acceptable to defer to the next work package") and the implementer performed thorough manual verification (per-package identity in the rebuilt image, 578/582 file-count match, container determinism check). Acceptable to keep deferred, but the next work package should add a fixture-based test for `check` (allowlist/restricted/stale-doc) and `collect` (no-overwrite, symlink-skip).
  - Required fix: add a small unit test against a fixture store in the next work package.

## Verification

**High fix (per-package identity, no overwrites) — VERIFIED:**
- `collectLicenses` writes each package to `THIRD_PARTY_LICENSES/<entry>/<pkgRelPath>/`; `pkgRelPath` is derived via `relative(nodeModules, pkgDir)` and is unique per package within an entry, so no cross-package collision is possible.
- `packageDirsOfEntry` uses `lstatSync` and skips symlinks at both the top level and inside `@scope` subdirectories (verified against the real store: `next@…/node_modules` contains `next/` real plus symlinked deps; `@next/` scope contains symlinks `env`/`swc-linux-x64-musl` which are skipped).
- `copyLicenseFiles` uses `lstatSync`, skips symlinks, and never overwrites an existing destination file (first-wins de-dup within a package).
- The review-1 collision (next vs styled-jsx `license.md`) is resolved: each package's license is collected from its own store entry.

**Medium fix (determinism) — verified:**
- `comparePackages` uses explicit `<`/`>` string comparison on (name, version); summary table sorted by (count desc, license asc); license groups sorted by license then package; special cases sorted by name. No `localeCompare`, no reliance on readdir/insertion order.
- The committed doc confirms the fix: `@angular-devkit/core@19.2.24` precedes `19.2.27`; summary ties (`0BSD`, `CC-BY-4.0`, `LGPL-3.0-or-later`, `Python-2.0`) are alphabetically ordered.

**Restricted-license enforcement — VERIFIED:**
- `RESTRICTED_LICENSES` maps CC-BY-4.0 → `caniuse-lite` only and LGPL-3.0-or-later → `@img/sharp-libvips-linuxmusl-x64` only; `allowlistViolations` fails any other package carrying these licenses. The logic cannot falsely pass (non-allowlisted, missing, or restricted-misused licenses all produce violations).
- The current store contains exactly one CC-BY-4.0 (`caniuse-lite@1.0.30001806`) and one LGPL-3.0-or-later (`@img/sharp-libvips-linuxmusl-x64@1.3.2`) — confirmed by direct package.json reads; the doc's summary (578 total; MIT 482, Apache-2.0 35, ISC 28, BSD-2-Clause 12, BSD-3-Clause 10, BlueOak-1.0.0 5, Unlicense 2, 0BSD 1, CC-BY-4.0 1, LGPL-3.0-or-later 1, Python-2.0 1) sums to 578 and matches the store's 578 package entries (580 entries − `lock.yaml` − hoisted `node_modules`).

**Other fixes verified:** `NOTICES_DOC_PATH` script-relative via `import.meta.url`; `findStoreDir` walks up from cwd; npm scripts `licenses:generate`/`licenses:check` added; policy doc (`docs/10-quality-and-library-policy.md`) matches the implementation (allowlist vs restricted, per-package collect layout); `.dockerignore` negation (`docs/*` + `!docs/third-party-notices.md`) is valid and reaches the test image; `Dockerfile.test` COPYs script + doc to the paths the gate expects; web Dockerfile collect invocation paths and `--pnpm-dir`/`--out` are correct; gate chain order (tests → license check → i18n) is correct.

## Verification
- **Tests/checks reviewed:** full `docker-compose.test.yml` gate chain (implementer-reported green: lint, typecheck, API 660 / web 47 / foundation 107 / worker 4 tests, license check OK on 578 packages, i18n guard) and `compose-smoke-test.sh --build --clean` (reported green). I could not execute them (read-only, no docker/node in this environment).
- **Areas inspected:** the complete rewritten `scripts/dependency-licenses.mjs` (464 lines); the store layout (`node_modules/.pnpm`, 580 entries incl. `lock.yaml` + hoisted `node_modules`); per-package license spot-checks (`caniuse-lite`, `@img/sharp-libvips-linuxmusl-x64`, `pause`, `busboy`, `minipass`, `fs-monkey`, `@esbuild/linux-x64`, `@turbo/linux-64`, `@next/swc-linux-x64-musl`, `@rollup/rollup-linux-x64-musl`, `@msgpackr-extract/…`, `@img/sharp-linuxmusl-x64`); the generated `docs/third-party-notices.md` (672 lines, ordering and counts); both Dockerfiles, `Dockerfile.test`, `docker-compose.test.yml`, `.dockerignore`, `package.json`, policy doc, and the review-1 report.
- **Remaining risks:** (1) `collect` has no automated test and the smoke test does not inspect `THIRD_PARTY_LICENSES` content — deferred with permission, should be added next work package; (2) the byte-for-byte doc gate depends on the doc being regenerated whenever the lockfile changes (intended behavior); (3) `scanStore` reads package.json through symlinked deps (redundant I/O, correct due to name@version dedup — pre-existing, not a regression).

**Verdict: APPROVE** — Critical 0, High 0, Medium 0, Minor 4 (all non-blocking robustness notes).

---

## Resolution notes (implementer)

Three of the four Minor findings were fixed in the same package (they are
small, safe, and directly improve the artifact):

- **[Minor: regex over-inclusion]** Fixed — anchored the license-file pattern:
  `/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|UNLICENSE)(\..*)?$/i`, so
  files like `licenses.json` are no longer collected as license texts.
- **[Minor: case-sensitive README fallback]** Fixed — README is now probed
  case-insensitively (`readdirSync(pkgDir).find(f => f.toLowerCase() ===
  'readme.md')`), so legacy packages shipping `Readme.md` (e.g. `pause@0.0.1`)
  ship their README instead of a NOTICE.txt. Verified: `pause` entry now
  contains `README.md`.
- **[Minor: `String(json.license)`]** Fixed — `writeMissingLicenseNotice` now
  reuses `normalizeLicense(json.license ?? json.licenses)` (object-form
  licenses render correctly) and the NOTICE wording no longer claims the
  license "is declared in package.json" when it is not declared.
- **[Minor: no automated test]** Deferred to the next work package, with the
  reviewer's explicit permission; mitigated manually: `generate`+`check` run
  deterministically in the container (OK on 578 packages), `collect` output
  verified against the full store (580 files on disk = 580 reported, zero
  empty entries, per-package identity for next/styled-jsx/libvips/pause) and
  in the rebuilt web image (220 dirs / 221 files / 3.3 MB, zero empty
  entries).

Final re-verification after the Minor fixes: full `docker-compose.test.yml`
gate green (lint/typecheck/tests 5/5: API 660, web 47, foundation 107,
worker 4; license check OK on 578 packages; i18n guard OK) and
`scripts/compose-smoke-test.sh --build --clean` → "All smoke tests passed".

## Acceptance condition
- Critical: 0 ✓
- High: 0 ✓
- Medium: 0 ✓
- Minor: 4 (≤ 8, three fixed after this round) ✓
- Automated checks pass ✓

**MET.**
