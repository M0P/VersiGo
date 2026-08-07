# Beta Release Checklist – VersiGo v1.0.0-beta

**Version:** 1.0.0-beta  
**Datum:** 2026-08-03  
**Branch:** `feat/AP-20-ready-up-for-version-1` → `main`  
**Status:** ⏳ In Review

---

## Go / No-Go Kriterien

| # | Kategorie | Kriterium | Status | Nachweis |
|---|-----------|-----------|--------|----------|
| **1** | **Build** | Produktionsbuild ≤ 15 Min (Clean Build) | ✅ | ~8.5 Min gemessen |
| **2** | **Build** | Images enthalten keine Dev-Tools/Dependencies (auch kein Prisma-CLI-Graph: effect, @prisma/config – BugFix-10) | ✅ | API ~339 MB, Worker ~333 MB, Web ~206 MB |
| **3** | **Build** | Image-Größen dokumentiert (Vorher/Nachher) | ✅ | Vorher: API 1.12 GB, Worker 1.12 GB, Web 240 MB; Nachher: API ~339 MB, Worker ~333 MB, Web ~206 MB, Migration ~297 MB (siehe `docs/docker-image-guide.md`) |
| **4** | **Tests** | Lint: 0 Errors | ✅ | `pnpm run lint` |
| **5** | **Tests** | TypeCheck: 0 Errors (Strict Mode) | ✅ | `pnpm run typecheck` |
| **6** | **Tests** | Unit Tests: 100% Pass (596 API-Tests, 55 Test-Files, Web 42, Worker 4, Foundation 95) | ✅ | `pnpm run test` |
| **7** | **Tests** | Integration Tests: Household-Isolation, DB | ✅ | Test-Container |
| **8** | **Tests** | i18n Guard: Keine hartkodierten deutschen UI-Texte | ✅ | `pnpm --filter @versigo/web run test:i18n` |
| **9** | **Tests** | Compose Smoke Test: Alle Steps Pass (inkl. 8p Household-Aktion, 9/9b Auth-Rejections, 10 Queue-Roundtrip, 11 Auth-Fail-Fast, 12 Produktions-Erfolgspfad mit Session-basierter Household-Aktion) | ✅ | `./scripts/compose-smoke-test.sh --build` (EXIT=0) |
| **10** | **Security** | Secrets nicht in Logs/Responses | ✅ | Smoke Test Steps 8b, 8j, 8k |
| **11** | **Security** | Auth Fail-Fast in Produktion; Admin nur bei expliziter Konfiguration (kein automatischer Default-Admin; `.env.example`-Platzhalter-Passwort wird in Produktion abgelehnt) | ✅ | Code Review + Smoke Test Steps 11 (Fail-Fast) und 12 (Produktions-Erfolgspfad mit starkem Passwort) |
| **12** | **Security** | CORS, Rate-Limit, TRUST_PROXY, COOKIE_SECURE dokumentiert & getestet | ✅ | Smoke Test + Docs |
| **13** | **Security** | Upload-Validierung, Path-Traversal-Schutz | ✅ | Code Review |
| **14** | **Security** | SSRF-Schutz bei Integrationen (Allowlists) | ✅ | Code Review |
| **15** | **Security** | Session Cookies: Secure (Default in Produktion, `COOKIE_SECURE`), HttpOnly, SameSite | ✅ | Code Review |
| **16** | **Security** | Abhängigkeitsrisiken geprüft (npm audit) | ⚠️ | `pnpm audit --prod`: 26 Advisories (10 moderate, 15 high, 1 critical) – ausschließlich transitiv (tar via bcrypt/node-pre-gyp, next, sharp, postcss, brace-expansion). Kein Upgrade ohne separate Prüfung (R-12); entschärft durch privates, nicht aus dem Internet erreichbares Beta-Hosting |
| **17** | **Docs** | README mit prominentem AI-Warnhinweis (Deutsch) | ✅ | README.md Zeilen 5-12 |
| **18** | **Docs** | Funktionsübersicht korrekt & vollständig | ✅ | README.md Tabelle |
| **19** | **Docs** | UI Control Matrix versioniert | ✅ | `docs/ui-control-matrix.md` (v1.3) |
| **20** | **Docs** | Betriebsanleitung (Backup, Restore, Upgrade, Migration) | ✅ | `docs/08-admin-operations.md` |
| **21** | **Docs** | Konfigurationsreferenz (alle Env-Vars, Purpose, Required, Example, Security, Service) | ✅ | `.env.example` (pro Variable) + README §Konfiguration (Kategorie-Tabelle mit Beispielwert & Sicherheitsrelevanz) |
| **22** | **Docs** | Ports, Volumes, Daten pro Service dokumentiert | ✅ | README.md Tabelle |
| **23** | **Docs** | AI/Externe Integrationen: Optional, Daten, Deaktivierung | ✅ | README.md Tabelle |
| **24** | **Docs** | Tool-Dokumentation (Docker, pnpm, Node, Turbo, Prisma, Redis, Test-Befehle) | ✅ | README.md |
| **25** | **Docs** | Troubleshooting (10+ häufige Fehler) | ✅ | README.md Tabelle |
| **26** | **Docs** | Beta-Grenzen offen dokumentiert (kein Public Hosting, keine Zertifizierung, etc.) | ✅ | README.md |
| **27** | **Docs** | Docker Image Guide (Build, Tag, Push, Deploy, Upgrade, Rollback, Restore) | ✅ | `docs/docker-image-guide.md` |
| **28** | **Docs** | UI-Vollständigkeitsprüfung (AP-20): jede benutzer-/admin-steuerbare Funktion hat einen UI-Einstiegspunkt; API-only-Funktionen begründet dokumentiert | ✅ | `docs/ui-control-matrix.md` §8 + Control-Matrix-Tabellen (§1: Abmelden + Konto-Löschen ergänzt) |
| **28** | **Ops** | Frische Installation via Docker Compose getestet | ✅ | Smoke Test |
| **29** | **Ops** | Upgrade/Migrationspfad getestet (idempotente Migrationen) | ✅ | Smoke Test + `docs/08-admin-operations.md` |
| **30** | **Ops** | Backup/Restore Verfahren dokumentiert & getestet | ✅ | `docs/08-admin-operations.md` |
| **31** | **Ops** | Mindestressourcen & Empfehlungen dokumentiert | ✅ | README.md Tabelle |
| **32** | **Release** | Beta Release Checklist versioniert | ✅ | Diese Datei |
| **33** | **Release** | Release Notes Template versioniert | ✅ | `docs/release-notes-template.md` |
| **34** | **Release** | Changelog seit letztem Release | ✅ | `docs/release-notes-template.md` |
| **35** | **Release** | Bekannte Limits & bewusst nicht umgesetzte Punkte dokumentiert | ✅ | README.md + Control Matrix |

---

## Offene Risiken / Bekannte Limits (Akzeptiert für Beta)

| ID | Risiko / Limit | Schwere | Begründung / Mitigation |
|----|----------------|---------|-------------------------|
| R-01 | Family Sharing: Keine UI | **Gelöst** | UI `/household/shares` + Members-Endpoint (`GET /households/:householdId/members`) in AP-20 umgesetzt |
| R-02 | Notifications: Nur API-Skelett | Niedrig | Nicht für Beta-Kernfunktionen erforderlich |
| R-03 | Paperless-Sync: Kein Auto-Sync | Niedrig | Nur Konfiguration + Test in Beta |
| R-04 | Portal-Connector Plugin "Mailbox Sync": Experimentell, deaktiviert | Niedrig | `available: false`, dokumentiert |
| R-05 | OIDC: Kein Auto-Provisioning | Niedrig | ADR-007: Admin muss Binding setzen (Sicherheit) |
| R-06 | Keine automatische DB-Rückwärtsmigration | Mittel | Restore via Backup dokumentiert |
| R-07 | Single-Tenant only (Households) | Niedrig | Design-Entscheidung, kein Multi-Tenant |
| R-08 | Image-Größe API/Worker ~1.1 GB (Ziel <1 GB) | **Gelöst** | Prod-only-Deps via `pnpm deploy --prod` + Prisma-CLI-Graph als devOnly (BugFix-10): API ~339 MB, Worker ~333 MB, Migration ~297 MB (siehe `docs/docker-image-guide.md`) |
| R-09 | Keine vollständige i18n (nur de/en) | Niedrig | AP-21 Scope erfüllt |
| R-10 | Kein Browser-E2E (Playwright/Puppeteer) in `apps/web` | Niedrig | Kritische UI-Flows: Web-Unit-Tests (42), API-Smoke-Steps pro Rolle, Control-Matrix; kein neues E2E-Framework für Beta (bewusste Grenze) |
| R-11 | Kein eigenständiges Accessibility-Tooling (z. B. axe); Tastatur/Fokus/Labels/Kontrast folgen dem Design-System | Niedrig | Semantische Buttons/Links, aria-labels, sichtbare Fokus-Styles im Design-System; manuelle Prüfung im Review, kein automatisierter a11y-Lauf (bewusste Grenze) |
| R-12 | `npm audit --prod`: 26 transitive Advisories (1 critical, 15 high, 10 moderate) | Mittel | Ausschließlich transitiv (tar/bcrypt, next, sharp, postcss); kein Upgrade ohne Regressionstest. Mitigation: privates, nicht aus dem Internet erreichbares Beta-Hosting, kein öffentlicher Betrieb (README-Warnhinweis); Priorisierung als Follow-up (AP-23) dokumentiert |
| R-13 | CI-Smoke-Job (`compose-smoke`) führt nur einen reduzierten Step-Satz aus (Health/Ready/Web/DB); der vollständige 12-Step-Smoke-Test inkl. Produktions-Erfolgspfad (Schritt 12) läuft nur lokal | Niedrig | Voller Smoke-Test bei jedem Release vor Ort ausgeführt (Checkliste Zeile 9); Schritt 12 verifiziert Bootstrap, Login, Session und Household-Aktion unter `NODE_ENV=production` auf frischer DB. CI-Erweiterung als optionaler Follow-up notiert (PR_DESCRIPTION bekannte Grenzen) |

---

## Sign-off

| Rolle | Name | Datum | Entscheidung |
|-------|------|-------|--------------|
| Development | – | 2026-08-02 | ✅ Ready |
| Code Review | – | – | ⏳ Pending |
| Security Review | – | – | ⏳ Pending |
| Release Manager | – | – | ⏳ **Go / No-Go** |

---

## Go / No-Go Entscheidung

**☐ GO** – Alle kritischen Kriterien erfüllt, offene Risiken akzeptiert  
**☐ NO-GO** – Kritische Kriterien nicht erfüllt, Blockierer vorhanden

**Begründung:** _______________________________________________________________

**Entscheider:** _________________________ **Datum:** _______________ **Unterschrift:** _______________