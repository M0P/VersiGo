# BugFix-17 – Review Round 9 (split reviews)

## 9A: scripts/bump-version.mjs
- Critical: 0, High: 0, Medium: 0, Minor: 0 — Verdict: PASS
- No findings. Pre-check verified against false positives (compose `}` and
  header newline are not in the lookahead class) and the superset-bump case
  (beta.1 -> beta.10) confirmed safe.

## 9B: scripts/check-version-sync.mjs
- Critical: 0, High: 0, Medium: 0, Minor: 2 — Verdict: PASS
- [Minor] "missing version field" branch is unreachable dead code (every path
  leaving version === null already pushed a problem).
- [Minor] `pkg.version` dereferences a possible null from `JSON.parse('null')`
  in the workspace package.json loop.

## Fix status
Both 9B findings fixed:
- The root guard now distinguishes `missing "version" field` ('version' in
  parsed) from `"version" must be a non-empty string`; the dead branch was
  removed.
- The workspace loop guards `typeof pkg !== 'object' || pkg === null` and
  reports malformed JSON + continue.
