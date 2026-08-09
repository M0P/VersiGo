# Beta Release Checklist – VersiGo v1.0.0-beta.1

**Version:** 1.0.0-beta.1  
**Datum:** 2026-08-07  
**Branch:** `fix/BugFix-09-ci-fix-community-standards-dockerhub` (BugFix-11, PR #28)  
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
| **6** | **Tests** | Unit Tests: 100% Pass (660 API-Tests, 58 Test-Files, Web 47, Worker 4, Foundation 107) | ✅ | `pnpm run test` |
| **7** | **Tests** | Integration Tests: Household-Isolation, DB | ✅ | Test-Container |
| **8** | **Tests** | i18n Guard: Keine hartkodierten deutschen UI-Texte | ✅ | `pnpm --filter @versigo/web run test:i18n` |
| **9** | **Tests** | Compose Smoke Test: Alle Steps Pass (inkl. 8p Household-Aktion, 9/9b Auth-Rejections, 10 Queue-Roundtrip, 11 Auth-Fail-Fast, 12 Produktions-Erfolgspfad mit Session-basierter Household-Aktion) | ✅ | `./scripts/compose-smoke-test.sh --build` (EXIT=0) |
| **10** | **Security** | Secrets nicht in Logs/Responses | ✅ | Smoke Test Steps 8b, 8j, 8k |
| **11** | **Security** | Auth Fail-Fast in Produktion; Admin nur bei expliziter Konfiguration (kein automatischer Default-Admin; `.env.example`-Platzhalter-Passwort wird in Produktion abgelehnt) | ✅ | Code Review + Smoke Test Steps 11 (Fail-Fast) und 12 (Produktions-Erfolgspfad mit starkem Passwort) |
| **12** | **Security** | CORS, Rate-Limit, TRUST_PROXY, COOKIE_SECURE dokumentiert & getestet | ✅ | Smoke Test + Docs |
| **13** | **Security** | Upload-Validierung, Path-Traversal-Schutz | ✅ | Code Review |
| **14** | **Security** | SSRF-Schutz bei Integrationen (Allowlists) | ✅ | Code Review |
| **15** | **Security** | Session Cookies: Secure (Default in Produktion, `COOKIE_SECURE`), HttpOnly, SameSite | ✅ | Code Review |
| **16** | **Security** | Abhängigkeitsrisiken geprüft (npm audit) | ✅ | `pnpm audit --prod`: **0 Advisories** (BugFix-11/B5: bcrypt 6.0.0 eliminiert den node-pre-gyp/tar/brace-expansion-Graph, next 16.2.12 + Overrides postcss ≥8.5.23/sharp ≥0.35.3/vite ≥6.4.3; vitest 3.2.x). Voll-Audit: 5 verbleibende HIGH ausschließlich Dev-Tooling (eslint/brace-expansion, eslint/js-yaml, @nestjs/cli/fast-uri) – nicht in Laufzeit-Images, Grund+Restrisiko siehe R-12 |
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
| R-12 | `npm audit --prod`: **0 Advisories** (BugFix-11/B5) | **Gelöst** | `pnpm audit --prod` = 0/0/0 (bcrypt 6.0.0 statt 5.1.1 eliminiert den @mapbox/node-pre-gyp→tar/rimraf/glob→minimatch→brace-expansion-Graph; next 16.2.12; pnpm-workspace.yaml `overrides`: postcss ≥8.5.23, sharp ≥0.35.3, vite ≥6.4.3; vitest 3.2.x). Voll-Audit (`pnpm audit`): 5 verbleibende HIGH ausschließlich in Dev-Tooling und damit NICHT in den Laufzeit-Images (API/Worker/Web installieren nur `--prod`-Deps): brace-expansion 1.1.16/5.0.8 via eslint@9-minimatch + @typescript-eslint/typescript-estree (DoS via Expansion, nur lokal bei Lint/Typecheck ausführbar, kein Netzwerk-/Datenzugriff), js-yaml 4.x via @eslint/eslintrc + @nestjs/cli/cosmiconfig (DoS, nur Dev), fast-uri <3.1.5 via @nestjs/cli/ajv (ReDoS, nur beim CLI-Install/Build). Kein Override, da Overrides auf diese fest gepinnten Dev-Ketten Tooling-Breakage riskieren ohne Sicherheitsgewinn für den Betrieb; Behebung folgt mit dem nächsten eslint/@nestjs/cli-Update (Dependabot) |
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