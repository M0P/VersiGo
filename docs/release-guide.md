# VersiGo – Release Guide (Container Images)

This guide explains, step by step, how to publish VersiGo as ready-made
(Release) container images that end users can run without building anything.

It is aimed at the person responsible for releasing VersiGo.

---

## 0. Prerequisites

- A machine with Docker/Podman and Compose (see `docs/end-user-guide.md`).
- Write access to a container registry (e.g. Docker Hub, GitHub Container
  Registry GHCR) if you want to publish images.
- A clean checkout of the repository on the branch/tag you want to release.

```bash
git checkout <release-branch-or-tag>
```

## 1. Build and verify locally

All quality gates must pass **before** tagging anything:

```bash
# 1) Full test gate (lint, typecheck, unit/integration, license check,
#    version sync check, i18n guard)
docker compose -f docker-compose.test.yml down -v
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test

# 2) Production images
docker compose build api web worker

# 3) Smoke test (fresh stack, bootstrap, login, business flow)
./scripts/compose-smoke-test.sh --build
```

Check the image sizes (targets: api/worker ≤ 520 MB, web ≤ 230 MB):

```bash
docker image ls versigo-api versigo-worker versigo-web
```

Verify that no `.env` file and no `node_modules` leaked into an image:

```bash
docker run --rm --entrypoint sh versigo-api:latest -c 'ls -la /app | grep -c .env'   # → 0
```

## 2. Versioning

Tag images with a semantic version and, optionally, the commit hash:

| Tag | Meaning |
|-----|---------|
| `1.2.0` | Semantic version (SemVer: `MAJOR.MINOR.PATCH`) |
| `1.2.0-rc.1` | Release candidate |
| `<commit-sha>` | Exact commit (good for rollback) |

Example for `1.2.0`:

```bash
docker tag versigo-api:latest    myregistry.example/versigo/versigo-api:1.2.0
docker tag versigo-worker:latest myregistry.example/versigo/versigo-worker:1.2.0
docker tag versigo-web:latest    myregistry.example/versigo/versigo-web:1.2.0
docker tag versigo-api:latest    myregistry.example/versigo/versigo-api:latest
docker tag versigo-worker:latest myregistry.example/versigo/versigo-worker:latest
docker tag versigo-web:latest    myregistry.example/versigo/versigo-web:latest
```

## 3. Publish to a registry

> **Since BugFix-09** the automated release workflow
> (`.github/workflows/publish.yml`) builds and pushes the images
> **api / worker / web / migration** to **Docker Hub**
> (`m000p/versigo-<service>:<version>` + `:latest`) whenever a version tag is
> pushed. The manual commands below are only needed for custom registries or
> local publishing.

### Docker Hub

```bash
docker login
docker push myregistry.example/versigo/versigo-api:1.2.0
docker push myregistry.example/versigo/versigo-worker:1.2.0
docker push myregistry.example/versigo/versigo-web:1.2.0
docker push myregistry.example/versigo/versigo-api:latest
docker push myregistry.example/versigo/versigo-worker:latest
docker push myregistry.example/versigo/versigo-web:latest
```

### GitHub Container Registry (GHCR) — optional manual path

> The automated release workflow publishes to **Docker Hub only**. GHCR is not
> used by the project; the commands below are an optional manual alternative
> for maintainers who want a private mirror.

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <your-user> --password-stdin
docker tag versigo-api:latest    ghcr.io/<owner>/versigo-api:1.2.0
docker tag versigo-worker:latest ghcr.io/<owner>/versigo-worker:1.2.0
docker tag versigo-web:latest    ghcr.io/<owner>/versigo-web:1.2.0
docker push ghcr.io/<owner>/versigo-api:1.2.0
docker push ghcr.io/<owner>/versigo-worker:1.2.0
docker push ghcr.io/<owner>/versigo-web:1.2.0
```

> **Multi-architecture:** To build and push images for multiple platforms
> (e.g. `linux/amd64` and `linux/arm64`), use Buildx with emulation:
> ```bash
> docker buildx build --platform linux/amd64,linux/arm64 --push \
>   -t <registry>/versigo-api:1.2.0 apps/api
> ```
> Note that the Compose build (`docker compose build`) builds for the host
> architecture only.

## 4. Let end users use the release images

In `docker-compose.yml` replace the `build:` sections with the published image
references:

```yaml
services:
  api:
    image: myregistry.example/versigo/versigo-api:1.2.0
    # no build: section
  worker:
    image: myregistry.example/versigo/versigo-worker:1.2.0
  web:
    image: myregistry.example/versigo/versigo-web:1.2.0
```

End users then only need:

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

Keep the `migration` service built from source (or provide a dedicated
migration image) so that database migrations run as part of the upgrade.

## 5. Release checks (security)

Before publishing, verify:

- [ ] **No secrets:** No `.env` file, API tokens, or private keys inside the
      images (see step 1). Secrets are injected via environment variables.
- [ ] **Registry is private by default** unless you intentionally publish a
      public image.
- [ ] **Tags and changelog updated** (concrete notes: `docs/release-notes-v1.0.0-beta.1.md` —
      update this reference to the new version's notes file when tagging;
      reusable template: `docs/release-notes-template.md`).
- [ ] **Documentation updated** (`docs/end-user-guide.md` matches the release;
      the Compose configuration in the release tag matches the guide).
- [ ] **Fresh-clone test:** `cp .env.example .env && docker compose up --build`
      works from a fresh clone (see `docs/docker-image-guide.md`).
- [ ] **Image sizes** are within the targets (api/worker ≤ 520 MB, web ≤ 230 MB).

## 6. Upgrade path for end users

Users update by pulling the new images and restarting:

```bash
git pull                      # or: docker compose pull with image references
docker compose up -d --build
```

The `migration` service applies schema changes automatically. If a release
contains breaking changes, document them in the release notes.

## 7. Bumping the application version

The version has a single source of truth: the `"version"` field in the ROOT
`package.json`. To publish a new version (e.g. `1.0.0-beta.2`):

```bash
node scripts/bump-version.mjs 1.0.0-beta.2
```

This updates every functional location that carries the version in one step:
the 5 workspace `package.json` files (root, api, worker, web, foundation), the
`APP_VERSION` / `NEXT_PUBLIC_APP_VERSION` defaults in `docker-compose.yml` and
`docker-compose.dockerhub.yml`, `.env.example`, and the version line in
`scripts/dependency-licenses.mjs` + `docs/third-party-notices.md`. The
`pnpm-lock.yaml` does not need regeneration (workspace packages are linked,
never version-pinned).

Verify with the sync check (also part of the CI test gate):

```bash
node scripts/check-version-sync.mjs
```

The version reaches the web UI at container **startup**: the entrypoint
writes `/runtime-config.js` from `NEXT_PUBLIC_APP_VERSION`, so a restart of
the web container with the new env value is sufficient — no image rebuild is
required. Afterwards run the full test gate (see section 1), then tag the
release and write the release notes.

Locations that are deliberately NOT covered by the sync check and are updated
manually: the health-controller test fixtures
(`packages/foundation/src/health/__tests__/health.controller.spec.ts`) and the
example in the `APP_VERSION` schema comment
(`packages/foundation/src/config/app-config.schema.ts`).

---

See also: `docs/docker-image-guide.md` (build, tag, push, deploy, upgrade,
rollback, restore) and `docs/end-user-guide.md` (daily operation).
