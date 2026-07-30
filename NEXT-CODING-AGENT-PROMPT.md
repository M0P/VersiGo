# AP-15: Docker Compose Delivery Baseline

## Work Package Description

Implement a Docker Compose delivery baseline for the Insura application that enables:

1. **Complete Stack Deployment** - All services (web, api, worker, db, redis, storage) deployable with a single `docker compose up --build` command
2. **Proper Service Dependencies** - Services start in correct order with health checks
3. **Data Persistence** - Named volumes for PostgreSQL, Redis, and MinIO data
4. **Configuration Management** - Complete environment variable setup in `.env.example`
5. **Documentation** - Comprehensive documentation covering architecture, deployment, and operations
6. **Verification** - Automated smoke testing for deployment validation

## Implementation Requirements

### Core Files to Create/Modify

1. **docker-compose.yml** - Complete service definitions for web, api, worker, db, redis, storage
2. **docker-compose.override.yml** - Port exposure for all services
3. **docker/start.sh** - Service-specific startup logic with readiness checks
4. **.env.example** - Complete configuration documentation
5. **README.md** - Quick-start guide and deployment instructions
6. **docs/03-architecture.md** - Updated with Docker Compose service descriptions
7. **docs/08-admin-operations.md** - Updated with Docker Compose deployment info
8. **docs/15-docker-compose-delivery-baseline.md** - Future-feature contract requirements
9. **scripts/compose-smoke-test.sh** - Automated smoke test script
10. **package.json** - Add smoke test script command

### Service Specifications

#### Web Service
- Next.js frontend (Port 3000)
- Depends on API service
- Uses environment variables for configuration

#### API Service
- NestJS backend (Port 3001)
- Depends on db and redis services
- Runs database migrations on startup
- Health check endpoint at `/health`

#### Worker Service
- Background jobs processor
- Depends on db, redis, and api services
- Runs database migrations on startup

#### Database Service
- PostgreSQL 16.4 (Port 5432)
- Named volume for data persistence
- Health check for readiness

#### Cache Service
- Redis 7.4 (Port 6379)
- Named volume for data persistence
- Health check for readiness

#### Storage Service
- MinIO object storage (Port 9000/9001)
- Named volume for data persistence
- Health check for readiness

### Configuration Contract

All required environment variables must be documented in `.env.example` with:
- Safe local defaults
- Clear comments and examples
- Proper variable naming for Docker Compose

### Startup Sequence

1. Services start in proper order with dependencies
2. Database readiness is checked before service startup
3. Database migrations run automatically on API/Worker startup
4. Services expose health checks for monitoring
5. All services can communicate through Docker Compose networking

### Persistence

Named volumes are used for:
- PostgreSQL data (`postgres-data`)
- Redis data (`redis-data`)
- MinIO data (`minio-data`)

### Verification

Added automated smoke test that:
- Builds and starts the full stack
- Waits for services to be ready
- Tests health endpoints
- Verifies application accessibility
- Cleans up after testing

## Future Feature Contract

Documented in `docs/15-docker-compose-delivery-baseline.md`:
- Every feature must preserve `docker compose up --build` functionality
- All new runtime dependencies must be added to Compose stack
- All new environment variables must be documented in `.env.example`
- All new features must be tested by Compose smoke test

## Acceptance Criteria

✅ All services deploy with `docker compose up --build`
✅ All services start in correct order with health checks
✅ Data persists between container restarts
✅ Environment variables properly configured
✅ Documentation is complete and accurate
✅ Smoke test passes completely
✅ All features comply with future feature contract