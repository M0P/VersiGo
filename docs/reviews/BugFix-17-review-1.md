# BugFix-17 – Review Round 1 (version maintenance tooling + bump to 1.0.0-beta.2)

Date: session history
Work package: single source of truth for the application version (root
package.json) with `scripts/bump-version.mjs` + `scripts/check-version-sync.mjs`,
version bump 1.0.0-beta.1 -> 1.0.0-beta.2, CI test-gate integration.

## Result
- Critical: 0
- High: 0
- Medium: 3
- Minor: 4
- Verdict: CHANGES REQUIRED

## Findings
- [Medium] `version:bump` / `version:check` scripts missing from root
  package.json (lost in an earlier `git checkout`).
- [Medium] `.env.example` APP_VERSION check had a substring false negative
  (APP_VERSION matching inside NEXT_PUBLIC_APP_VERSION).
- [Medium] "NEXT_PUBLIC_APP_VERSION baked at build time" claim was factually
  wrong (the version is injected at container STARTUP via
  apps/web/docker-entrypoint.sh writing /runtime-config.js; a restart with the
  new env value suffices, no rebuild).
- [Minor] Non-atomic partial application in bump-version.mjs.
- [Minor] IMAGE_TAG example format in docker-image-guide.md (publish workflow
  strips the leading "v"; dots remain).
- [Minor] No unit tests for the scripts (accepted per project convention).
- [Minor] release-guide section 7 did not mention manually-maintained
  locations.

## Fix status
All 7 findings fixed (details in the review rounds 2-5).
