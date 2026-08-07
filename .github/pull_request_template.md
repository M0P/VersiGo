<!--
Thanks for contributing! Please read CONTRIBUTING.md first.
Security vulnerabilities: do NOT open a pull request or issue — report them
privately via GitHub Security Advisories (see SECURITY.md).
-->

## What

Briefly describe what this change does.

## Why

Why is this change needed? Which issue/work package does it address?

## How it was tested

- [ ] `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` (lint, typecheck, tests, i18n guard)
- [ ] `./scripts/compose-smoke-test.sh --build --clean` (if the change affects the stack/CI)
- [ ] `docker compose config` (if the change affects Compose)
- Manual verification notes:

## Checklist

- [ ] All gates green (vitest API + web, tsc, eslint, i18n guard, compose config, smoke test)
- [ ] Docs updated within this change (project convention)
- [ ] New env vars / ports / services / health endpoints reflected in `.env.example`, Compose, docs and smoke test (Required Future-Feature Contract)
- [ ] No secrets committed; `.env` never in version control
- [ ] New/changed UI strings added to both i18n locales (`de` and `en`)

## Additional context

Screenshots, migration notes, links to related issues/PRs.
