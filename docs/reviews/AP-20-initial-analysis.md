# AP-20: Initial Analysis Document

## 1. Ziel und Abgrenzung

**Ziel:** VersiGo umfassend auf eine erste geschlossene Beta-Version vorbereiten:
- Deutlich schnellerer, reproduzierbarer Produktionsbuild (Ziel: ≤15 Min, Baseline: ~20 Min)
- Reduzierter Ressourcenbedarf (Image-Größen, Laufzeitressourcen)
- Vollständige UI-Bedienbarkeit aller Funktionen
- Belastbare Release-Verifikation
- Vollständige, sicherheitsbewusste GitHub-Dokumentation

**Abgrenzung (Nicht im Scope):**
- Öffentliche SaaS-Bereitstellung, Multi-Tenant-Hosting
- Sicherheitszertifikat, Penetrationstest, Compliance-Garantie
- Neue große Fachfeatures
- Vollständige Internationalisierung (AP-21 bereits gemerged)
- Automatische Rückwärtsmigration der Datenbank
- Pflicht zur Veröffentlichung in öffentlicher Registry
- Umgehung bestehender Architektur-/Sicherheits-Policies

---

## 2. Vollständiges Funktions- und Risiko-Inventar

### 2.1 Implementierte Feature-Slices (aus docs/05-feature-slices.md und Code)

| Feature-Slice | Status | UI-Routen | API-Endpunkte | Background Jobs | Admin-UI |
|---------------|--------|-----------|---------------|-----------------|----------|
| **Identity & Auth** | ✅ Fertig | /login, /register, /callback, /pending | /auth/*, /admin/users/* | - | User-Admin, Rollen |
| **Policy Registry** | ✅ Fertig | /policies, /policies/new, /policies/[id] | /policies/*, /covered-persons/*, /cost-entries/* | - | - |
| **Documents** | ✅ Fertig | Upload in Policy-Detail | /documents/*, /uploads/* | - | - |
| **Cost Tracking** | ✅ Fertig | /household/costs, Policy-Detail | /cost-tracking/* | - | - |
| **Family Sharing** | ✅ Fertig | - (API only) | /family-sharing/* | - | - |
| **Admin Settings** | ✅ Fertig | /admin/settings | /admin/system-config/* | - | Systemeinstellungen |
| **Feature Flags** | ✅ Fertig | /admin/feature-flags | /admin/feature-flags/* | - | Feature-Flags |
| **Integrations** | ✅ Fertig | /admin/integrations | /admin/integrations/* | Connectivity-Tests | AI, Paperless |
| **AI Assist** | ✅ Fertig | - (Policy-Detail) | /ai-assist/*, /ai-extraction/* | ai-extraction queue | AI-Konfiguration |
| **Paperless-ngx** | ✅ Fertig | - | /paperless-ngx/* | - | Paperless-Konfiguration |
| **Portal Connectors** | ✅ Fertig | - | /portal-connectors/* | - | Katalog, Plugins |
| **Audit** | ✅ Fertig | - | /admin/audit/events | - | Audit-Log |
| **Monitoring** | ✅ Fertig | - | /admin/monitoring/* | Worker-Heartbeat | Queues, Integrations |
| **Privacy** | ✅ Fertig | - | /privacy/export, /privacy/account | - | Export, Löschung |
| **Language (AP-21)** | ✅ Fertig | /settings, Language-Selector | /user/language | - | - |
| **User Preferences** | ✅ Fertig | /settings | /user/preferences | - | Design, Akzentfarbe |
| **Notifications** | ⚠️ Partial | - | /notifications/* | - | - |

### 2.2 Identifizierte Risiken

| Risiko | Schwere | Beschreibung |
|--------|---------|--------------|
| Build-Dauer > 15 Min | Hoch | Aktuell ~20 Min, Ziel 15 Min |
| Image-Größe 1.85 GB | Hoch | Zu groß für effiziente Distribution |
| Dev-Tools in Runtime-Image | Mittel | pnpm, TypeScript, ESLint im Runner |
| Fehlende UI für Family Sharing | Mittel | API existiert, keine UI-Steuerung |
| Notifications unvollständig | Niedrig | Nur API-Skelett, keine UI |
| Secrets in Logs möglich | Hoch | Bei fehlerhafter Konfiguration |
| Keine Backup/Restore-Doku | Mittel | Für Beta erforderlich |
| Keine Upgrade-Anleitung | Mittel | Für Beta erforderlich |

---

## 3. Technische Lösung und Architekturentscheidungen

### 3.1 Build-Optimierung (Docker)

**Aktuelle Probleme:**
- Single Dockerfile für alle Services (API, Worker, Web)
- Runner-Image enthält pnpm, TypeScript, Prisma CLI, ESLint
- Keine Service-spezifischen Runner-Images
- Turbo-Cache nicht optimal genutzt
- Prisma Client wird im Runner neu generiert

**Geplante Optimierungen:**
1. **Service-spezifische Dockerfiles** (api/Dockerfile, worker/Dockerfile, web/Dockerfile)
2. **Schlankere Runner-Images** - nur Runtime-Dependencies
3. **Bessere Layer-Reihenfolge** - unveränderliche Dependencies zuerst
4. **pnpm Store Cache** - persistenter Cache über Builds hinweg
5. **Prisma Generate im Build-Stage** - nicht im Runner
6. **Standalone Next.js Output** - für Web kleineres Image
7. **Multi-Stage mit gezielten COPY** - nur nötige Artefakte pro Service

### 3.2 Ressourcenoptimierung

- **API Runner**: node:24-alpine + nur @nestjs/* + @prisma/client + bcrypt + ioredis + bullmq + passport + openid-client
- **Worker Runner**: node:24-alpine + nur @nestjs/* + @prisma/client + bullmq + ioredis + axios
- **Web Runner**: node:24-alpine + nur next + react + react-dom (standalone output)
- **PostgreSQL**: Alpine, shared_buffers=128MB, max_connections=100
- **Redis**: Alpine, appendonly=yes, maxmemory-policy=allkeys-lru
- **Volumes**: Nur postgres-data, redis-data, uploads-data (minio-data optional)

### 3.3 UI-Control-Matrix Konzept

Erstellung einer versionierten Datei `docs/ui-control-matrix.md` mit Spalten:
- Funktion, Zielrolle, UI-Einstiegspunkt, Auslösende Bedienelemente, Erwartetes Ergebnis, Berechtigungsprüfung, Fehlermeldung/-zustand, Zugehöriger Test

---

## 4. Messplan für Build-Dauer, Image-Größe und Laufzeitressourcen

### 4.1 Baseline (aktuell gemessen)

| Metrik | Wert | Ziel |
|--------|------|------|
| Produktionsbuild (clean) | ~20 Min | ≤15 Min |
| Production Image (versigo:latest) | 1.85 GB | <1 GB |
| Test Image (versigo-test:latest) | 1.04 GB | <800 MB |
| API Container Memory (idle) | TBD | <200 MB |
| Worker Container Memory (idle) | TBD | <150 MB |
| Web Container Memory (idle) | TBD | <150 MB |
| PostgreSQL Memory | TBD | <256 MB |
| Redis Memory | TBD | <50 MB |

### 4.2 Messmethodik

```bash
# Build-Zeitmessung (clean)
docker compose -f docker-compose.test.yml down -v
time docker compose build api web worker

# Image-Größen
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep versigo

# Laufzeit-Ressourcen (nach Start)
docker stats --no-stream versigo-api versigo-worker versigo-web versigo-db versigo-redis
```

### 4.3 CI-Integration

- Build-Dauer und Image-Größe in CI protokollieren
- Optional: Harter Timeout bei >20 Min (Plattform-Puffer)

---

## 5. Konzept für die UI-Control-Matrix

**Speicherort:** `docs/ui-control-matrix.md` (versioniert)

**Struktur:**
```markdown
| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
```

**Abdeckung:** Alle UI-Routen, Buttons, Links, Menüpunkte, Toggles, Dialoge, Form-Submits, destruktive Aktionen

**Rollen:** ADMIN, USER, READ_ONLY

---

## 6. Liste betroffener Dateien (geplant)

### Docker & Build
- `Dockerfile` → Aufsplitten in `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`
- `docker-compose.yml` - Anpassung an neue Images
- `docker-compose.test.yml` - Anpassung
- `.dockerignore` - Erweiterung
- `docker/start.sh` - Evtl. Service-spezifisch

### Konfiguration
- `apps/api/package.json` - Dependencies prüfen
- `apps/worker/package.json` - Dependencies prüfen
- `apps/web/package.json` - `output: 'standalone'` für Next.js
- `apps/web/next.config.ts` - Standalone Output konfigurieren
- `package.json` - Turbo Config prüfen
- `turbo.json` - Cache-Strategie

### Dokumentation
- `README.md` - Komplett überarbeiten (Warnhinweis, Funktionsübersicht, etc.)
- `docs/08-admin-operations.md` - Backup/Restore, Upgrade erweitern
- `docs/ui-control-matrix.md` - NEU
- `docs/beta-release-checklist.md` - NEU
- `docs/release-notes-template.md` - NEU
- `docs/docker-image-guide.md` - NEU
- `docs/troubleshooting.md` - NEU oder in 08-admin-operations

### UI & Tests
- UI-Audit aller Routes/Components
- Smoke-Tests erweitern (`scripts/compose-smoke-test.sh`)
- E2E-Tests für kritische Flows

### Sicherheit
- `.env.example` - Validierung, Beschreibungen
- Security Headers, CORS, Rate Limits prüfen

---

## 7. Neue Abhängigkeiten

**Keine neuen Runtime-Abhängigkeiten erforderlich.**

Mögliche Dev-Dependencies für Build-Optimierung:
- `@vercel/nft` (Next.js file tracing) - bereits in Next.js 16 enthalten
- Keine zusätzlichen Pakete nötig - Optimierung durch Konfiguration

**Maintenance-Prüfung:** Alle bestehenden Dependencies sind aktiv gewartet (NestJS 11, Next.js 16, Prisma 6, React 19, BullMQ 5).

---

## 8. Sicherheits- und Datenschutzrisiken

| Risiko | Status | Maßnahme |
|--------|--------|----------|
| Secrets in Logs | Offen | Log-Redaktion prüfen, Structured Logging |
| CORS Fehlkonfiguration | Offen | CORS_ORIGINS Validierung, Secure Defaults |
| Rate Limiting Bypass | Offen | TRUST_PROXY Dokumentation, Tests |
| Upload Path Traversal | Offen | Pfad-Validierung in Documents prüfen |
| SSRF bei Integrationen | Offen | URL-Validierung, Allowlists |
| Session Cookie Security | Offen | Secure, HttpOnly, SameSite prüfen |
| Default Admin in Prod | Gelöst | Fail-Fast ohne LOCAL_AUTH_ENABLED/OIDC_ENABLED |
| AI/Paperless Data Leakage | Offen | Secrets nie in UI/API Responses, Encryption |

---

## 9. Test-, Migrations-, Backup-/Restore- und Release-Plan

### 9.1 Tests
- Unit Tests: `pnpm run test` (alle Services)
- Integration Tests: API + DB + Redis in Test-Container
- E2E/Smoke: `scripts/compose-smoke-test.sh --build`
- Typecheck: `pnpm run typecheck`
- Lint: `pnpm run lint`
- i18n Guard: `pnpm --filter @versigo/web run test:i18n`

### 9.2 Migrationen
- `npx prisma migrate deploy` im Start-Script (idempotent)
- Migrationen sind backward-compatible (nur additive Änderungen)
- Downgrade: Nicht automatisiert, Restore aus Backup dokumentiert

### 9.3 Backup/Restore
- **Backup**: `pg_dump` für PostgreSQL, Volume-Snapshot für uploads-data
- **Restore**: `psql` Import, Volume-Restore, dann `docker compose up`
- Dokumentation in `docs/08-admin-operations.md`

### 9.4 Release-Plan
1. Feature-Freeze auf `main`
2. Release-Branch `release/v1.0.0-beta.x`
3. CI Pipeline: Build, Test, Smoke, Security Scan
4. Docker Images bauen, taggen, pushen (CI-Workflow)
5. Beta-Release-Checkliste abarbeiten
6. GitHub Release mit Release Notes erstellen
7. Merge nach `main` mit Tag

---

## 10. Nächste Schritte

1. ✅ Baseline gemessen (Build: ~20 Min, Image: 1.85 GB)
2. 🔄 Dockerfiles aufsplitten und optimieren
3. 🔄 Next.js Standalone Output konfigurieren
4. 🔄 Runner-Images schlank machen
5. 🔄 UI-Control-Matrix erstellen
6. 🔄 Dokumentation überarbeiten
7. 🔄 Beta-Checkliste und Release-Notes erstellen
8. 🔄 Docker-Image-Guide schreiben
9. 🔄 Alle Tests und Checks ausführen
10. 🔄 Review und Commit