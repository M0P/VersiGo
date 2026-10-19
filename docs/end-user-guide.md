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
- Admins can switch the automatic refresh on/off and change its interval
  (`PAPERLESS_TAG_SYNC_ENABLED`, `PAPERLESS_TAG_SYNC_INTERVAL_MS`) under
  **Settings**; the change applies without a restart. Turning it off stops
  *new* automatic refreshes – manual refreshes still work.
- Removing the tag assignment hides only the *automatically* assigned
  documents. Documents you linked manually stay, and their tag stays in
  Paperless.
- If Paperless is unreachable, nothing is removed – the last known state is
  kept and VersiGo retries automatically.
- Documents that are *only* assigned through the tag cannot be deleted in
  VersiGo; they disappear when the tag is removed in Paperless.
- Every document row shows the document type as an icon, the document date and
  – for linked Paperless documents – the document URL in Paperless. The upload
  timestamp is not shown.
- VersiGo does **not** ask Paperless every time you open the document list; it
  shows the metadata stored by the last sync. Data of newly tagged documents
  therefore appears after the next sync (or right away if you use
  **Refresh now**).
- **Refresh now** shows a progress bar while it runs (queued → running →
  finished/failed) and the list refreshes on its own afterwards – no browser
  reload, your scroll position and filters stay. Starting it twice for the
  same policy is blocked while a run is active; the running one is shown
  instead. The progress survives a page reload if the run is still going.

## 11. Document classes, AI summaries and cost suggestions

### Document classes

Every document in a policy carries a **class**: *Unclassified, Contract,
Billing, Correspondence, Claim, Other*. Set it in the **Documents** tab
(individually or with a multi-selection → **Classify**). Classes introduced
by an upgrade start as *Unclassified* – VersiGo never classifies document
contents automatically.

Two classes are used by other features:

| Class | Used by |
|-------|---------|
| **Contract** | The optional document selection of the AI coverage summary |
| **Billing** | The billing-document sidebar of the **Costs** tab |

The Paperless sync **never changes** a class – it survives every refresh.

### AI coverage summary

Open a policy → **Summary**. The summary is generated by the configured AI
provider and is only shown when the provider is enabled *and* answering.
You can additionally select up to **8 contract documents** to include; the
selection only appears when the AI is available. A data-transfer notice is
shown before the first AI request.

You can accept that notice once and for good under **Settings → AI data
transfer** (personal preference `ai:dataTransferConsent`). Once accepted, the
notice is no longer shown in the policy views; the checkbox next to the AI
action stays a *per-action* confirmation and is then pre-ticked, so you can
still decline a single call. The summary answers in plain German and describes
**what** is insured (persons/items, scope of benefits, exclusion, deductible),
not just a list of figures; the whole rendered summary is limited to 2000
characters. For documents taken from Paperless-ngx the AI receives the text
Paperless recognised (OCR); uploads that are only stored in VersiGo still
contribute their metadata only, because VersiGo does no text extraction of its
own.

Summary output is a fixed, versioned JSON format (schema version 2) that the
interface renders itself – the AI never supplies HTML or Markdown that gets
executed. Summaries stored before this format existed keep being displayed
from their original text.

### Cost suggestions from a billing document

Open a policy → **Costs**. A sidebar on the right lists the policy's
**Billing** documents (search included, preview opens next to the costs, and
documents already used by a cost entry are marked). A document that exists
only in Paperless-ngx has no local file, so it shows a note instead of the
preview button (use the **Documents** tab for its Paperless link). On narrow
screens the sidebar collapses into a drawer.

- If the sidebar is empty, there is a shortcut to the document classification.
- **Cost with AI** appears only when the server reports the AI as available,
  and only after the same data-transfer notice as for the summary.
- The AI result is a **proposal** prefilled into the ordinary cost form –
  nothing is saved until you confirm it. Fields the AI could not read
  reliably are marked and stay empty.
- The saved entry keeps a reference to the document it came from, so
  duplicates are easy to spot. Existing entries for the same document are
  listed before you save.
- Every error leaves manual entry fully usable.

## 12. Troubleshooting

| Symptom | What to check |
|---------|---------------|
| `web` not reachable | Wait – the first build takes a while. Check `docker compose ps` (all services `healthy`?) and `docker compose logs web`. |
| API shows `cannot connect to database` | Check `DATABASE_URL` in `.env` and that `db` is healthy. |
| Login fails | Verify `LOCAL_ADMIN_USERNAME` / `LOCAL_ADMIN_PASSWORD` and `NODE_ENV`. In production the placeholder password is rejected. |
| Everything unhealthy | `docker compose down` then `docker compose up -d --build` again. |
| Tag search finds nothing, or creating a tag fails with *"the tag could not be created in Paperless"* | The **Paperless-ngx document assignment** section names the cause: *not configured*, *access denied*, *not reachable* or *request rejected*. Check `PAPERLESS_ENABLED`, `PAPERLESS_URL` and `PAPERLESS_API_TOKEN` and use **Admin → Integrations → Test connection**. |
| AI features are unavailable (e.g. "KI-Funktionen sind nicht verfügbar. Der konfigurierte Provider antwortet nicht.") | Check `AI_ENABLED=true` and `AI_PROVIDER` in **Admin → Settings → Features (KI-Assistent)**. The **Coverage summary** panel (BugFix-22) shows a concrete reason code (`disabled`, `not-configured`, `unauthorized`, `timeout`, `unreachable`, `http-error`) – e.g. `unauthorized` means wrong API key, `unreachable` means the provider cannot be reached (another AI_PROVIDER may still be active). Use **Admin → Settings → Test** for the corresponding AI key: the test now includes a **Runtime check (Lauftest)** against the active adapter. Keyless OpenAI-compatible endpoints (local gateways, vLLM, LM Studio) are supported (no API key required). |
