# AP-16 — Feature Development Workflow

## Goal

Establish a consistent and efficient development workflow for implementing new features in the Insura monorepo, ensuring that all new features follow the established architectural principles and deployment requirements.

## Read first

Before changing code, inspect and follow:
- `AGENTS.md`
- `README.md`
- `docs/03-architecture.md`
- `docs/07-security-privacy.md`
- `docs/08-admin-operations.md`
- `docs/10-quality-and-library-policy.md`
- `dependency-policy.md`
- Existing feature prompts and repository conventions
- The previously implemented Docker Compose baseline

## Scope

### 1. Development workflow standards

Define a standard workflow for feature development that integrates with the existing monorepo structure and Docker Compose deployment.

- Establish clear steps for feature creation, implementation, and testing
- Ensure all new features integrate with the Docker Compose delivery baseline
- Define how to properly add new services, dependencies, and configurations
- Specify the testing strategy for new features

### 2. Feature implementation patterns

Create standardized patterns for implementing features that:
- Follow the vertical slice architecture principle
- Integrate seamlessly with existing services
- Are properly documented
- Include appropriate tests and verification

### 3. Integration with Docker Compose

Ensure all new features are compatible with the Docker Compose delivery baseline:
- All new runtime dependencies must be added to docker-compose.yml
- All new environment variables must be documented in .env.example
- All new services must have proper health checks
- All new features must pass the compose smoke test

### 4. Quality assurance

Establish quality gates for feature development:
- Unit tests for new functionality
- Integration tests for service interactions
- Documentation updates for new features
- Smoke tests to verify Docker Compose compatibility

## Acceptance criteria

- A clear, documented workflow for feature development exists
- All new features follow the established patterns
- The Docker Compose delivery baseline remains intact
- New features are properly tested and documented
- The workflow is easy to follow and understand

## Delivery report

1. Feature development workflow documentation
2. Implementation patterns for new features
3. Integration guidelines with Docker Compose
4. Quality assurance requirements
5. Examples of how to implement a new feature following the workflow