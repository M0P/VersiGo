# Review 1 – BugFix-12 (Third-party license compliance)

Date: 2026-08-09
Reviewer: code-reviewer subagent (DeepSeek)
Scope: uncommitted changes of the license-compliance work package on branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub`.

## Review result (verbatim from the code-reviewer)

# Review result

## Summary
- Critical: 0
- High: 1
- Medium: 1
- Minor: 6
- Verdict: **CHANGES REQUIRED**

## Findings

- [High] `scripts/dependency-licenses.mjs:251-263` — collect mode loses/misattributes license texts because files are copied flat into the entry directory and overwrite each other
  - Evidence: `collectLicenses()` walks the *entire* `node_modules` of each store entry (including symlinked dependencies) and copies every match to `join(destDir, f)` — the bare filename. Packages with the same license filename overwrite each other. Verified concretely: the `next@16.2.12_…` entry's `node_modules` contains `next/` and `styled-jsx/`, both shipping `license.md` (confirmed present in both package dirs). The walk visits `next` before `styled-jsx` (alphabetical readdir order), so `styled-jsx/license.md` overwrites `next/license.md`, and `next` — a top-level dependency that appears in no other entry — has its license text shipped *nowhere* in the web image. The `LICENSE` files of react/postcss/sharp etc. likewise collapse into one file (sharp's). The resulting `THIRD_PARTY_LICENSES/next@…/license.md` is styled-jsx's MIT text, mislabeled as next's. This defeats the exact purpose of the step (the Dockerfile comment names "next, react, sharp, libvips/LGPL" as the reason it exists) and violates MIT's attribution requirement for next.js in the distributed image. The gate (`check`) cannot catch this because it only exercises generate/check.
  - Required fix: preserve per-package identity in the output — e.g. copy each license into a per-package subdirectory (`destDir/<package-name>/<filename>`, using the directory name relative to the entry's `node_modules`, resolving the `@scope/name` layout), or restrict the walk to the entry's own package directory plus a fixed mapping, so no file can overwrite another. Re-verify the built image contents afterward (every package that appears in the standalone bundle must have its own license text).

- [Medium] `scripts/dependency-licenses.mjs:190,205-211,358-360` — `check`'s byte-for-byte comparison is non-deterministic across filesystems (readdir order + locale-sensitive sort)
  - Evidence: the inventory sort uses `a.name.localeCompare(b.name)` (no explicit locale) and the summary table sorts only by count (stable sort keeps readdir-insertion order for ties); same-name/different-version pairs are ordered solely by store readdir order. The committed doc already proves the environment dependence: it lists `@angular-devkit/schematics@19.2.27` (line 168) before `@angular-devkit/schematics@19.2.24` (line 169), while the actual store on this host enumerates `@angular-devkit+schematics@19.2.24…/` before `@angular-devkit+schematics@19.2.27…/`. So the doc was generated in a different environment (container/overlayfs) than this host, and `readdirSync` order is not POSIX-guaranteed. Consequences: (a) the documented workflow in `docs/10-quality-and-library-policy.md` ("run `generate`", i.e. on the host) produces a different doc than the container, so the CI gate spuriously fails after an otherwise-correct regeneration; (b) `localeCompare` without an explicit locale can order differently under different `LANG`/ICU settings.
  - Required fix: make the generation deterministic and independent of the filesystem/locale — collect all packages, then sort by `(name, version)` with an explicit comparison (e.g. simple `<`/`>` on the string, or `localeCompare(b, 'en')`), and sort the summary table by `(count desc, license asc)` before emitting. Regenerate `docs/third-party-notices.md` with the fixed ordering and confirm `check` passes.

- [Minor] `docs/10-quality-and-library-policy.md:37-39` vs `scripts/dependency-licenses.mjs:29-41` — documented license restrictions are not enforced by the check
  - Evidence: the doc states CC-BY-4.0 is allowed "nur Datenpaket caniuse-lite" and LGPL-3.0-or-later "nur @img/sharp-libvips-linuxmusl-x64", but `ALLOWED_LICENSES` is a global set and `allowlistViolations()` only tests set membership. A future dependency with CC-BY-4.0 or LGPL-3.0 would pass `check` without any special-case approval, contradicting the documented policy.
  - Required fix: either make the policy match the implementation (document that these licenses are allowed generally) or enforce the restriction in the script (allow them only for the named packages in `SPECIAL_CASES`/`KNOWN_LICENSES`, failing otherwise).

- [Minor] `scripts/dependency-licenses.mjs:251-264` — `walk()` follows symlinks (`statSync` without `lstat`), enabling redundant traversal into `.bin` and dependency symlinks, and theoretically unbounded recursion on a symlink cycle in the store
  - Evidence: `statSync(full)` follows symlinks, so the walk descends into every symlinked dependency dir (and `.bin`). This is what causes the overwrite behavior above and does extra I/O (578 entries × dependencies). A hypothetical A→B→A cycle in the store would recurse infinitely and crash the build.
  - Required fix: use `lstatSync` and skip symlinks, and only walk the entry's own package directory (or bound the walk with a visited-set). This also simplifies the fix for the High finding.

- [Minor] `scripts/dependency-licenses.mjs:268` — README/NOTICE fallback picks an arbitrary package directory when an entry has no license file
  - Evidence: `pkgDirs.find((p) => existsSync(p)) ?? pkgDirs[0]` returns the first directory in readdir order, which for an entry with several packages may be a dependency rather than the entry's own package; the README/NOTICE then documents the wrong package. Currently only triggered for stub packages whose entries contain a single package, so no present-day impact.
  - Required fix: derive the package directory from the entry name (mapping `name+version`/`@scope+name@version` back to `@scope/name` or `name`), falling back only if that exact directory is absent.

- [Minor] `package.json:13-22` — no npm script wrapper for the license tool
  - Evidence: the tool is invoked only via full path (`node scripts/dependency-licenses.mjs …`) in Dockerfiles and docs; there is no `licenses:generate` / `licenses:check` script for local use, reducing discoverability and making the documented `generate` step easy to run from the wrong cwd.
  - Required fix: add `"licenses:generate"` and `"licenses:check"` scripts (and optionally `"licenses:collect"`) to the root `package.json` and reference them in `docs/10-quality-and-library-policy.md`.

- [Minor] `scripts/dependency-licenses.mjs:339,344` — generate/check resolve `docs/third-party-notices.md` relative to `process.cwd()`
  - Evidence: `join(process.cwd(), 'docs', 'third-party-notices.md')` silently targets the wrong file if the script is run from a subdirectory (`cd apps/web && node ../../scripts/… generate` would write into `apps/web/docs/…`); in `check` this silently reports "missing" or compares against a stale file. The `collect` mode correctly takes explicit `--pnpm-dir`/`--out`.
  - Required fix: resolve the docs path relative to the script location (`import.meta.url` / `fileURLToPath`) so it is independent of the caller's cwd.

- [Minor] `docker-compose.test.yml:60` — no automated test for the script, and the gate never exercises the `collect` mode
  - Evidence: the gate runs only `check` (which regenerates and compares the doc). The `collect` mode — the most complex and, per the High finding, the buggy part — is exercised only inside the web image build (smoke test), and the smoke test never inspects the *content* of `THIRD_PARTY_LICENSES`. This is how the license-overwrite bug shipped despite "all gates pass".
  - Required fix: add a small unit/integration test that runs the script against a fixture store and asserts (a) `check` fails on a non-allowlisted license, a missing license, and a stale doc; (b) `collect` preserves every package's license file (no overwrite), including a fixture with two packages sharing a license filename. Acceptable to defer to the next work package, but the current package is the one that should verify its own core behavior.

## Verification
- **Tests/checks reviewed:** the full `docker-compose.test.yml` gate chain (prisma migrate → lint → typecheck → tests → license check → i18n guard) and `scripts/compose-smoke-test.sh` (web build exercises `collect`). The gate and smoke test reportedly pass; I could not execute them (no node/docker in this environment, read-only review).
- **Areas inspected:**
  - Store layout: `node_modules/.pnpm` entries confirmed as `<entry>/node_modules/{@scope/name|name}`; scan logic correctly handles scoped dirs one level below, and correctly skips `lock.yaml` and the hoisted `node_modules/` entry. 578 packages counted matches the store (580 entries − 2 non-package entries) and the doc's "Total: 578".
  - Special cases verified against actual package.json: `@img/sharp-libvips-linuxmusl-x64` (LGPL-3.0-or-later), `pause` (no license → KNOWN_LICENSES MIT), `busboy`/`streamsearch`/`passport-strategy` (deprecated `licenses` array), `caniuse-lite` (CC-BY-4.0), `argparse` (Python-2.0) — all accurate. The libvips README confirms the bundled LGPLv3/MPL-2.0/BSD/MIT libraries; the LGPL dynamic-loading claim is a reasonable reading (unmodified binary, `dlopen` by sharp, replaceable via npm update, license text shipped).
  - Docker: web `collect` invocation paths are correct (`cd apps/web` → `../../scripts/…`, `--pnpm-dir /app/node_modules/.pnpm`, output inside standalone tree copied to runner). `.dockerignore` negation (`docs/*` + `!docs/third-party-notices.md`) is valid Docker syntax and reaches the test image; test Dockerfile COPYs the script and doc into the expected cwd-relative paths.
  - Security: no `child_process`/shell usage; `--pnpm-dir`/`--out` values come from fixed Dockerfile args; `readdirSync`-derived names cannot contain path separators, so no path traversal or shell injection was found.
- **Remaining risks:**
  - The claim that Next.js standalone tracing drops LICENSE files (and the "220 dirs / 272 files / 2.7 MB" figure) could not be verified without a build; if the standalone output does retain license files, the collect step is redundant but harmless — however the overwrite bug still mislabels content.
  - The doc claims "API 172 / Worker 155" license-file spot counts are unverifiable here but plausible given `pnpm deploy --prod` copies the runtime node_modules.
  - The byte-for-byte gate will keep passing only as long as `generate` and `check` run in identical filesystem environments (see Medium finding).

**Verdict: REQUEST CHANGES** — acceptance summary: Critical 0, High 1, Medium 1, Minor 6 (≥1 High/Medium ⇒ CHANGES REQUIRED; the High collect bug must be fixed and the check made deterministic before this package can be approved).

---

## Resolution notes (implementer)

All Critical/High/Medium findings and all reasonable Minor findings were fixed:

- **[High]** Fixed: `collectLicenses` rewritten to copy each package's license
  texts into its own subdirectory (`THIRD_PARTY_LICENSES/<entry>/<package>/…`),
  deriving package dirs via `packageDirsOfEntry()` from the entry's own
  `node_modules` (skipping symlinked dependencies), and de-duplicating
  same-named files. Verified in the rebuilt web image: `next` keeps its own
  `LICENSE` + `license.md` (MIT), `styled-jsx` its own `license.md`,
  `@img/sharp-libvips-linuxmusl-x64` ships its README, zero empty entries
  (222 files, 3.3 MB, 220 dirs).
- **[Medium]** Fixed: deterministic ordering — explicit `(name, version)`
  string comparison (`comparePackages`) and `(count desc, license asc)` for
  the summary table; no `localeCompare`. Regenerated
  `docs/third-party-notices.md`; `check` passes byte-for-byte and is now
  filesystem/locale independent (verified by running `check` from `/app` in
  the container).
- **[Minor: doc vs impl]** Fixed: `RESTRICTED_LICENSES` map — CC-BY-4.0 only
  for `caniuse-lite`, LGPL-3.0-or-later only for
  `@img/sharp-libvips-linuxmusl-x64`; `allowlistViolations()` now fails for
  any other package carrying these licenses. Policy doc updated to match.
- **[Minor: symlinks]** Fixed: `lstatSync` + skip symlinks in both the entry
  enumeration and the file walk.
- **[Minor: arbitrary pkgDir]** Fixed: package dirs are derived from the
  entry's own `node_modules` layout (`@scope/name` / `name`), never an
  arbitrary readdir result.
- **[Minor: npm scripts]** Fixed: added `licenses:generate` /
  `licenses:check` to root `package.json`; policy doc references them.
- **[Minor: cwd-relative path]** Fixed: `NOTICES_DOC_PATH` resolved via
  `import.meta.url` (script-relative, not cwd-relative); `findStoreDir()`
  walks up from cwd to the workspace root.
- **[Minor: automated tests]** Deferred by explicit reviewer permission
  ("Acceptable to defer to the next work package") — out of scope for this
  package. Mitigated manually: collect output verified against the real
  store and the rebuilt web image (per-package identity, no overwrites).

Re-verification after fixes: full `docker-compose.test.yml` gate green
(lint/typecheck/tests 5/5: API 660, web 47, foundation 107, worker 4;
license check OK on 578 packages; i18n guard OK) and
`scripts/compose-smoke-test.sh --build --clean` → "All smoke tests passed".

(One intermediate smoke-test failure "DELETE /privacy/account should return
409 ... got 204" occurred when re-running the smoke test without `--clean`
against a leftover DB with two active admins — pre-existing script
characteristic, not a regression; a `--clean` run passes.)
