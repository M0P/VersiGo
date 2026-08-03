# Docker Image Guide – Build, Tag, Push, Deploy, Upgrade, Rollback, Restore

**Version:** 1.0.0-beta (AP-20)  
**Datum:** 2026-08-03  
**Gilt für:** `versigo-api`, `versigo-worker`, `versigo-web` (sowie `versigo-test` für CI)

---

## 1. Überblick

VersiGo wird als **drei Laufzeit-Images** gebaut, die ausschließlich
**Produktions-Dependencies** enthalten (AP-20):

| Image | Dockerfile | Basis | Inhalt | Größe (AP-20) |
|-------|------------|-------|--------|---------------|
| `versigo-api` | `apps/api/Dockerfile` | `node:24-alpine` | NestJS-Build (`dist`), Prisma (Schema, Migrations, CLI, Client), `postgresql16-client`, `docker/start.sh` | **~839 MB** |
| `versigo-worker` | `apps/worker/Dockerfile` | `node:24-alpine` | BullMQ-Worker-Build (`dist`), Prisma (CLI, Client), `postgresql16-client`, `docker/start.sh` | **~828 MB** |
| `versigo-web` | `apps/web/Dockerfile` | `node:24-alpine` | Next.js `output: "standalone"` (nur gerenderter App-Code + Tracing-Deps) | **~240 MB** |

**Vorher/Nachher (AP-20):**

| Image | Vor AP-20 | Nach AP-20 | Reduktion |
|-------|-----------|------------|-----------|
| `versigo-api` | 1.12 GB (inkl. Dev-Tools) | ~839 MB | ~25 % |
| `versigo-worker` | 1.12 GB (inkl. Dev-Tools) | ~828 MB | ~26 % |
| `versigo-web` | 240 MB | 240 MB | – |

### Warum so schlank?

- Die Runner-Stage kopiert **nur** die Produktions-Dependencies. Dafür wird
  `pnpm deploy --filter @versigo/<app> --prod --legacy` verwendet (erzeugt ein
  eigenständiges Verzeichnis mit Laufzeit-Deps inkl. gepacktem
  `@versigo/foundation`).
- Kein TypeScript, kein ESLint, kein Vitest, kein `@nestjs/cli`, kein
  Quellcode im Runtime-Image.
- `prisma` + `typescript` (peer-Dependency von `prisma`) und `@prisma/client`
  sind **bewusste Laufzeit-Abhängigkeiten**: `docker/start.sh` führt
  `npx prisma migrate deploy` aus, und die Anwendung benötigt den generierten
  Prisma-Client.
- Der Prisma-Client wird **beim Image-Build** generiert
  (`prisma generate --schema=/app/prisma/schema.prisma`), damit das Image
  den vollständigen Client mit Query-Engine enthält.
- Hinweis: `pnpm install --prod` verlinkt in pnpm 11.17.0 keine
  Top-Level-Pakete (Regression) – deshalb `pnpm deploy` (siehe Kommentar in
  den Dockerfiles).
- **Laufzeit-Netzwerkzugriffe (AP-20 P1):** Die Produktions-Images benötigen
  zur Laufzeit **keine unkontrollierten Netzwerkzugriffe**. API/Worker
  sprechen ausschließlich DB, Redis und – nur falls konfiguriert – die
  optionalen externen Integrationen an. Buildzeit-Abhängigkeiten sind über
  den pnpm-Lockfile (frozen lockfile) reproduzierbar festgelegt; die
  Prisma-Engines werden **während des Builds** heruntergeladen, nicht zur
  Laufzeit.

---

## 2. Voraussetzungen

- Docker Engine 24+ **oder** Podman 5+ mit docker-compose-kompatiblem Wrapper
- 4 GB+ RAM, 10 GB+ freier Speicher (Build-Phase benötigt pnpm-Store)
- `.env` aus `.env.example` kopiert

---

## 3. Build

### 3.1 Über Docker Compose (empfohlen)

```bash
docker compose build api worker web
# oder alle Dienste inkl. Start:
docker compose up --build -d
```

### 3.2 Manuell mit Podman/Docker

```bash
podman build -f apps/api/Dockerfile    -t versigo-api:latest    .
podman build -f apps/worker/Dockerfile -t versigo-worker:latest .
podman build -f apps/web/Dockerfile    -t versigo-web:latest    .
```

> **Podman-Hinweis:** `docker compose up --build` **allein** reicht auf Maschinen
> mit podman-compose nicht aus – bereits existierende Container bleiben an der
> **alten Image-ID** hängen. Vor dem Neustart:
> `docker compose down` (bzw. `docker compose down -v`), danach `up --build`.

### 3.3 Build-Dauer

- Clean Build (ohne Cache): ~8–10 Min für alle drei Images (gemessen AP-20).
- Inkrementelle Builds mit pnpm-Store-Cache (`--mount=type=cache`) sind deutlich schneller.

### 3.4 Unterstützte Architekturen & Multi-Platform-Build (Buildx)

- **Primär unterstützt und getestet:** `linux/amd64` (AP-20 gemessen, CI,
  Compose-Smoke).
- Die Basis-Images (`node:24-alpine`) sind als Multi-Arch-Manifeste
  (`linux/amd64`, `linux/arm64`) verfügbar; die Dockerfiles enthalten keine
  plattformspezifischen Befehle. Ein `arm64`-Image ist damit prinzipiell
  baubar, wurde in AP-20 aber **nicht** verifiziert.
- **Optionaler Multi-Platform-Build mit Docker Buildx** (kein Pflichtpfad,
  kein CI-Job):

  ```bash
  docker buildx create --use          # einmalig
  docker buildx build --platform linux/amd64,linux/arm64 \
    -f apps/api/Dockerfile -t versigo-api:latest . \
    --push                            # Push in eine Registry (OCI-kompatibel)
  # analog worker + web
  ```

  Ohne `--push` verbleibt das Ergebnis im Buildx-Cache und ist nur mit
  `docker buildx` (nicht mit klassischem `docker run`) direkt verwendbar.

---

## 4. Tag & Push

Konvention: `<registry>/versigo-<dienst>:<tag>`, wobei `<tag>` entweder
`latest` (Entwicklung) oder ein Versions-Tag wie `v1.0.0-beta` ist.

```bash
REGISTRY=ghcr.io/mein-user   # oder eigene Container-Registry
TAG=v1.0.0-beta

podman tag versigo-api:latest    "$REGISTRY/versigo-api:$TAG"
podman tag versigo-worker:latest "$REGISTRY/versigo-worker:$TAG"
podman tag versigo-web:latest    "$REGISTRY/versigo-web:$TAG"

podman push "$REGISTRY/versigo-api:$TAG"
podman push "$REGISTRY/versigo-worker:$TAG"
podman push "$REGISTRY/versigo-web:$TAG"
```

Zusätzlich die `latest`-Tags pushen, wenn die Betriebsumgebung ohne
Versions-Tag zieht:

```bash
podman tag versigo-api:latest "$REGISTRY/versigo-api:latest"
podman push "$REGISTRY/versigo-api:latest"
# analog worker + web
```

> Die CI (`.github/workflows/ci.yml`) führt den Build-Metrik-Job **nicht
> blockierend** aus; ein optionaler Publish-Workflow kann die Tags
> automatisiert bauen und pushen (siehe `docs/`).

---

## 5. Deploy (Frische Installation)

```bash
git clone <repo> versigo && cd versigo
cp .env.example .env
# .env anpassen (zwingend):
#   1. NODE_ENV=production        <- zentral, siehe Hinweis unten
#   2. DATABASE_URL, REDIS_URL, SESSION_SECRET, SETTINGS_ENCRYPTION_KEY
#   3. Auth-Konfiguration (LOCAL_AUTH_ENABLED / OIDC_ENABLED)
docker compose up --build -d
```

> **Wichtig (AP-20, `NODE_ENV=production`):** `.env.example` setzt
> `NODE_ENV=development` (lokaler Entwicklungsmodus). Für den
> Beta-/Produktionsbetrieb muss **explizit `NODE_ENV=production`** in der
> `.env` gesetzt werden – erst dann gelten die Sicherheitsgarantien: kein
> automatisch angelegter Default-Admin, Ablehnung des
> `.env.example`-Platzhalter-Passworts, Session-Cookie mit `Secure`-Flag und
> Auth-Fail-Fast beim Start. Der Compose-Smoke-Test verifiziert diesen
> Produktionspfad (Schritt 12).
>
> `COOKIE_SECURE` (Secure-Flag des Session-Cookies) ist standardmäßig
> `true` in Produktion. Nur Deployments, die die API kontrolliert über
> reines HTTP bedienen (TLS-terminierender Reverse-Proxy oder
> kontrollierte interne Installation ohne TLS), setzen `COOKIE_SECURE=false`
> explizit – in allen anderen Fällen ungesetzt lassen.
>
> Der initiale Administrator wird **niemals automatisch** angelegt. Für den
> ersten Start muss `LOCAL_AUTH_ENABLED=true` sowie ein eigenes, starkes
> `LOCAL_ADMIN_PASSWORD` (nicht der `.env.example`-Platzhalter, der in
> Produktion abgelehnt wird) gesetzt sein. Die API legt dann genau einmal
> den Admin plus das Referenz-Household `default` an; danach können weitere
> Konten über `/admin/users` freigeschaltet werden.
>
> **Reiner OIDC-Betrieb:** OIDC provisioniert keine Konten und
> `LOCAL_ADMIN_*` ist wirkungslos, solange `LOCAL_AUTH_ENABLED=false`
> (bzw. in Produktion nicht gesetzt) ist. Für den ersten Start muss
> deshalb zusätzlich `LOCAL_AUTH_ENABLED=true` mit eigenem, starkem
> `LOCAL_ADMIN_PASSWORD` gesetzt werden, damit der initiale Admin und das
> Household `default` angelegt werden. Erst danach kann die lokale
> Authentifizierung wieder deaktiviert werden.

Beim ersten Start:
1. `db` → Migrationen über den Einmal-Dienst `migration` (`npx prisma migrate deploy`)
2. `api` → `docker/start.sh` wartet auf die DB, führt Migrationen erneut (idempotent) und startet
3. `worker` → startet nach DB/Redis
4. `web` → startet nach API-Health

Verifikation:

```bash
docker compose ps
curl http://localhost:3001/health   # {"status":"ok"}
curl http://localhost:3000/         # HTTP 200
./scripts/compose-smoke-test.sh     # vollständiger Smoke-Test
```

---

## 6. Upgrade

```bash
git pull                        # neuen Code holen
docker compose down             # Container stoppen (Daten bleiben in Volumes)
docker compose build api worker web   # neue Images bauen
docker compose up -d            # starten; migration-Dienst führt Migrationen aus
```

Wichtig:

- **Idempotente Migrationen:** `prisma migrate deploy` läuft bei jedem Start
  und wendet nur ausstehende Migrationen an. Ein erneuter Start nach einem
  Teil-Upgrade ist unkritisch.
- **Keine automatische Rückwärtsmigration** (Downgrade-DB-Migrationen sind
  nicht vorgesehen). Bei Rückbau bitte Backup wiederherstellen (Abschnitt 8).
- **Podman-Maschinen:** vor dem `up` immer `docker compose down` ausführen,
  sonst bleiben Container an alten Image-IDs (Abschnitt 3.2).

---

## 7. Rollback (Image-Ebene)

Wenn ein neues Image fehlerhaft ist:

```bash
# Auf den letzten funktionierenden Stand zurueck (nur Image-Tag),
# sofern die Compose-Datei externe Tags nutzt:
docker compose down
# in docker-compose.yml bzw. .env das Image-Tag auf die letzte
# funktionierende Version zeigen lassen (z. B. IMAGE_TAG=v1.0.0-beta-1)
docker compose up -d
```

Ist die Datenbank bereits durch Migrationen vorgerückt und das Rollback-
Image eine ältere Datenbankstruktur erwartet, **nicht** einfach starten –
stattdessen Backup wiederherstellen (Abschnitt 8). Ein reines Rollback des
Code-Stands ohne DB-Rückschnitt funktioniert nur, wenn die Migrationen des
fehlerhaften Releases keine Breaking-Änderungen an der Datenbank hinterlassen
haben.

---

## 8. Restore (Datenebene)

### 8.1 Backup erstellen

```bash
# PostgreSQL
docker compose exec db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c -f /tmp/versigo.dump
docker compose cp db:/tmp/versigo.dump ./versigo-backup-$(date +%F).dump

# Redis (optional, Queue-Status)
docker compose exec redis redis-cli BGSAVE
docker compose cp redis:/data/dump.rdb ./redis-backup-$(date +%F).rdb

# Uploads (falls Dokumente lokal abgelegt werden)
docker run --rm -v versigo_uploads-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-backup-$(date +%F).tar.gz -C /data .
```

### 8.2 Restore

```bash
docker compose down
# alte Volumes entfernen (VORSICHT: loescht Daten unwiderruflich)
docker compose down -v

docker compose up -d db redis
# warten bis db healthy ist
docker compose cp ./versigo-backup-YYYY-MM-DD.dump db:/tmp/versigo.dump
docker compose exec db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/versigo.dump'

# Uploads-Volume wieder befuellen
docker run --rm -v versigo_uploads-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/uploads-backup-YYYY-MM-DD.tar.gz -C /data

docker compose up -d   # startet API, Worker, Web inkl. Migrationen
```

### 8.3 Datenbank-Reset (Nur Entwicklung/Test)

```bash
docker compose down -v   # loescht ALLE Volumes (postgres, redis, uploads, minio)
```

---

## 9. Image-Inhalte prüfen

Schneller Inhalts-Check ohne Compose (Podman):

```bash
podman run --rm --entrypoint sh versigo-api:latest -c '
  ls apps/api/dist/apps/api/src/main.js &&      # Build vorhanden
  node -e "require(\"@versigo/foundation\")" &&  # Workspace-Paket aufloesbar
  node node_modules/prisma/build/index.js --version | head -1   # Prisma CLI
'

# Dev-Tools dürfen NICHT enthalten sein:
podman run --rm --entrypoint sh versigo-api:latest -c \
  'ls node_modules/.pnpm | grep -Ei "^(eslint|vitest|@nestjs\+cli)@" && echo "LEAK!" || echo "OK: keine Dev-Tools"'
```

---

## 10. Troubleshooting (Image/Deploy)

| Symptom | Ursache / Lösung |
|---------|------------------|
| Container startet mit altem Code | podman-compose recycelt Container – `docker compose down` **vor** `up --build` |
| `prisma` CLI fehlt im Image | `prisma` muss in `apps/<app>/package.json` unter `dependencies` stehen (peer `typescript` ebenfalls) |
| `Cannot find module '@prisma/client'` | `prisma generate` im Runner nicht gelaufen bzw. `@prisma/client`-Link fehlt (Worker: Top-Level-Link im Dockerfile) |
| Build schlägt mit `no space left on device` fehl | `podman system prune -a -f`, danach neu bauen |
| `pnpm install --prod` erzeugt leeres `node_modules` | pnpm-11.17.0-Regression → Dockerfiles nutzen `pnpm deploy --prod --legacy` |
| `pg_isready` schlägt fehl | `postgresql16-client` muss im Runner installiert sein (Alpine-APK) |
