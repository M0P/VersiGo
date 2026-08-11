# BugFix-17 – Review Round 2

## Result
- Critical: 0
- High: 0
- Medium: 0
- Minor: 3
- Verdict: PASS

## Findings
- [Minor] `docs/docker-image-guide.md:360` — rollback example used the wrong
  env var name: `IMAGE_TAG` instead of `VERSIGO_IMAGE_TAG` (the variable
  consumed by docker-compose.dockerhub.yml and documented in .env.example:71).
- [Minor] `scripts/check-version-sync.mjs:74-75` — version interpolated into a
  RegExp without escaping (latent; safe for the current charset).
- [Minor] `scripts/bump-version.mjs:141-144` — write phase not fully atomic on
  I/O failure (documented limitation; check-version-sync.mjs is the safety
  net).

## Fix status
All 3 fixed.
- docker-image-guide.md now uses `VERSIGO_IMAGE_TAG=1.0.0-beta.2` with a note
  that the publish workflow strips the leading "v".
- check-version-sync.mjs escapes the version before building the
  `^APP_VERSION=...$` / `^NEXT_PUBLIC_APP_VERSION=...$` patterns.
- bump-version.mjs documents the partial-write I/O caveat and points to the
  sync check.
