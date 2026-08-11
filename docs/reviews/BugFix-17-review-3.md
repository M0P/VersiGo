# BugFix-17 – Review Round 3

## Result
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Findings
- [Minor] `docs/docker-image-guide.md:359` — rollback example referenced the
  wrong Compose file: `docker-compose.yml / .env` should be
  `docker-compose.dockerhub.yml / .env` (docker-compose.yml builds from source
  and does not consume VERSIGO_IMAGE_TAG).
- [Minor] `scripts/bump-version.mjs` — "detect and repair" wording was
  inaccurate: the sync check only detects (exit 1 with a list), it never
  repairs.

## Fix status
Both fixed (comment now names docker-compose.dockerhub.yml; the note now says
"detect any remaining mismatch (re-run this script to repair)").
