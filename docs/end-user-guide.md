# VersiGo – End-User Guide (Docker Compose)

This guide is written for people who want to **run VersiGo themselves** – no
developer knowledge required. VersiGo runs entirely in Docker containers.

## 1. Prerequisites

You need:

- **Docker** with the **Compose** plugin (or **Podman** with `podman-compose`).
  Test with:
  ```bash
  docker compose version
  ```
- At least **2 GB of free memory** and about **3 GB of free disk space** for the
  images and your data.
- A machine that can run the current container images (x86-64 or ARM64 Linux;
  macOS and Windows work as well).

## 2. Get the software

Download the project (or copy it from a USB stick):

```bash
git clone <repository-url> versigo
cd versigo
```

## 3. Create your configuration

Copy the example configuration and open it in a text editor:

```bash
cp .env.example .env
```

Adjust at least these values in `.env`:

| Variable | What it is | Example |
|----------|------------|---------|
| `POSTGRES_PASSWORD` | Database password | `my-very-own-db-password` |
| `SETTINGS_ENCRYPTION_KEY` | Secret used to encrypt stored credentials. Generate one with `openssl rand -hex 32` | `a1b2...` (64 hex characters) |
| `SESSION_SECRET` | Secret for the web session. At least 32 characters | `use-at-least-32-random-characters` |
| `LOCAL_ADMIN_PASSWORD` | Initial admin password (replaces the placeholder) | `a-strong-own-password` |
| `NODE_ENV` | Set to `production` | `production` |

The values in `.env.example` are **development placeholders**. Never run a
public installation with the default values.

## 4. Start VersiGo

```bash
docker compose up --build
```

The first start takes a few minutes (it downloads base images and builds the
containers). Afterwards you will see all services starting up:

- `db` – the database
- `redis` – the queue/cache
- `migration` – applies database updates once and exits
- `api` – the backend
- `worker` – background jobs
- `web` – the web interface

Open your browser:

- **Web interface:** http://localhost:3000
- **API health:** http://localhost:3001/health (shows `ok`)

To run it in the background, use `docker compose up -d --build` instead.

## 5. First login

1. Open http://localhost:3000.
2. Sign in with the **username** and **password** from `LOCAL_ADMIN_USERNAME` /
   `LOCAL_ADMIN_PASSWORD` in your `.env`.
3. As the first administrator you can:
   - add insurance policies,
   - pin them to the dashboard,
   - configure integrations (Paperless, AI, OIDC) under **Admin → Settings**,
   - manage users.

## 6. Daily operation

| Task | Command |
|------|---------|
| Show logs | `docker compose logs -f api` |
| Stop everything | `docker compose down` |
| Start again | `docker compose up -d` |
| Show status | `docker compose ps` |

## 7. Backup and restore

Your data lives in Docker **volumes**. Back up these two (and `uploads-data`
if you store documents on the server):

```bash
# Backup (while the stack is running)
docker run --rm -v versigo_postgres-data:/data -v "$(pwd)":/backup \
  alpine tar czf /backup/postgres-data.tar.gz -C /data .

# Restore (after a fresh `docker compose down`)
docker run --rm -v versigo_postgres-data:/data -v "$(pwd)":/backup \
  alpine tar xzf /backup/postgres-data.tar.gz -C /data
```

> **Tip:** Use a proper PostgreSQL dump for the database when you can, e.g.
> `docker compose exec db pg_dump -U versigo versigo > backup.sql`. Volume
> copies are simpler, but a `pg_dump` backup is the safest option.

## 8. Updates

```bash
git pull                 # get the new version
docker compose up -d --build   # rebuild and restart
```

The `migration` service applies database updates automatically. Check the
release notes of the new version for anything else you need to do.

## 9. Customization (branding)

VersiGo ships with a neutral default brand (shield/checkmark). To use your own
branding, replace the two files in the `branding/` directory in the project
root (they are copied into the web image at build time):

| File | Purpose |
|------|---------|
| `branding/icon.svg` | App icon – used as the browser favicon and metadata icon (e.g. in links, tabs) |
| `branding/favicon.svg` | Favicon (fallback/shortcut icon) |

```bash
# replace the files, then rebuild the web container
docker compose up -d --build web
```

Guidelines:

- Use **square SVGs** (any size works; rendered at 32–512 px).
- After replacing a file, hard-refresh the browser (Ctrl/Cmd+Shift+R) to see
  the new icon.
- The files are only read at **build time** – changing them without a rebuild
  has no effect.

## 10. Paperless document assignment (optional)

If you run a [Paperless-ngx](https://docs.paperless-ngx.com/) instance, VersiGo
can show your Paperless documents directly in the policy context. Two ways
exist and they can be combined:

| Way | How it works |
|-----|--------------|
| **Manual link** | In a policy, open **Documents → Link Paperless document**, search Paperless and link a document. Only that one policy shows it. |
| **Automatic via tag** | In a policy, open the **Documents** tab, section **Paperless-ngx document assignment**, and pick or create a tag. *Every* Paperless document carrying that tag appears automatically for the policy. |

Setup:

1. In `.env` (or in **Admin → Settings**) set `PAPERLESS_ENABLED=true`,
   `PAPERLESS_URL` (for example `https://paperless.example.com`) and
   `PAPERLESS_API_TOKEN` (create the token in Paperless under
   *Settings → Users & Groups → My Profile → API Token*).
2. Restart the stack (`docker compose up -d`).
3. Open a policy, switch to the **Documents** tab and choose the tag under
   **Paperless-ngx document assignment**.

Good to know:

- VersiGo **never deletes** anything in Paperless. It only *adds* the chosen
  tag to the documents you linked manually.
- The same tag may be used for several policies – the same documents then
  appear for each of them.
- The assignment is refreshed in the background (by default every 5 minutes,
  `PAPERLESS_TAG_SYNC_INTERVAL_MS`). Use **Refresh now** to sync immediately.
- Removing the tag assignment hides only the *automatically* assigned
  documents. Documents you linked manually stay, and their tag stays in
  Paperless.
- If Paperless is unreachable, nothing is removed – the last known state is
  kept and VersiGo retries automatically.
- Documents that are *only* assigned through the tag cannot be deleted in
  VersiGo; they disappear when the tag is removed in Paperless.

## 11. Troubleshooting

| Symptom | What to check |
|---------|---------------|
| `web` not reachable | Wait – the first build takes a while. Check `docker compose ps` (all services `healthy`?) and `docker compose logs web`. |
| API shows `cannot connect to database` | Check `DATABASE_URL` in `.env` and that `db` is healthy. |
| Login fails | Verify `LOCAL_ADMIN_USERNAME` / `LOCAL_ADMIN_PASSWORD` and `NODE_ENV`. In production the placeholder password is rejected. |
| Everything unhealthy | `docker compose down` then `docker compose up -d --build` again. |
| Tag search finds nothing, or creating a tag fails with *"the tag could not be created in Paperless"* | The **Paperless-ngx document assignment** section names the cause: *not configured*, *access denied*, *not reachable* or *request rejected*. Check `PAPERLESS_ENABLED`, `PAPERLESS_URL` and `PAPERLESS_API_TOKEN` and use **Admin → Integrations → Test connection**. |
