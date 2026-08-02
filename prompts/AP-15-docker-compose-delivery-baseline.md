# AP-15 — Docker Compose Delivery Baseline

## Goal

Make VersiGo runnable reliably from a fresh clone with Docker Compose, and establish a maintainable deployment baseline that remains valid after every future feature.

This feature is a complete vertical slice for local/self-hosted deployment: container images, runtime configuration, database migration, service readiness, health checks, persistent storage, documentation, and automated verification.

The required user-facing outcome is:

```bash
docker compose up --build
```

starts a usable VersiGo stack with the web application, API, worker, database, Redis, and all required dependencies functioning together.

## Read first

Before changing code, inspect and follow:

- `AGENTS.md`
- `README.md`
- `docs/03-architecture.md`
- `docs/07-security-privacy.md`
- `docs/08-admin-operations.md`
- `docs/10-quality-and-library-policy.md`
- `dependency-policy.md`
- Existing `Dockerfile`, Compose files, environment files, CI workflows, startup scripts, package scripts, Prisma configuration, API/web/worker entry points, and health endpoints
- Existing feature prompts and repository conventions

Preserve the monorepo’s existing package-manager and build conventions. Do not replace the runtime, database, or deployment architecture merely to make Compose easier.

## Scope

### 1. Production-minded Compose stack

Review and repair the current Compose setup so it can reliably run the whole application.

- Define services for every required runtime component: web, API, worker, database, Redis, and any truly required supporting service.
- Use explicit networks, named volumes, service dependencies, health checks, restart behaviour, and clear service names.
- Use multi-stage builds where appropriate, minimize final image contents, and run processes as a non-root user when compatible with the application.
- Ensure the web app can reach the API and the API/worker can reach database and Redis through Compose service DNS rather than host-only assumptions.
- Bind public ports deliberately and document them.
- Do not expose internal service ports unnecessarily.
- Keep local development conveniences separate from production-safe defaults when needed, using a documented override/profile approach rather than hidden assumptions.

### 2. Configuration contract

Create a clear, validated configuration contract for Docker deployments.

- Update `.env.example` with every required non-secret variable, safe examples, comments, and defaults where safe.
- Make required secrets explicit and fail fast with useful operator-facing errors when they are absent or insecure.
- Do not bake secrets, local file paths, API keys, or credentials into images, Compose files, source code, or documentation examples.
- Support local username/password authentication configuration if that feature is present, without making OIDC mandatory for a local stack.
- Support OIDC configuration when enabled, without placing OIDC secrets in version control.
- Ensure URLs, cookie security, trusted proxy settings, CORS origins, and callback URLs are correctly configurable for Compose and reverse-proxy deployment.

### 3. Startup, migrations, and readiness

Make startup deterministic.

- Apply Prisma/database migrations exactly once per stack startup or through a clearly documented, idempotent migration job.
- Never start application services against an unmigrated database.
- Distinguish process startup from service readiness.
- Add or use health endpoints that verify the appropriate dependencies without exposing sensitive configuration.
- Ensure web/API/worker restart safely after dependent services become available.
- Handle first startup and restarts with persisted database and Redis volumes.
- Provide a documented way to reset local development data without deleting unrelated Docker resources.

### 4. Persistent files and uploads

Inspect existing document/upload behaviour and make storage explicit.

- If uploaded documents are stored locally, mount a named volume and configure the path through environment variables.
- Ensure ownership and permissions work in containers running as non-root.
- Document backup and restore implications for the database and uploaded-file volume.
- If document storage is not yet implemented, avoid speculative infrastructure but document the reserved deployment boundary.

### 5. Verification and CI

Add automated checks so future changes do not break Compose.

- Add a CI job or script that builds the Compose images and starts the stack where repository CI capabilities permit.
- Wait for health checks rather than fixed sleeps.
- Execute a minimal smoke test against the running stack: API health, web availability, and at least one dependency-backed request.
- Shut down cleanly and capture service logs on failure.
- Keep CI credentials and test fixtures non-sensitive.
- Add a simple documented `compose-smoke-test` or equivalent command usable by contributors.

## Required future-feature contract

Document the following repository rule in the contributor/developer guidance and relevant prompt template or coding-agent instructions:

> Every feature must leave `docker compose up --build` working from a fresh clone. Any new runtime dependency, environment variable, migration, queue, storage path, port, health endpoint, or service must be added to the Compose stack, `.env.example`, documentation, and Compose smoke test within the same feature.

This rule is mandatory. It must not be satisfied by manual, undocumented host setup.

## Non-goals

- Do not add Kubernetes, Terraform, cloud-vendor deployment, or a production reverse proxy unless existing requirements explicitly demand it.
- Do not publish images to a registry unless the repository already has a defined release process.
- Do not add monitoring platforms or secret managers beyond configuration hooks already justified by requirements.
- Do not change business logic except where necessary to make startup, health, migrations, or configuration safe.

## Tests and quality gates

Test environment:
- If you want to test this you will need to set up your test environment. You have to use the distrobox fedora-app for this.
- You are allowed to install the needed tool on this environment.

Add or update:

- Dockerfile build verification.
- Compose configuration validation.
- End-to-end Compose smoke test with health-based readiness checks.
- Migration-on-fresh-volume verification.
- Restart/persistence verification for the database and any document volume if applicable.
- Configuration validation tests for missing critical values and safe local defaults.
- Existing lint, type-check, unit-test, production-build, and migration checks.

Run the stack from a clean state during validation, not only against pre-existing local images, volumes, or databases.

## Documentation

Update:

- `README.md` with prerequisites, exact quick-start commands, first-run expectations, URLs, shutdown, logs, and reset commands.
- `docs/03-architecture.md` with runtime service topology and communication paths.
- `docs/08-admin-operations.md` with configuration, backups, upgrades/migrations, troubleshooting, health checks, and rollback considerations.
- `.env.example` with complete configuration guidance.
- Contributor/coding-agent guidance with the required future-feature Compose contract.
- Create an ADR if the migration job, image layout, or runtime topology represents a consequential architecture decision.

## Acceptance criteria

- From a fresh clone and documented environment file, `docker compose up --build` starts a usable complete stack.
- Web, API, worker, database, and Redis communicate correctly through Compose networking.
- Database migrations run safely and predictably before dependent application functionality is used.
- Health checks represent actual readiness, and Compose startup does not rely on arbitrary sleep intervals.
- State that must persist uses named volumes and is documented.
- Secrets are not committed, baked into images, or printed in logs.
- The repository has an automated Compose smoke test or a documented reason why CI cannot run containers, plus a repeatable local smoke-test command.
- The future-feature Compose contract is written into repository guidance.
- Existing tests, linting, type checks, and production builds pass.

## Delivery report

In the final response, provide:

1. Files changed and why.
2. Service topology, ports, volumes, and health-check endpoints.
3. Migration and startup sequence.
4. Required configuration variables and safe local-development path.
5. Exact clean-start and smoke-test commands run.
6. The documented rule that future features must preserve Compose operability.
