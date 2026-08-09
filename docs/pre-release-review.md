# Pre-Release Review – Findings before the first VersiGo release

**Date:** 2026-08-07
**Author:** coding agent (analysis only — **no changes made**)
**Method:** local repo inspection (branch `fix/BugFix-09-ci-fix-community-standards-dockerhub` @ `f8fcfbf`), GitHub REST API (public repo `M0P/VersiGo`), running test stack, `pnpm audit --prod`.

---

## 0. Status overview

| Area | Verdict |
|------|---------|
| Code quality gates | ✅ green (lint, typecheck, 654+47+105+4 unit tests, i18n, compose smoke 31/31) |
| Release mechanics on GitHub | ⚠️ last package not merged, no tag/release exists, publish never run |
| Security (deps) | ⚠️ 28 transitive advisories (1 critical), documented but drifted from checklist |
| Repo metadata | ⚠️ stale project name fallout (remote, README, description) |
| CI | ⚠️ one check failing on PR #28; dependabot PRs failing; reduced smoke in CI |

---

## 1. Release-blocking items (must be done before the first release)

### B1 – Merge PR #28 into `main`
- The BugFix-09/10 work (community standards, Docker Hub publish, Docker image size reductions) lives only on `fix/BugFix-09-ci-fix-community-standards-dockerhub` → open **PR #28**.
- `origin/main` is at `b00cb33` (BugFix-08 merge, PR #26). **No tag exists** (`git tag` empty, GitHub API `tags: []`, `releases: 0`).
- ➡️ Merge PR #28, then base the release on `main`.

### B2 – Decide version + create the first tag
- All packages are still `0.1.0` (root, api, worker, web, foundation); the checklist targets `v1.0.0-beta`.
- Release guide + publish.yml: pushing a tag `v*` triggers the Docker Hub publish of `m000p/versigo-<service>:<version>` + `:latest`.
- ➡️ Decide `v1.0.0-beta.1` vs `v1.0.0`, bump versions, tag `main`.

### B3 – Investigate the failing `github-advanced-security` check on PR #28
- PR #28 check runs: `compose-test` ✅, `compose-smoke` ✅, `build-metrics` ✅, `CodeQL` ✅, `Analyze (actions)` ✅, `Analyze (javascript-typescript)` ✅ — but **`github-advanced-security` FAILED**.
- Additionally the workflow run "Code scanning AI findings on PR #28" failed (run 31186564603).
- Code-scanning alert details require auth (API returned 401), so the content could not be read here.
- ➡️ Open the PR → Checks → failed check to see whether it is a real finding (fix it) or a job/config failure (repair the workflow).

### B4 – Docker Hub publish has never run
- `https://hub.docker.com/v2/repositories/m000p/versigo-api|worker|web|migration/tags/latest` → **404** for all four images.
- publish.yml needs repo secrets **`DOCKERHUB_USERNAME`** + **`DOCKERHUB_TOKEN`** (not verifiable here — check Settings → Secrets).
- ➡️ Before tagging: verify the `m000p` Docker Hub namespace exists, set the secrets, and run one `workflow_dispatch` test publish (it tags `manual-<sha>`, does not touch `:latest`).

### B5 – Dependency audit: 28 advisories, incl. 1 critical (all transitive)
Current `pnpm audit --prod`: **11 moderate / 16 high / 1 critical** (checklist R-12 still says 26 / 10 / 15 / 1 — numbers drifted).
- Critical: `tar` `<=7.5.20` via `apps__api>bcrypt>@mapbox/node-pre-gyp>tar` (GHSA-r292-9mhp-454m, patched `>=7.5.21`).
- High: next (web), sharp, esbuild, vite, vitest paths; Moderate: postcss via next, etc.
- Mitigation today: private, non-internet-reachable hosting (documented). `docker-compose.dockerhub.yml` exposes only web/API ports by default, so exposure is limited — but a public first release should either
  - bump `bcrypt` (or override `tar` to `>=7.5.21` via pnpm `overrides`/`pnpm.onlyBuiltDependencies`), and
  - bump `next`/`sharp`/`postcss` where a newer minor/patch is clean,
  - then re-run `pnpm audit --prod` and update checklist R-12.
- ➡️ Decide: fix the critical now, or explicitly accept + update the checklist.

---

## 2. Recommended before the release (should do)

### R1 – Finish the repository rename `insura` → `VersiGo`
The GitHub repo was renamed to **`M0P/VersiGo`** (old URL 301-redirects). Leftovers:
- Local `git remote origin` still points to `https://github.com/M0P/insura.git` → `git remote set-url origin https://github.com/M0P/VersiGo.git`.
- `README.md` lines 36–37 and 136–137 still say `git clone https://github.com/M0P/insura.git` / `cd insura` → update to `M0P/VersiGo` / `cd VersiGo`.
- GitHub metadata: description is stale ("…concept & architecture docs", sounds like the old design-doc repo); **topics empty**, **license field not set** (AGPL-3.0 file exists but GitHub shows `license: None`), homepage empty. Set description, topics (e.g. `typescript, nextjs, nestjs, prisma, postgresql, selfhosted, insurance`), license, and (optionally) a homepage/wiki.

### R2 – Upgrade the CI smoke job to the full 12-step smoke (or at least run it on the release tag)
- Checklist R-13: CI runs a **reduced** smoke (health/ready/web/db + migration). The full smoke incl. production success path (step 12) runs only locally.
- ➡️ For the release, either run the full `./scripts/compose-smoke-test.sh --build` locally on the tagged commit (documented in release-guide), or extend `ci.yml` (e.g. trigger the full smoke on `push: tags: v*`).

### R3 – Resolve the failing Dependabot PRs
- **PR #27** `vitest 2.1.9 → 3.2.6` — CI failed (`compose-test` on the dependabot branch). Either fix the vitest-3 migration or close the PR with a reason.
- Dependabot update runs on `main` failed (esbuild/next/sharp/tar/vite/vitest batch). Update to a working subset and re-run; keep `pnpm-lock.yaml` in sync.

### R4 – Fix doc drift in `docs/beta-release-checklist.md`
- Row 6: "596 API-Tests, 55 Test-Files" → current gate runs **654 API tests** (58 files), web 47, foundation 105, worker 4.
- Row 16 / R-12: audit numbers 26 → **28** (11 moderate / 16 high / 1 critical).
- Row 17: "README mit prominentem AI-Warnhinweis **(Deutsch)**" → README is English since BugFix-09 (warning box is English); either translate the heading row or reword the criterion.
- Sign-off table (Development/Code Review/Security Review/Release Manager) still empty; Go/No-Go decision not made → fill in before release.

### R5 – Write the actual release notes
- `docs/release-notes-template.md` is still a **template with placeholders** (`v1.0.0-beta.X`, `YYYY-MM-DD`, `#123`, "z.B."). For the first release: produce a concrete changelog (highlights, features, bugfixes, known limits) from the AP-01…AP-21 + BugFix-01…10 history and commit it with the release tag.

### R6 – Repo hygiene
- Untracked stale file `prompts/BugFix-03-post-bugfix02-issues.md` (issues long fixed: middleware PUBLIC_PATHS includes `/runtime-config.js`, lint clean, commits exist in history) → commit it as historical record or delete.
- Stale branches: many feature branches on origin (`feat/AP-*`, `fix/BugFix-*`) plus local counterparts; some never merged (e.g. `feat/AP-22-new-name`). Consider closing/archiving merged or obsolete branches and deleting them locally+remotely before the release for clarity.
- GitHub has `has_projects: true`, no wiki — decide whether the project board/wiki are intended to be public-facing.

### R7 – Expose a version in the runtime
- `/health` returns `{"status":"ok"}`, `/ready` returns status/capabilities but **no version**; the web UI shows no version either. For ops (which image is running?) add the package version (from `package.json` or a build-time constant) to `/health`/`/ready` and the web footer. Small change, high ops value for a release.

---

## 3. Already good (verified, keep as-is)

- All quality gates green; 31/31 smoke checks incl. production path locally (BugFix-11 adds an uploads-writability check, making the smoke 32/32).
- Images: api ~339 MB, worker ~333 MB, web ~206 MB, migration ~297 MB; no dev tools/Prisma CLI graph in runtime images; no `.env`/`node_modules` leak in images.
- No TODO/FIXME/HACK markers and no `console.log` in `apps/`/`packages/` sources.
- No secrets/keys committed (`.env` not tracked; only the expected `migration.sql` filename matched the key scan pattern).
- README warning box preserved (English), beta limits documented, env vars documented per variable, operations/backup/restore docs exist, AGPL-3.0 LICENSE + CoC + CONTRIBUTING + SECURITY + issue/PR templates in place.
- Release guide + Docker image guide up to date (incl. BugFix-10 sizes and the automated publish workflow).

---

## 4. Optional / post-release backlog (not required for the first release)

- Browser E2E (Playwright) for the core flows (R-10 – consciously deferred).
- Automated accessibility checks (R-11 – manually reviewed only).
- OIDC auto-provisioning (R-05 – design decision ADR-007).
- Paperless auto-sync (R-03), Notifications UI (R-02) — documented limits.
- `gh` CLI / GitHub Actions: enable if you want automated release PRs, milestone/release notes generation.

---

## 5. Suggested order of operations

1. Merge PR #28 → `main`.
2. Update repo metadata + remote URL + README clone URLs (`insura` → `VersiGo`) — small PR.
3. Investigate/fix the `github-advanced-security` check failure (B3).
4. Decide dependency strategy for the audit findings (B5) — at minimum re-document the current numbers.
5. Resolve/close Dependabot PRs (R3); refresh lockfile; re-run all gates.
6. Fill sign-off + fix doc drift in the checklist (R4); write the release notes (R5); commit the stale BugFix-03 prompt or delete it (R6).
7. Optionally add version to `/health` + web footer (R7).
8. Run the **full** 12-step smoke locally on the tagged commit (or extend CI, R2).
9. Set `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`, run a `workflow_dispatch` test publish, verify images on Docker Hub.
10. Tag `main` (`v1.0.0-beta.1` or similar) → publish runs → verify `m000p/versigo-*` images + `docker-compose.dockerhub.yml` from a fresh clone.
