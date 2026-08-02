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
   force it: `podman build --no-cache --target build -t versigo-test:latest .`
4. **Fast verification of image content** (no compose involved):
   `podman run --rm --entrypoint sh versigo-test:latest -c 'sha256sum <path>; grep -c "<pattern>" <path>'`
5. **Image names are prefixed** with `localhost/` (e.g.
   `localhost/versigo:latest`, `localhost/versigo-test:latest`). Stray older
   images (e.g. `localhost/versigo:test`) may exist and are not used.
6. **Transient crun errors** like `unable to start container ... exec.fifo`
   appear occasionally in compose logs; simply retry the command.
7. **Two separate stacks coexist:** the running dev stack (`versigo_*`
   containers, image `localhost/versigo:latest`) and the test stack
   (`versigo_test_*`, image `localhost/versigo-test:latest`, from
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
9. **Clean up after every work package.** At the end of each work package,
   before the commit, remove every Docker/Podman artifact you created during
   the session so the next package starts with a clean slate and the disk
   does not fill up:
   - Debug/scratch containers you started manually (`podman ps -a`, remove
     only the ones you created — never touch pre-existing containers such as
     `tk-epa-ubuntu` or `libation-env`).
   - Build/test images produced by your session
     (`podman rmi localhost/versigo:latest localhost/versigo-test:latest` after
     the final verification run) plus any dangling images
     (`podman image prune -f`).
   - Scratch volumes (`podman volume ls` + `podman volume rm` for volumes you
     created) and any compose stack leftovers (`docker compose down -v`).
   - Do **not** remove shared base images (node, postgres, redis, ubuntu,
     fedora, ...) or containers that were already running before your
     session. Verify with `podman ps -a`, `podman images` and `df -h`
     afterwards.
10. **Never redirect podman storage to another directory.** Do NOT set
    `CONTAINERS_STORAGE_CONF` (or `STORAGE_DRIVER`/`graphroot` overrides)
    to a scratch directory in `/tmp`, `/home`, or anywhere else. The podman
    storage root is fixed (the `containers/storage` subtree of the program
    data partition). If the disk is full:
    - Clean up your own artifacts first: `podman system prune -a -f`,
      remove images/volumes/containers you created (see point 9), then
      re-check `df -h`.
    - If that is not enough, stop and ask the user — do NOT relocate the
      storage. Redirecting storage to `/tmp` (a tmpfs) or another partition
      breaks the machine's storage model and leaves root/subuid-owned
      artifacts that only `podman unshare` can remove.
11. **Clean up every file you create, in every location.** Any scratch file,
    config, log, or directory you write outside the repo during a session
    (e.g. under `/tmp`) must be deleted before you finish. Leftover files
    from interrupted builds may be owned by root or by subordinate UIDs; to
    remove those use `podman unshare rm -rf <path>`. Verify afterwards that
    the paths you created are gone.

## Required Future-Feature Contract

> Every feature must leave `docker compose up --build` working from a fresh clone. Any new runtime dependency, environment variable, migration, queue, storage path, port, health endpoint, or service must be added to the Compose stack, `.env.example`, documentation, and Compose smoke test within the same feature.
