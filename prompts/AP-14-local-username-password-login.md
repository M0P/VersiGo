# AP-14 — Local Username/Password Login

## Goal

Add a secure local username/password authentication option while retaining the existing OIDC authentication flow and its current behaviour.

Users must be able to authenticate through either supported method when enabled by configuration. Local authentication must use the same application session, authorization, household isolation, audit, and logout model as OIDC wherever possible.

This is a vertical slice: implement schema, credential lifecycle, API endpoints, web UI, session integration, tests, documentation, and Docker Compose support together.

## Read first

Before changing code, inspect and follow:

- `AGENTS.md`
- `docs/01-product-vision.md`
- `docs/02-requirements.md`
- `docs/03-architecture.md`
- `docs/04-data-model.md`
- `docs/07-security-privacy.md`
- `docs/08-admin-operations.md`
- `docs/11-ui-ux.md`
- `dependency-policy.md`
- `docs/adr/ADR-005-oidc-session-strategy.md`
- The existing identity feature, authentication middleware, OIDC strategy, session/cookie implementation, guards, current-user resolution, and authentication pages
- Existing migrations, DTO validation, audit conventions, tests, Docker files, and environment-variable conventions

Do not replace OIDC, loosen existing authorization checks, or create a parallel authorization model.

## Scope

### 1. Local identity and credentials

Add the minimum durable data model needed for local authentication.

- A local login identifier must be unique according to a clearly documented normalization rule. Prefer email only if the existing product identity model already treats email as the canonical identifier; otherwise support a separate username.
- Store normalized identifiers and never store plaintext passwords.
- Hash passwords using a modern password-hashing algorithm appropriate for Node.js and approved by the dependency policy, with secure parameters and per-password salt.
- Store only the fields necessary for local credentials and their lifecycle. Do not duplicate household memberships, roles, or authorization data.
- Add Prisma migrations and indexes/constraints required to enforce uniqueness safely.
- Account creation/bootstrap must fit the current product and admin model. Do not silently create privileged accounts or seed production credentials.

### 2. Authentication flow

Implement local login as an additive provider.

- Add a local login endpoint and a login form on the existing login page.
- Keep OIDC sign-in available and clearly distinguish the available methods without implying an unsafe preference.
- On successful local login, establish the exact same session/cookie shape and downstream current-user identity expected by existing guards and feature APIs.
- On failed login, return a generic error that does not reveal whether an identifier exists.
- Use CSRF, secure cookie, proxy, CORS, and redirect conventions already established in the project. Do not create insecure alternate session handling.
- Preserve secure logout for both local and OIDC sessions.
- Make local login opt-in through an explicit environment/configuration flag. OIDC must remain independently configurable.
- When no authentication mechanism is enabled, fail safely with a clear operator-facing startup/configuration error rather than exposing the application.

### 3. Credential lifecycle and protection

Implement only the lifecycle required for a safe usable feature; do not claim password recovery exists unless it is actually delivered.

- Enforce a documented password policy based on current security guidance and product needs; avoid arbitrary composition rules.
- Add rate limiting or equivalent brute-force protection to local-login attempts, using the existing Redis/foundation capability when appropriate.
- Audit successful and failed local login attempts without recording identifiers, passwords, tokens, session IDs, or other sensitive values in logs.
- Ensure secrets and password hashes are redacted from errors, audit events, responses, and observability.
- If a first-user bootstrap flow is necessary, require explicit configuration and make it one-time, auditable, and unavailable after initialization. Prefer an admin-managed user creation path if one already fits the architecture.
- Do not implement password reset by email unless the project already has a secure transactional-email and token-lifecycle foundation. Document it as deferred otherwise.

### 4. UI integration

Use the shared UI design system.

- The login form must be responsive, accessible, keyboard usable, and clear on mobile, tablet, and desktop.
- Use proper autocomplete values, password-manager-friendly field names, labels, error summaries, and non-disclosing validation messages.
- Show OIDC and local login only when each is configured and available.
- Ensure loading, temporary lockout/rate-limit, service failure, and disabled-auth states have safe user-facing feedback.

## Docker Compose requirement

`docker compose up --build` must start a usable application from a fresh clone after this feature.

- Compose must support local username/password login without requiring an external OIDC provider.
- Provide clearly named, non-secret development configuration for enabling local authentication.
- If a development bootstrap account is supported, make it explicitly opt-in, document it, and prevent it from being used accidentally in production-like deployments.
- OIDC configuration must remain supported and must not be required for local development.
- Update `.env.example`, Compose documentation, health checks, and startup dependencies as needed.
- Never commit real credentials or production secrets.

This Compose requirement is mandatory for this and all later features.

## Tests and quality gates

Add or update tests for:

- Identifier normalization and uniqueness.
- Password hashing and verification, including malformed input and unsupported/legacy values if relevant.
- Generic failure responses for unknown user versus wrong password.
- Local-login rate limiting/lockout behaviour.
- Session creation, current-user resolution, logout, and authorization parity with OIDC.
- Household isolation and role/permission behaviour after local login.
- Configuration combinations: local only, OIDC only, both enabled, and neither enabled.
- Login-page rendering and accessible form behaviour.
- Migration and persistence behaviour.

Run existing lint, type checks, tests, migration checks, production build, and Compose startup verification. Do not weaken existing OIDC tests.

## Documentation

Update:

- `docs/07-security-privacy.md` with password handling, rate limiting, logging/redaction, and deferred password-reset scope.
- `docs/04-data-model.md` with credential data and relationship boundaries.
- `docs/03-architecture.md` and/or `ADR-005` only if the session strategy changes materially.
- `docs/08-admin-operations.md` with enabling local auth, safe bootstrap/user administration, and operational warnings.
- `README.md` and `.env.example` with local development and Compose instructions.

Create an ADR if the selected password hashing library/strategy or multi-provider session model represents a consequential architectural choice not already covered.

## Acceptance criteria

- OIDC sign-in remains functional and unchanged for configured deployments.
- Local username/password login is available only when explicitly enabled.
- A successful local login receives the established application session and can use existing authorized features normally.
- Passwords are never persisted or logged in plaintext, and login failures do not disclose account existence.
- Brute-force protection is implemented and tested.
- Authentication configuration fails safely when no usable provider is configured.
- The login UI is accessible and responsive.
- All migrations, tests, linting, type checks, and builds pass.
- From a fresh clone, `docker compose up --build` supports a documented local-login development path without an external OIDC provider.
- Documentation accurately distinguishes implemented functionality from deferred work.

## Delivery report

In the final response, provide:

1. Files changed and why.
2. Authentication-provider configuration matrix.
3. Credential storage, hashing, and rate-limit approach.
4. How local sessions remain compatible with OIDC authorization.
5. Exact commands run, including Compose verification.
6. Security trade-offs or deliberately deferred functionality.
