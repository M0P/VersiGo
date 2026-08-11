# BugFix-17 – Review Round 7 (split reviews)

## 7A: scripts/bump-version.mjs (full file)
- Critical: 0, High: 0, Medium: 1, Minor: 1 — Verdict: CHANGES REQUIRED
- [Medium] Unanchored literal `replaceAll` can silently corrupt files when a
  target already contains a string-superset of the current version (drift
  scenario, e.g. `...beta.10` next to `...beta.1` -> `...beta.100`); no
  fail() fires. The .env.example transform was hardened but compose and
  licenses/notices replacements were not.
- [Minor] Write loop has no error handling; a mid-loop I/O failure leaves a
  partially bumped tree (documented limitation).

## 7B: scripts/check-version-sync.mjs
- Critical: 0, High: 0, Medium: 1, Minor: 2 — Verdict: CHANGES REQUIRED
- [Medium] `.env.example` is read with the unguarded `read()`, not
  `readChecked()` — a missing file still crashes with a raw stack trace.
- [Minor] Root package.json read/parse is unguarded (missing file, malformed
  JSON, or missing/non-string version field -> raw stack trace / TypeError).
- [Minor] `readChecked` references `problems` declared later (safe today,
  fragile ordering).

## 7C: docs + git state
Returned empty (no shell tool in the reviewer environment). The git-state
verification (untracked scripts, .env.test, stale-version grep) was performed
by the implementer instead; see the commit-time checks.

## Fix status
All 7A/7B findings fixed:
- replaceToken() now uses a PRE-CHECK: `new RegExp(escaped + '[0-9A-Za-z.-]')`
  aborts before any write when the search token is followed by a version-like
  character (superset drift), then does the anchored replacement.
- Write-loop error message and header comment now instruct: run the sync
  check, restore already-written files (e.g. via git checkout), then re-run.
- check-version-sync.mjs: readChecked() everywhere, root JSON guard with
  version-type validation, `const problems = []` moved above readChecked.
- Compose check skips comment lines and compares occurrence counts between the
  two compose files.
