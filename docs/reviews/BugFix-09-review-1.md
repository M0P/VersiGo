# BugFix-09 Review – Round 1

Date: 2026-08-07
Reviewed changes: uncommitted work package BugFix-09 (branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub`, base `4cd3032`)
Reviewer: code-reviewer subagent (Task tool, read-only)

## Review result

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 2
- Verdict: CHANGES REQUIRED

## Findings

1. **[Medium] `docs/release-notes-template.md:106` — stale ghcr.io image reference contradicts the new Docker Hub publishing**
   - Evidence: The scope (item 4) requires "Update `docs/docker-image-guide.md` and any docs that reference the registry/images, so docs and workflow agree." The release-notes template still lists `ghcr.io/<org>/versigo-api:v1.0.0-beta.X`, `versigo-worker`, `versigo-web` as the published images. The workflow now publishes to Docker Hub (`m000p/versigo-*`), so a maintainer copying this template into a release would publish wrong image references. This is a genuine doc/workflow inconsistency within the package's stated scope.
   - Required fix: Update line 106 to reference the Docker Hub images, e.g. `m000p/versigo-api:<version>`, `m000p/versigo-worker:<version>`, `m000p/versigo-web:<version>`, `m000p/versigo-migration:<version>` (and note the `latest` tag), matching `publish.yml` and `docs/docker-image-guide.md` §4.1.

2. **[Minor] `docs/release-guide.md:84-94` — GHCR publishing section remains**
   - Evidence: The user decided "Docker Hub only" and ghcr.io was removed from `publish.yml`, but `release-guide.md` still documents a "GitHub Container Registry (GHCR)" manual publishing path. It is framed as a generic manual option (alongside `myregistry.example`), so it is not strictly wrong, but it is inconsistent with the "Docker Hub only" decision and the updated workflow.
   - Required fix: Either remove the GHCR subsection or add a note that the automated release workflow publishes to Docker Hub only and that GHCR is an optional manual path.

3. **[Minor] `.github/workflows/publish.yml:66` — `workflow_dispatch` produces a branch-name tag and pushes `latest`**
   - Evidence: The tag is extracted with `TAG=${GITHUB_REF_NAME#v}`. On a tag push (`v1.2.3`) this correctly yields `1.2.3`. But on `workflow_dispatch`, `GITHUB_REF_NAME` is the **branch name** (e.g. `main` or `fix/BugFix-09-...`), not a version tag. The workflow would then push images tagged with the branch name **and** `:latest` to Docker Hub. If a user manually dispatches from a feature branch, `latest` could be overwritten with an unreleased build, and a branch name containing `/` (e.g. `fix/...`) is not a valid Docker tag, which would fail the push. The user kept `workflow_dispatch`, so this edge case is live.
   - Required fix: Guard the tag extraction for manual dispatch, e.g. only use `${GITHUB_REF_NAME#v}` when the trigger is a tag push, and for `workflow_dispatch` derive a safe tag (e.g. `manual-<sha>` or the branch name sanitized of `/`), or explicitly document that manual dispatch pushes `latest` from the selected branch. At minimum, avoid pushing `latest` on non-`main` manual dispatches.

## Verification
- **Tests/checks reviewed:** The work package reports all gates green (API vitest 654/58 files, web vitest 47, tsc/eslint/i18n, `docker compose config`, compose smoke test 31/31 with real Nest bootstrap in dev+prod). I could not re-run these (read-only review, no Docker/Podman execution), so I verified the underlying artifacts statically.
- **Load-order fix verified statically:** `apps/api/dist/apps/api/src/features/identity/auth.service.js` contains no top-level `require("./oidc.strategy")`; the lazy import is emitted inside the method as `await Promise.resolve().then(() => require('./oidc.strategy'))` (line 137). `oidc.strategy.js` retains the top-level VALUE import `const auth_service_1 = require("./auth.service")` (line 27), preserving `design:paramtypes` for Nest DI. `oidc.strategy.ts` is untouched. The method `bindOidcIdentityForUser` is `async`, so the `await import()` is load-order-safe.
- **publish.yml:** matrix (api/worker/web with empty target, migration with `migration` target) is correct; `target: ""` builds the default final stage (`runner`) for api/worker/web; tag extraction and secrets usage are correct; `permissions: contents: read` is acceptable for Docker Hub-only (no GHCR push).
- **docker-compose.dockerhub.yml:** image names match `publish.yml` (`m000p/versigo-{api,worker,web,migration}`); no `build:`/`context:`/`dockerfile:` references; migration runs before api/worker via `service_completed_successfully`; health checks, ports, volumes, and `VERSIGO_IMAGE_TAG` default are consistent with `docker-compose.yml`.
- **Community files:** LICENSE (AGPL-3.0, full text, copyright M0P), CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY.md (GHSA-only), CONTRIBUTING.md, issue templates, and PR template are present and consistent with the recorded user decisions.
- **README:** fully English; warning box preserved with equivalent meaning (verified against the original German wording in `prompts/AP-20-ready-up-for-version-1.md:70`); quick start deploys from Docker Hub images without rebuild.
- **Remaining risks:** The `workflow_dispatch` tag edge case (finding 3) and the two stale ghcr.io doc references (findings 1–2) are the only actionable items. No secrets were found in any changed file.

## Summary table

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 1 |
| Minor    | 2 |
| **Total**| **3** |

**Verdict: CHANGES REQUIRED** (1 Medium finding must be resolved before acceptance; the 2 Minor findings should be addressed where reasonable).

---

## Resolution status (round 1)

All three findings were fixed in round 1:

1. **[Medium] FIXED** — `docs/release-notes-template.md:106` now references
   `m000p/versigo-{api,worker,web,migration}` with `:latest` tags and points to
   the automated publish workflow.
2. **[Minor] FIXED** — `docs/release-guide.md` section 3 now states the
   automated workflow publishes to Docker Hub only (namespace `m000p`), and
   the GHCR subsection is marked as an optional manual path.
3. **[Minor] FIXED** — `publish.yml` tag extraction now distinguishes tag
   pushes (`<version>` + `:latest`) from manual `workflow_dispatch`
   (`manual-<short-sha>`, no `:latest` overwrite, no invalid branch-name
   tags); the header comment documents the behavior.
