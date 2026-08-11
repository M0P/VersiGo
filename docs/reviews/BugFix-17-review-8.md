# BugFix-17 – Review Round 8 (split reviews)

## 8A: scripts/bump-version.mjs
- Critical: 0, High: 0, Medium: 0, Minor: 2 — Verdict: PASS
- [Minor] replaceToken only proves at least one replacement happened, not that
  every occurrence was replaced (a drifted superset surviving the lookahead
  would be left behind while reporting success).
- [Minor] "re-run this script to repair" advice is wrong for the partial-write
  case (root package.json is already on the new version, so a re-run fails).

## 8B: scripts/check-version-sync.mjs
- Critical: 0, High: 0, Medium: 0, Minor: 2 — Verdict: PASS
- [Minor] Non-string `version` value (e.g. 42) bypasses the guard and crashes
  with a raw TypeError at version.replace(...).
- [Minor] Empty if-branch containing only a comment (inverted form would be
  clearer).

## Fix status
All 4 findings fixed:
- replaceToken re-scan was replaced by a PRE-CHECK approach in round 7; the
  round-8 finding about "every occurrence" was resolved by the pre-check (any
  superset drift aborts before writing) plus the anchored global replacement.
- The partial-write advice now says: run the sync check, restore the
  already-written files (git checkout), then re-run.
- check-version-sync.mjs: root version validated as non-empty string; the
  .env.example block inverted to `if (content !== null)`.
