# Release Notes Template – VersiGo Beta

**Version:** `v1.0.0-beta.X`  
**Datum:** `YYYY-MM-DD`  
**Branch:** `main` (Tag: `v1.0.0-beta.X`)  
**Commit:** `<short-sha>`

---

## 🎯 Highlights

> Kurze Zusammenfassung der wichtigsten Änderungen für Endanwender und Admins (2-3 Sätze).

---

## 📦 Änderungen

### ✨ Neu (Features)

| Feature | Beschreibung | Issue/PR | Zielrolle |
|---------|--------------|----------|-----------|
| z.B. AI-Extraktion | Automatische Extraktion von Versicherungsdaten aus PDFs | #123 | USER, ADMIN |

### 🐛 Bugfixes

| Bug | Beschreibung | Issue/PR |
|-----|--------------|----------|
| z.B. Login-Rate-Limit | Fix: Rate-Limit sperrte alle User hinter Proxy | #456 |

### ♻️ Refactoring / Technische Verbesserungen

| Bereich | Beschreibung | Issue/PR |
|---------|--------------|----------|
| z.B. Docker Build | Multi-Stage Builds, Build-Zeit -60%, Images -40% | #789 |

### 📚 Dokumentation

| Dokument | Änderung |
|----------|----------|
| README | AI-Warnhinweis, Funktionsübersicht, Troubleshooting |
| `docs/08-admin-operations.md` | Backup/Restore, Upgrade, Migration |

---

## ⚙️ Migrationshinweise

> **Wichtig für Upgrades von vorherigen Versionen:**

### Datenbank-Migrationen
- `npx prisma migrate deploy` wird beim Container-Start automatisch ausgeführt (idempotent)
- Keine manuellen Schritte erforderlich
- Migrationen sind **additiv only** (keine Breaking Changes am Schema)

### Breaking Changes
- **Keine** in dieser Beta-Version

### Konfigurationsänderungen
| Variable | Alt | Neu | Aktion erforderlich |
|----------|-----|-----|---------------------|
| z.B. `AI_PROVIDER` | `ollama` | `ollama` \| `openai-compat` | Bei OpenAI-Compat: `AI_OPENAI_COMPAT_*` setzen |

### Deprecations
- Keine

---

## 🔒 Sicherheitsrelevanz

| Aspekt | Status | Details |
|--------|--------|---------|
| Auth Fail-Fast | ✅ | Kein Default-Admin in Produktion |
| Secrets Handling | ✅ | Verschlüsselt in DB, maskiert in UI, nie in Logs |
| CORS / Rate-Limit | ✅ | `TRUST_PROXY` nur hinter vertrauenswürdigem Proxy |
| Dependency Audit | ⚠️ | `npm audit` manuell prüfen vor Release |

---

## 📋 Bekannte Einschränkungen (Beta)

| Feature | Status | Workaround |
|---------|--------|------------|
| Notifications | ⚠️ Nur API-Skelett | Nicht für Beta relevant |
| Paperless Auto-Sync | ❌ Nicht implementiert | Manuell via Paperless-UI |
| Portal-Connector Plugin | ⚠️ Experimentell, deaktiviert | `available: false` in Katalog |
| DB-Rückwärtsmigration | ❌ Nicht automatisiert | Restore via `pg_dump` + Volume |

---

## 📊 Metriken (Build & Runtime)

| Metrik | Wert | Ziel | Status |
|--------|------|------|--------|
| Build-Zeit (Clean) | ~8.5 Min | ≤ 15 Min | ✅ |
| Image: API | ~839 MB (Prod-Deps only) | < 1 GB | ✅ |
| Image: Worker | ~828 MB (Prod-Deps only) | < 1 GB | ✅ |
| Image: Web | ~240 MB (Standalone) | < 500 MB | ✅ |
| Test-Dauer (Full Suite) | ~2 Min | < 5 Min | ✅ |
| Smoke-Test Dauer | ~3 Min | < 5 Min | ✅ |

---

## 🔗 Links

- **Changelog (vollständig):** `git log v1.0.0-beta.(X-1)..v1.0.0-beta.X --oneline`
- **PR:** `#XXX`
- **Docker Images:** `ghcr.io/<org>/versigo-api:v1.0.0-beta.X`, `versigo-worker`, `versigo-web`
- **Dokumentation:** `docs/` (README, ui-control-matrix, beta-release-checklist, docker-image-guide)

---

## ✅ Release Checkliste (Intern)

- [ ] Alle CI Checks grün (Lint, Typecheck, Tests, Smoke)
- [ ] Beta Release Checklist (`docs/beta-release-checklist.md`) vollständig ✅
- [ ] Docker Images gebaut, getaggt, gepusht
- [ ] Images verifiziert (`docker pull` + `docker run --rm <image> --version`)
- [ ] GitHub Release erstellt mit diesen Release Notes
- [ ] Tag `v1.0.0-beta.X` auf `main` gesetzt
- [ ] Changelog in `docs/release-notes-template.md` archiviert
- [ ] Nächste Version geplant (Issues für nächste Beta/RC)

---

## 📝 Nächste Schritte (Post-Release)

1. Community-Feedback sammeln (Issues, Discussions)
2. Bekannte Limits priorisieren (Notifications, Paperless Auto-Sync)
3. Security Audit (Dependency Scan, SAST)
4. Performance-Optimierung (Image-Größen < 1 GB)
5. Vorbereitung RC1 / v1.0.0

---

*Template Version: 1.1 | Stand: 2026-08-03*