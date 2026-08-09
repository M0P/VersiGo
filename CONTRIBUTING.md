# Contributing to VersiGo

Thanks for your interest in contributing! Help, reviews, tests, bug reports,
security reports, documentation improvements and pull requests are **explicitly
welcome**.

Please take a moment to read this guide and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

If you find a security vulnerability, **do not open a public issue**. Report it
privately via **GitHub Security Advisories** (Security -> Report a
vulnerability, or
`https://github.com/M0P/VersiGo/security/advisories/new`). See
[SECURITY.md](SECURITY.md).

## Reporting bugs and requesting features

Please use the issue templates:

- **Bug report:** `.github/ISSUE_TEMPLATE/bug_report.yml`
  (New issue -> Bug report). Include the exact failure, steps to reproduce,
  expected vs. actual behavior, and the environment (Docker/Podman, image
  tag/commit, `.env` values without secrets).
- **Feature request:** `.github/ISSUE_TEMPLATE/feature_request.yml`
  (New issue -> Feature request). Describe the problem you want to solve, not
  just a solution idea, so the maintainers can discuss trade-offs.

## Getting started

1. **Fork** the repository on GitHub.
2. **Clone** your fork and add the upstream remote:

   ```bash
   git clone https://github.com/<your-user>/VersiGo.git
   cd VersiGo
   git remote add upstream https://github.com/M0P/VersiGo.git
   ```

3. Create a branch from an up-to-date `main`:

   ```bash
   git checkout main
   git pull upstream main
   git checkout -b feat/your-improvement
   ```

## Branch naming

Use descriptive, prefix-based branch names that match the project history:

| Prefix   | Use case                            | Example                                      |
|----------|-------------------------------------|----------------------------------------------|
| `feat/`  | New feature (work package AP-x)     | `feat/AP-23-notifications-ui`                |
| `fix/`   | Bug fix (work package BugFix-x)     | `fix/BugFix-10-oidc-login-redirect`          |
| `chore/` | Maintenance / tooling / CI          | `chore/dependabot-ts-config`                 |
| `docs/`  | Documentation-only changes          | `docs/translate-architecture-overview`       |

## Commit message style

Use a concise summary line that starts with the work package identifier, or a
conventional-commit prefix:

- `AP-23: add notification preferences UI`
- `BugFix-10: fix OIDC redirect after login`
- `feat(AP-23): add notification preferences UI`
- `docs: translate architecture overview`

The summary line should describe **what** changed and **why** in plain,
imperative English. For larger changes, add a body that lists the individual
changes (one bullet per logical change) and notes any migrations, new
environment variables, or documentation updates.

Keep commits focused: one logical change per commit, and never commit secrets
(see `.env.example` — `.env` files are gitignored).

## Development environment

The **mandatory** development, test and verification environment is
Docker Compose (see `AGENTS.md`). All quality gates run in containers:

```bash
cp .env.example .env

# Full test suite (lint + typecheck + unit/integration tests + i18n guard)
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test

# Compose smoke test (starts the stack, runs migrations, health checks, smoke tests)
./scripts/compose-smoke-test.sh --build --clean

# Individual checks
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run lint"
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run typecheck"
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run test"
```

Rules for contributors:

- **All gates must stay green** before opening a pull request: vitest (API +
  web), `tsc`, `eslint`, the i18n guard, `docker compose config` and the
  Compose smoke test. If a check is unavailable or fails for environmental
  reasons, say so explicitly in the pull request.
- **Schema changes** (Prisma) go through the Compose `migration` service and
  must include a migration that works on a fresh clone. Rebuild the migration
  image (`docker compose build migration`) after adding a migration.
- **New runtime dependencies, environment variables, ports, queues, storage
  paths, health endpoints or services** must be reflected in the Compose
  stack, `.env.example`, the docs, and the Compose smoke test within the same
  change (Required Future-Feature Contract in `AGENTS.md`).
- **Docs are updated within the same change** (project convention).
- New/changed UI strings must be added to both locales (`de` and `en`) so the
  i18n guard stays green.

## Review loop

Work packages are implemented, verified and reviewed in a defined loop:

1. Implement the work package.
2. Run all gates (see above) and fix failures.
3. Have the changes reviewed by an independent code reviewer
   (`@code-reviewer` subagent in the agent workflow); the report is written
   verbatim to `docs/reviews/<package>-review-<n>.md`.
4. Fix every Critical/High/Medium finding (and Minor findings where
   reasonable) until the acceptance condition is met (0 Critical / 0 High /
   0 Medium / at most 8 Minor).
5. Commit with a message starting with the work package identifier.

For pull requests, review the diff yourself before submitting: `git status`,
`git diff`, `git log --oneline -10`. Open the pull request against `main` and
describe: what changed, why, and how it was tested.

## Project conventions worth knowing

- English code identifiers and English repository documentation. **German API
  runtime messages remain German**; UI strings are translated via the i18n
  locales (`de`/`en`), never hardcoded.
- Modular monolith: features are vertically sliced under `apps/api/src/features/`.
  Architecture decisions are recorded in `docs/adr/`.
- Money handling: `DECIMAL` storage, 2-decimal rounding, never floats for sums.
- Household isolation and role guards (`READ_ONLY` read-only, `USER`/`ADMIN`
  write) must be preserved for every endpoint.

## License

VersiGo is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0)** — see the [LICENSE](LICENSE) file. By contributing, you agree
that your contributions are licensed under AGPL-3.0 as well.

## Code of Conduct

All community participants must follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
