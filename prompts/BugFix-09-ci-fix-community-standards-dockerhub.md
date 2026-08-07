# BugFix-09 – CI fix (API boot / OidcStrategy), community standards, Docker Hub release publishing + English deployable README

Source: user request (2026-08-07) — "the github ci fails, fix it", "add community standards", "modify the github workflow so if i publish a new version on github the image is build and published on docker hub", "modify the readme: include the new docker hub image, translate the readme into english and update it so its easy for new users to deploy it as a stack using the docker hub image, without the need of rebuilding it". Mirrors `TODO.md` lines ~270-291.

## Context (what exists today)

- Branch `fix/BugFix-08-costs-overhaul-and-overview-page`; BugFix-08 is committed (`4cd3032`, 5 review rounds, 0/0/0/0). Handoff: `docs/reviews/NEXT-CODING-AGENT-PROMPT.md`.
- **GitHub CI fails: "API not healthy".** The API container crashes at boot with `UndefinedDependencyException: Nest can't resolve dependencies of the OidcStrategy (AppConfigService, CapabilityFlagsService, SettingsResolverService, ?)` — the dependency at index [3] (`AuthService`) is `undefined`. (Full user-supplied log: container `api-1`, repeated restart loop, `Process completed with exit code 1`.)
- `.github/workflows/ci.yml` (250 lines): compose-based CI (validate config, build test image, quality checks). `.github/workflows/publish.yml` (73 lines): builds and pushes **api / worker / web** images to **ghcr.io** on tag `v*` or manual `workflow_dispatch`.
- No community files exist yet: no `LICENSE`, no `CODE_OF_CONDUCT.md`, no `CONTRIBUTING.md`, no `SECURITY.md`, no `.github/ISSUE_TEMPLATE/`, no `.github/pull_request_template.md` (the README has an informal German "Mitwirken" section).
- `README.md`: German, 367 lines, contains a prominent **experimental/AI-generated warning box that must NOT be weakened** ("nicht für einen aus dem Internet erreichbaren Betrieb vorgesehen" — keep the equivalent in English).
- Deployment docs exist: `docs/docker-image-guide.md` (documents the publish workflow), `docs/release-notes-template.md`, `.env.example`, `docker-compose.yml` (services: web, api, worker, db, redis, optional storage profile; api has a `migration` build target), `apps/{api,web,worker}/Dockerfile`.

## Proven root cause of the CI failure (BugFix-07 regression, NOT BugFix-08)

With `apps/api/tsconfig.json` setting `emitDecoratorMetadata: true`:

- `oidc.strategy.ts:18` VALUE-imports `AuthService` from `./auth.service` (required so `design:paramtypes` references the class at runtime — this edge must stay a VALUE import).
- `auth.service.ts:21` VALUE-imports `normalizeIssuerUrl` from `./oidc.strategy`.
- Compiled CJS load order: `identity.module.js` → `auth.controller.js` → `auth.service.js` (top-level `require("./oidc.strategy")`) → `oidc.strategy.js` → `require("./auth.service")` returns the **partially evaluated** module (`AuthService` not yet assigned) → the `OidcStrategy` class-decorator metadata captures `undefined` → Nest DI fails at index [3].
- **Proven pre-existing:** stash all BugFix-08 changes, rebuild the API image from pristine HEAD (`8ae6f09`), boot with db+redis → identical exception. Deterministic (module evaluation order in Node CJS is fixed for identical files). Predicted in `docs/reviews/BugFix-07-review-3.md`.
- **Crucial verification caveat:** tsc, eslint, and the vitest suites CANNOT catch this (vitest uses a different module transform); only a **real Nest bootstrap** (full API boot / compose smoke test) proves the fix.

## Scope

### 1. Pull latest code and commit — ensure compatibility
- `git pull` / sync with the remote state of the branch (and `main` where relevant), resolve any conflicts, and make sure the working tree builds and the gates pass on the merged state **before** starting the CI fix. If the remote contains changes that alter the BugFix-08 semantics or break the build, fix compatibility issues first and commit them.
- All subsequent work happens on top of that synced state.

### 2. Fix GitHub CI: "API not healthy"
- Fix the `OidcStrategy` ↔ `AuthService` load-order cycle so the API boots reliably.
- **Recommended minimal fix:** break the module-evaluation-time edge `auth.service → oidc.strategy` while keeping the runtime VALUE import on the `oidc.strategy → auth.service` side:
  - In `apps/api/src/features/identity/auth.service.ts`, replace the top-level `import { normalizeIssuerUrl } from './oidc.strategy';` with a lazy access inside the method(s) that use it (e.g. `const { normalizeIssuerUrl } = require('./oidc.strategy');` inside the function — CJS output of the nest build — or a dynamic `await import(...)`).
  - Verify the emitted `dist/apps/api/src/features/identity/auth.service.js` no longer has a top-level `require("./oidc.strategy")`.
  - Update the misleading comment at `auth.service.ts:19-21` (it claims "nur Funktions-Nutzung auf Methoden-Ebene", but the compiled output had a top-level require — that mismatch masked the cycle).
- Alternative approaches are allowed if they are load-order-independent and provably safe (e.g. moving `normalizeIssuerUrl` into a separate module that neither `auth.service` nor `oidc.strategy` circularly depends on — a neutral helper file; only if this keeps `design:paramtypes` intact for `OidcStrategy`).
- Add a regression guard so a re-introduction fails loudly: at minimum a smoke/CI step that boots the API and hits its health endpoint (the CI must keep failing on a broken boot), plus a code comment. If the CI lacks an explicit API-boot/health step, add one (see Acceptance).
- Fix the GitHub CI so the whole pipeline is green: `docker compose config`, build, quality checks (vitest/tsc/eslint/i18n), and the API-boot/smoke step.

### 3. Community standards (GitHub)
Add to the repo root / `.github/`:
- `CODE_OF_CONDUCT.md` (Contributor Covenant, latest version)
- `CONTRIBUTING.md` (guidelines: forking, branch naming, commit message style, tests, review loop, security reporting pointer)
- `LICENSE`
- `SECURITY.md` (security policy: supported versions, how to report — prefer private reporting, e.g. GitHub Security Advisories)
- Issue templates: `.github/ISSUE_TEMPLATE/` (e.g. `bug_report.yml`, `feature_request.yml`, `config.yml`) using GitHub's form schema
- Pull request template: `.github/pull_request_template.md`

**HARD RULE — "ask me if there are multiple options":** the user must be asked whenever a choice with multiple reasonable options exists. Do NOT silently pick. Specifically ask at least about:
1. **License** — which one (MIT / Apache-2.0 / GPL-3.0 / other)? State the trade-offs (permissiveness, copyleft, AI-generated-experimental project context). Do not write a LICENSE file until the user decides.
2. **Code of Conduct** — Contributor Covenant vs. Citizen Code of Conduct (default recommendation: Contributor Covenant 2.1).
3. **Security contact** — who/where reports go (private email vs. GitHub Security Advisories only).
4. Anything else where more than one sensible option exists.

The agent may prepare everything else in parallel and present the questions in ONE consolidated message; do not block on trivia.

### 4. GitHub workflow: publish to Docker Hub on release
- Modify `.github/workflows/publish.yml` so that **when a new version is published on GitHub** (tag `v*` / release), the images are built and pushed to **Docker Hub** instead of (or in addition to, if the user wants both — ask) ghcr.io.
- Use `docker/login-action` with `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets; ask the user for the Docker Hub namespace and repo naming scheme (`<namespace>/versigo-api`, `-worker`, `-web`, `-migration`? — confirm exact names) before finalizing.
- Build and push **all production images** from the existing Dockerfiles: api, worker, web (and the `migration` target of `apps/api/Dockerfile` if it is part of the deployable stack — ask/verify how the migration image should be named and pushed, since `docker-compose.yml` references it as a build target today; the README deployment flow must work from prebuilt images).
- Tags: version tag (e.g. `1.2.3`) + `latest`, mirroring the current ghcr.io scheme.
- Keep `workflow_dispatch` (and optionally the ghcr.io path as a second job) only if the user wants it — ask.
- Update `docs/docker-image-guide.md` and any docs that reference the registry/images, so docs and workflow agree (project convention: docs updated within the same feature).

### 5. README: English, Docker Hub image, easy stack deployment without rebuild
- Translate the full `README.md` into **English**.
- Keep the experimental/AI-generated warning intact in English — do not soften or relativize it (the current German text forbids "production ready"/"sicher"/"öffentlich betreibbar" claims; carry that over 1:1 in meaning).
- Document deployment as a **stack from prebuilt Docker Hub images** with `docker compose` — **no rebuild required**:
  - A compose file snippet (or documented service overrides) referencing the Docker Hub images instead of `build:`, including db (Postgres), redis, api, worker, web, and the migration step (how to run migrations against the prebuilt image before/on first start).
  - `.env` setup from `.env.example` (which env vars are required), ports, volumes for persistence, and a "first start" walkthrough.
  - Note: `docker-compose.yml` in the repo keeps its `build:` paths (developers/release) — the README explains both paths, but the user-facing quick start must work from Docker Hub images alone.
- Keep the contribution/community pointers updated to match the new `CONTRIBUTING.md`/`SECURITY.md` (replace the old German "Mitwirken" section with a pointer or a translated short version).

## Conventions
- English code/identifiers and English repo docs; German API messages must remain German; de/en i18n parity for any web UI strings (i18n guard stays green).
- Follow existing patterns (docs layout, `.env.example`, compose smoke test).
- Migration via the Compose `migration` service if a schema change becomes necessary (not expected for this package).
- Required Future-Feature Contract (AGENTS.md): any new env var, secret, port, workflow, or doc must be reflected in `.env.example`, docs, and CI where applicable.

## Out of scope
- Any new product feature or schema change.
- BugFix-08 costs work (already merged).
- Changes to the app's runtime behavior beyond making the API boot and publishing images.

## Acceptance
- **CI green on GitHub**, including a real API boot/health check and the compose smoke test path (`./scripts/compose-smoke-test.sh --build --clean` locally).
- API boots deterministically (verified by an actual Nest bootstrap, not only unit tests); regression guard present.
- Community files present: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `LICENSE`, `SECURITY.md`, issue templates, PR template — **each with the user's explicit choice where options exist** (license etc. asked and decided; record the decisions in the package).
- `publish.yml` publishes to Docker Hub on version release (and the user-confirmed scheme for names/tags/extra registries); docs updated accordingly.
- `README.md` fully in English, deployable as a stack from the Docker Hub image without rebuilding; warning box preserved.
- All gates green locally (vitest API+web, tsc, eslint, i18n, `docker compose config`, compose smoke test).
- Review loop: same as previous packages — invoke the `code-reviewer` subagent (Task tool) on the uncommitted diff, write each report verbatim to `docs/reviews/BugFix-09-review-<n>.md`, fix every Critical/High/Medium (and Minor where reasonable) until **0 Critical / 0 High / 0 Medium / ≤ 8 Minor**, max 5 rounds; then commit (message starting `BugFix-09:`), write a new `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` handoff, and clean up all podman artifacts per AGENTS.md (verify `df -h /var/home` afterwards).
- Do **not** start any later work package.
