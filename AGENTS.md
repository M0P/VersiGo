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

## Container Engine Notes (Podman on the dev machine)

This development machine does not run Docker Engine. The `docker` CLI is a
Podman shim and `docker compose` delegates to **podman-compose**
(`/home/marc/.local/bin/podman-compose`). This has several consequences that
have cost agents significant time in the past — read carefully:

1. **podman-compose reuses existing containers.** After you rebuild an image
   (`docker compose ... up --build` or `podman build -t ... .`), containers
   that already exist are **not** recreated and stay pinned to the *old image
   ID*. Symptom: tests/logs show stale code even though `podman images` shows
   the tag points at a fresh image.
   **Fix:** run `docker compose -f docker-compose.test.yml down -v` (or at
   least `down`) *before* `up`, so containers are recreated from the current
   image. `up --build` alone is NOT enough on this machine.
2. **Verify what a container really uses:**
   - `podman inspect <container> --format '{{.Image}}'` (image ID the container
     was created from)
   - `podman inspect <image-tag> --format '{{.Id}}'` (current image ID of tag)
   - If they differ, the container is stale — `down` + `up` again.
3. **Layer cache is normally reliable.** After editing source files,
   `COPY apps/ apps/` / `COPY packages/ packages/` must show a NEW layer ID
   (no `Using cache` line) in the build log. If a cached layer looks wrong,
   force it: `podman build --no-cache --target build -t insura-test:latest .`
4. **Fast verification of image content** (no compose involved):
   `podman run --rm --entrypoint sh insura-test:latest -c 'sha256sum <path>; grep -c "<pattern>" <path>'`
5. **Image names are prefixed** with `localhost/` (e.g.
   `localhost/insura:latest`, `localhost/insura-test:latest`). Stray older
   images (e.g. `localhost/insura:test`) may exist and are not used.
6. **Transient crun errors** like `unable to start container ... exec.fifo`
   appear occasionally in compose logs; simply retry the command.
7. **Two separate stacks coexist:** the running dev stack (`insura_*`
   containers, image `localhost/insura:latest`) and the test stack
   (`insura_test_*`, image `localhost/insura-test:latest`, from
   `docker-compose.test.yml`). They share no volumes or networks.
8. **Disk fills up quickly.** Podman storage sits on `/var/home` (a 123 GB
   partition that also holds the host home directory). Repeated image builds
   accumulate hundreds of layers/images (`podman system df` showed 431 images
   / 26 GB reclaimable at one point). A build will fail with
   `no space left on device` when the partition is ~96% full.
   **Fix:** `podman system prune -a -f` (frees tens of GB by removing unused
   images and build cache; expect a full rebuild afterwards, including the
   `pnpm install` deps stage). Check with `df -h /var/home` and
   `podman system df`.

## Required Future-Feature Contract

> Every feature must leave `docker compose up --build` working from a fresh clone. Any new runtime dependency, environment variable, migration, queue, storage path, port, health endpoint, or service must be added to the Compose stack, `.env.example`, documentation, and Compose smoke test within the same feature.
