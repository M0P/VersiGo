# Docker Compose Delivery Baseline

This document describes the requirements and guidelines for maintaining Docker Compose delivery baseline in the Insura project.

## Required Future-Feature Contract

Every feature must leave `docker compose up --build` working from a fresh clone. Any new runtime dependency, environment variable, migration, queue, storage path, port, health endpoint, or service must be added to the Compose stack, `.env.example`, documentation, and Compose smoke test within the same feature.

This rule is mandatory. It must not be satisfied by manual, undocumented host setup.

## Implementation Requirements

1. **Service Definitions**: All new services must be defined in `docker-compose.yml`
2. **Configuration**: All new environment variables must be added to `.env.example` with defaults
3. **Documentation**: All changes must be documented in relevant documentation files
4. **Testing**: All new features must be verified by the Compose smoke test
5. **Persistence**: All persistent data must use named volumes
6. **Health Checks**: All services must have proper health checks

## Example Implementation Pattern

When adding a new feature that requires:
- A new database table: Add migration to Prisma schema
- A new service: Add service definition to docker-compose.yml
- A new environment variable: Add to .env.example with appropriate default
- A new storage path: Add volume mount to docker-compose.yml
- A new port: Expose port in docker-compose.yml and document it
- A new health endpoint: Add health check to service definition

## Verification

The Compose smoke test ensures that:
1. All services start successfully
2. Database migrations run correctly
3. Services can communicate with each other
4. Health endpoints are responsive
5. The application is accessible via the web interface

To run the smoke test:
```bash
pnpm run compose:smoke-test
```