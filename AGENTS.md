# Development Environment

## Docker Compose (Primary)

Docker Compose is the **primary and mandatory** development, test, and verification environment. All CI checks, local testing, and quality gates run through Docker Compose.

```bash
# Quick start
cp .env.example .env
docker compose up --build
```

The stack starts the following services:
- **Web** (Next.js) – http://localhost:3000
- **API** (NestJS) – http://localhost:3001
- **Worker** (BullMQ background jobs)
- **db** (PostgreSQL)
- **redis** (Redis)
- **storage** (MinIO, optional – requires `--profile storage`)

### Common Tasks

| Task | Command |
|------|---------|
| Full test suite | `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` |
| Compose smoke test | `./scripts/compose-smoke-test.sh --build` |
| Format check | `docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run lint"` |
| Type check | `docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run typecheck"` |
| Unit/Integration tests | `docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run test"` |
| Prisma generate | `docker compose -f docker-compose.test.yml run --rm test sh -c "npx prisma generate"` |
| Prisma migrate dev | `docker compose -f docker-compose.test.yml run --rm test sh -c "npx prisma migrate dev"` |
| Start full stack | `docker compose up --build` |
| Stop stack | `docker compose down` |
| Reset all data | `docker compose down -v` |
| View logs | `docker compose logs -f [service]` |

## Docker-Free Fallback (Not for CI/Release)

For environments where Docker/Podman is not available (e.g. reading files only), the host tools can be used:

```bash
# Prerequisites: Node.js 24, pnpm, PostgreSQL, Redis installed locally
pnpm install
pnpm run build
pnpm run dev
```

This fallback is **not** a valid verification path for CI, merges, or releases. All mandatory quality checks run through Docker Compose.

## Required Future-Feature Contract

> Every feature must leave `docker compose up --build` working from a fresh clone. Any new runtime dependency, environment variable, migration, queue, storage path, port, health endpoint, or service must be added to the Compose stack, `.env.example`, documentation, and Compose smoke test within the same feature.
