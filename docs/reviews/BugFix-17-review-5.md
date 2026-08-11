# BugFix-17 – Review Round 5

## Result
- Critical: 0
- High: 0
- Medium: 0
- Minor: 4
- Verdict: PASS

## Findings
- [Minor] `scripts/bump-version.mjs` — partial `.env.example` update when only
  one of the two version lines matches (transform only failed when BOTH were
  missing).
- [Minor] Both scripts are untracked and must be `git add`-ed with the commit
  (Dockerfile.test COPYs check-version-sync.mjs; the CI gate runs it).
- [Minor] `scripts/check-version-sync.mjs` — licenses/notices header check used
  bare `includes()`, vulnerable to a string-prefix false negative
  (`VersiGo v1.0.0-beta.20` passes when root version is `1.0.0-beta.2`).
- [Minor] CRLF line endings not handled in either script (fail-safe, but the
  error messages would be confusing).

## Fix status
All 4 fixed:
- bump-version.mjs tracks appFound/webFound separately and fails unless BOTH
  lines were replaced.
- Both scripts will be committed with the package (verified at commit time).
- check-version-sync.mjs uses an anchored, escaped header regex with the
  lookahead class extended to `[0-9A-Za-z.+-]` (build metadata), anchored to
  the line start.
- bump-version.mjs strips a trailing `\r` before comparison and preserves it in
  the replacement; check-version-sync.mjs uses `\r?$` anchors.
