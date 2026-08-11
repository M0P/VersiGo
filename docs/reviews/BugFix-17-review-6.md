# BugFix-17 – Review Round 6 (split reviews)

The monolithic review exceeded the reviewer's step limit (returned empty), so
the round was split into six focused sub-reviews.

## 6A: scripts/bump-version.mjs (lines 1-100)
- Critical: 0, High: 0, Medium: 0, Minor: 3 — Verdict: PASS
- [Minor] VERSION_PATTERN is not strict semver (leading zeros accepted, no
  "+build"); documented as a deliberate relaxation ("semver-ish").
- [Minor] `process.argv[2]` not trimmed (confusing error on whitespace).
- [Minor] No error handling for missing/malformed files in readJson/stage
  (raw stack trace instead of the clean ERROR message).

## 6B: scripts/check-version-sync.mjs
- Critical: 0, High: 0, Medium: 1, Minor: 3 — Verdict: CHANGES REQUIRED
- [Medium] Header lookahead class `[0-9A-Za-z.-]` misses `+`, so semver build
  metadata (e.g. `v1.0.0-beta.2+meta`) supersets pass the check.
- [Minor] Missing files / invalid JSON throw an uncaught exception with a raw
  stack trace.
- [Minor] Compose `includes()` check can be satisfied by a comment or by a
  single service occurrence.
- [Minor] Header regex is not anchored to the header line.

## 6C: scripts/bump-version.mjs (lines 100-168)
- Critical: 0, High: 0, Medium: 0, Minor: 1 — Verdict: PASS
- [Minor] CRLF tolerance drops `\r` from replaced `.env.example` lines,
  producing mixed line endings on CRLF checkouts.

## 6D (C1): git status + version consistency
- Critical: 0, High: 0, Medium: 1, Minor: 2 — Verdict: CHANGES REQUIRED
- [Medium] Both scripts must be committed with this package or CI fails at the
  Dockerfile.test COPY step (process item, resolved at commit).
- [Minor] docs/release-guide.md:151 references release-notes-v1.0.0-beta.1.md
  (historical filename reference, outside the excluded paths).
- [Minor] `.env.test` is not gitignored and contains test credentials —
  verified: it is already tracked since BugFix-02 (pre-existing, not part of
  this package's diff; left untouched).
- Verified: all 5 package.json files, both compose files (3 occurrences each),
  .env.example, licenses header and notices doc at 1.0.0-beta.2; spec fixtures
  and schema comment updated; no stale 1.0.0-beta.1 outside historical docs.

## 6E (C2): documentation changes
- Critical: 0, High: 0, Medium: 0, Minor: 2 — Verdict: PASS
- [Minor] docker-image-guide.md:362 rollback `docker compose up -d` omits
  `-f docker-compose.dockerhub.yml` (the stack that consumes
  VERSIGO_IMAGE_TAG).
- [Minor] release-guide.md:180 "every location that carries the version" is
  slightly overstated (the scripts' own example comments carry the version and
  are not bumped).

## 6F (C3): CI test-gate wiring
- Critical: 0, High: 0, Medium: 0, Minor: 1 — Verdict: PASS
- [Minor] release-guide.md:26 gate comment omits the license check and the
  version sync check.
- Verified: Dockerfile.test COPYs cover every file the script reads; the sync
  check runs chained with `&&` (failure exits non-zero, fails the gate);
  version:bump/version:check scripts present in package.json.

## Fix status
All findings fixed (rounds 7-10).
