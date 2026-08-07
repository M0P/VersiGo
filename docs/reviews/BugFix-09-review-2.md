# BugFix-09 Review – Round 2

Date: 2026-08-07
Reviewed changes: uncommitted work package BugFix-09 (branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub`, base `4cd3032`),
including the round-1 fixes
Reviewer: code-reviewer subagent (Task tool, read-only)

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: PASS

## Findings

- [Minor] `docs/release-notes-template.md:106` — Inconsistent namespace prefix on the image list
  - Evidence: The line reads `m000p/versigo-api:v1.0.0-beta.X`, `versigo-worker`, `versigo-web`, `versigo-migration`. Only the first image carries the full `m000p/` namespace and version tag; the other three are bare names. The round-1 required fix explicitly suggested `m000p/versigo-api:<version>`, `m000p/versigo-worker:<version>`, `m000p/versigo-web:<version>`, `m000p/versigo-migration:<version>`. The core Medium issue (stale ghcr.io reference) is resolved — the line now points to Docker Hub and the `publish.yml` workflow — but a maintainer copying this template verbatim would emit three image references without the `m000p/` namespace, which would not resolve on Docker Hub.
  - Required fix: Prefix all four images with `m000p/` (e.g. `m000p/versigo-api:v1.0.0-beta.X`, `m000p/versigo-worker:v1.0.0-beta.X`, `m000p/versigo-web:v1.0.0-beta.X`, `m000p/versigo-migration:v1.0.0-beta.X`) for consistency with `publish.yml` and `docs/docker-image-guide.md` §4.1.

No Critical, High, or Medium findings.

## Verification of the three round-2 fixes

1. **release-notes-template.md:106 (was Medium)** — Fixed: now references Docker Hub `m000p/versigo-*` and points to `.github/workflows/publish.yml`. Only remaining issue is the Minor namespace-prefix inconsistency above.
2. **release-guide.md §3 (was Minor)** — Fixed: lines 70–77 state the automated workflow publishes to Docker Hub only (`m000p/versigo-<service>:<version>` + `:latest`); lines 91–95 annotate the GHCR subsection as an optional manual path ("Docker Hub only. GHCR is not used by the project"). Correct and complete.
3. **publish.yml tag extraction (was Minor)** — Fixed and correct:
   - `if [ "${{ github.event_name }}" = "push" ]` correctly distinguishes tag push (`push`) from `workflow_dispatch`.
   - Tag push: `TAG="${GITHUB_REF_NAME#v}"` yields `<version>`; `push_latest=true`.
   - Manual dispatch: `TAG="manual-${GITHUB_SHA::8}"` — valid bash substring expansion on `ubuntu-latest` (bash default); `push_latest=false`; never overwrites `:latest`; never uses branch names (which may contain `/`).
   - `GITHUB_OUTPUT` usage is the correct modern mechanism.
   - Conditional `:latest` line: `${{ steps.meta.outputs.push_latest == 'true' && format('{0}/{1}-{2}:latest', ...) || '' }}` is a valid GitHub expression; when false it evaluates to `''` (empty line), which the build-push-action tag parser (`@docker/actions-toolkit` `getList`, `skipEmptyLines: true`) safely ignores. No other place in the workflow retains unconditional `:latest`/branch-name behavior.

### ghcr.io / m0p consistency sweep
- `ghcr` matches remain only in: the work-package prompt (`prompts/BugFix-09-…`), the `NEXT-CODING-AGENT-PROMPT.md` handoff (which embeds the pre-fix prompt text describing the old state), the round-1 review report, and the release-guide GHCR section (now explicitly annotated as an optional manual path). None contradict the new Docker Hub-only scheme.
- **`m0p` (without the three zeros): no matches anywhere** in the repo.
- `versigo-api:v1`/`versigo-worker:v1`/`versigo-web:v1` stale references: only in the round-1 review report and the now-fixed release-notes template.
- `docker-compose.dockerhub.yml` uses `m000p/versigo-{migration,api,worker,web}` consistently with `publish.yml`; no `build:`/`context:`/`dockerfile:` references; migration runs before api/worker via `service_completed_successfully`.
- `docker-compose.yml` (build-from-source) retains only `docker.io/postgres`, `docker.io/redis`, `docker.io/minio` base images — no registry contradiction.
- `.env.example` documents `VERSIGO_IMAGE_TAG` for the Docker Hub deployment stack.

### Acceptance re-check
- CI regression guard present: `ci.yml` `compose-smoke` job boots the API and hits `/health` (lines 109–126) with an explicit BugFix-09 comment; `compose-test` also validates `docker-compose.dockerhub.yml` (lines 32–33).
- Community files present: `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`, `.github/pull_request_template.md`.
- README fully English, warning box preserved (lines 3–11, including the "must not be relativized" clause), quick start deploys from Docker Hub images without rebuild.
- `publish.yml` publishes to Docker Hub on version release with the user-confirmed `m000p/versigo-*` scheme; docs updated accordingly.

### Sanity check of the diff
I could not run `git status`/`git diff` (no bash tool in this session). I inspected the working tree directly; no stray files or unrelated changes were evident in the files reviewed. This is the one limitation of this round — the diff itself was not machine-verified, only the resulting file states.

## Summary table

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Minor    | 1 |
| **Total**| **1** |

**Verdict: APPROVED** (0 Critical / 0 High / 0 Medium / 1 Minor ≤ 8). The single Minor finding is non-blocking; all three round-1 findings are correctly resolved and no new issues were introduced.

---

## Resolution status (round 2)

- **[Minor] FIXED** — `docs/release-notes-template.md:106` now prefixes all
  four image references with the `m000p/` namespace
  (`m000p/versigo-{api,worker,web,migration}:v1.0.0-beta.X`), matching
  `publish.yml` and `docs/docker-image-guide.md` §4.1.

Final review counts: **0 Critical / 0 High / 0 Medium / 0 Minor** —
acceptance condition met after round 2.
