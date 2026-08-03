# PR: feat(AP-20): ready up for version 1

**Branch:** `feat/AP-20-ready-up-for-version-1` -> `main`
**Merge-Hinweis:** Dieser PR darf NICHT vom erstellenden Modell selbst gemergt werden. Merge erfolgt erst nach unabhaengigem Review und gruener CI (siehe prompts/00-gemeinsame-regeln.md).

## Ziel und Scope

VersiGo wird fachlich, technisch und dokumentarisch fuer eine erste geschlossene
Beta-Version vorbereitet: deutlich schnellerer und reproduzierbarer
Produktionsbuild, reduzierte Image-Groessen, vollstaendige UI-Bedienbarkeit
(Family-Sharing-UI + Household-Bootstrap + Abmelden/Konto-Loeschen in der UI),
UI-Vollstaendigkeitspruefung, belastbare Release-Verifikation
(Compose-Smoke-Test mit 12 Steps inkl. Auth-Fail-Fast und Produktions-
Erfolgspfad) sowie eine vollstaendige GitHub-Dokumentation (README,
Docker-Image-Guide, Beta-Checkliste, Release-Notes-Vorlage,
UI-Control-Matrix).

Die Anwendung bleibt ausdruecklich ein experimentelles, vollstaendig
AI-erstelltes Projekt und ist nicht fuer einen aus dem Internet erreichbaren
Betrieb vorgesehen.

## Architekturentscheidungen

1. **Per-App-Produktions-Dockerfiles** (`apps/api/Dockerfile`,
   `apps/worker/Dockerfile`, `apps/web/Dockerfile`) mit Multi-Stage-Builds
   (base -> deps -> build -> prod-deps -> runner). Entwicklungswerkzeuge,
   Quellcode und Paket-Manager-Caches verbleiben im Build, nicht im
   Runtime-Image.
2. **pnpm-deploy statt `pnpm install --prod`:** pnpm 11.17.0 linkt bei
   `--prod` keine Top-Level-Pakete (Regression); `pnpm deploy
   --filter <app> --prod --legacy` erzeugt einen selbstenthaltenen
   Produktions-`node_modules`-Baum.
3. **Prisma + TypeScript als Runtime-Dependencies** der API/Worker, damit
   `prisma migrate deploy` und `prisma generate` im Runner-Image ohne
   Dev-Dependencies funktionieren.
4. **Schema-Drift-Migration** (`20260803100000_ap20_schema_drift_policy_documents_coverage`):
   schliesst die Luecke zwischen `prisma/schema.prisma` und der
   Bestandsdatenbank (policy_documents-Spalten/Index/FK, ai_coverage_summaries,
   portal_account_links NOT NULL) – additiv mit Backfill.
5. **Production-faehiger Admin-Bootstrap:** Ein initialer Administrator
   (plus Referenz-Household `default`) wird in Produktion **nur** bei
   ausdruecklich gesetzter Konfiguration angelegt
   (`LOCAL_AUTH_ENABLED=true` + `LOCAL_ADMIN_USERNAME`/`LOCAL_ADMIN_PASSWORD`);
   das `.env.example`-Platzhalter-Passwort wird in Produktion abgelehnt.
   Kein automatischer Default-Admin (AP-20 P5, Fail-Fast bleibt).
6. **Auth-Fail-Fast in Produktion** ist im Code real und wird durch den
   neuen Smoke-Test Step 11 verifiziert (API verweigert den Start in
   `NODE_ENV=production` ohne konfigurierte Authentifizierung).

## Geaenderte / neue Dateien

### Backend (apps/api)
- `apps/api/Dockerfile` (neu, optimierter Multi-Stage-Build)
- `apps/api/package.json` (prisma + typescript als Runtime-Dependencies)
- `apps/api/src/features/identity/local-admin.bootstrap.ts` (DEFAULT_HOUSEHOLD_ID="default", Household-Upsert + Admin-Mitgliedschaft + Audit; Production-faehig bei expliziter Konfiguration)
- `apps/api/src/features/identity/user-admin.service.ts` (approve() nimmt User in Default-Household auf)
- `apps/api/src/features/family-sharing/household-members.controller.ts` (neu, GET /households/:householdId/members)
- `apps/api/src/features/family-sharing/family-sharing.service.ts` + `.module.ts` (listMembers)
- Tests: `household-members.controller.spec.ts` (neu), `local-admin.bootstrap.spec.ts`, `user-admin.service.spec.ts`, `family-sharing.service.spec.ts`

### Frontend (apps/web)
- `apps/web/Dockerfile` (neu, Next.js standalone, HOSTNAME=0.0.0.0 fuer Healthcheck)
- `apps/web/src/app/household/shares/` (neu, Family-Sharing-UI: erstellen/bearbeiten/widerrufen/bestaetigen, Dokument-Picker)
- `apps/web/src/app/settings/page.tsx` (Gefahrenzone: Konto loeschen via `DELETE /privacy/account`, Bestaetigung + 409-Last-Admin-Alert)
- `apps/web/src/components/ui/app-shell.tsx` (Abmelden-Button in Sidebar + Mobil-Topbar via `POST /auth/logout`)
- `apps/web/src/components/ui/nav-config.ts`, `apps/web/src/components/ui/icons.tsx` (Nav-Eintrag "Freigaben", sharing-Icon)
- `apps/web/src/i18n/locales/de.ts` + `en.ts` (vollstaendiger `shares`-Abschnitt; `nav.logout`; `settings.deleteAccount*`)
- `apps/web/src/styles/globals.css` (`.nav-item-logout`)
- `apps/web/next.config.ts`

### Worker
- `apps/worker/Dockerfile` (neu, optimierter Multi-Stage-Build)
- `apps/worker/package.json` (prisma + typescript als Runtime-Dependencies)

### Infrastruktur / CI
- `docker-compose.yml` (api/worker/web nutzen per-App-Dockerfiles; Worker-Health-Port 3100 nicht auf den Host publiziert; keine node-CMD/Entrypoint-Overrides mehr)
- `docker-compose.test.yml` (nutzt `Dockerfile.test`)
- `Dockerfile.test` (neu)
- `.github/workflows/ci.yml` (nicht-blockierender `build-metrics`-Job)
- `.github/workflows/publish.yml` (neu; nur Tags `v*` oder workflow_dispatch)
- `scripts/compose-smoke-test.sh` (Step 8p: zentrale Fachaktion Policy-create/list ueber /households/default; Step 11: Auth-Fail-Fast; Step 12: Produktions-Erfolgspfad auf frischer DB mit NODE_ENV=production + generiertem starkem Passwort inkl. Session-basierter Household-Aktion; Warteschleifen-Funktionen; /tmp-Cleanup mit expliziter Dateiliste)

### Datenbank
- `prisma/migrations/20260803100000_ap20_schema_drift_policy_documents_coverage/migration.sql` (neu)

### Dokumentation
- `README.md` (Funktionsuebersicht, Sicherheitsmodell, Docs-Links, AI-Warnhinweis unveraendert)
- `docs/docker-image-guide.md` (neu)
- `docs/ui-control-matrix.md` (v1.3, neu)
- `docs/beta-release-checklist.md` (neu)
- `docs/release-notes-template.md` (v1.1, neu)
- `docs/07-security-privacy.md`, `docs/08-admin-operations.md`, `docs/13-settings-catalog.md` (Bootstrap-Produktionssemantik, Upgrade-Pfad Default-Household, Worker-Health-Port nur intern, `COOKIE_SECURE`)
- `.env.example` (Bootstrap-Kommentar, NODE_ENV-Hinweis, `COOKIE_SECURE`)

### Session-Cookie `COOKIE_SECURE` (AP-20)
- `packages/foundation/src/config/app-config.schema.ts` + `settings-catalog.ts` (neues Feld `COOKIE_SECURE`, Default abgeleitet aus `NODE_ENV`: true in Produktion, sonst false)
- `apps/api/src/main.ts` (Session-Cookie `secure: config.get('COOKIE_SECURE')`)
- `docker-compose.yml` (API reicht `COOKIE_SECURE` durch)
- Hintergrund: Express-Session setzt bei `secure:true` ueber reines HTTP gar kein Cookie. Der Produktions-Smoke-Pfad (Schritt 12) setzt `COOKIE_SECURE=false` (reine Test-Infrastruktur), um die Produktionskette Bootstrap → Login → Session → Household-Aktion end-to-end zu verifizieren. In echten Deployments bleibt der Default (secure in Produktion) bestehen.

## Messwerte (Vorher/Nachher)

| Metrik | Vorher | Nachher |
|--------|--------|---------|
| Sauberer Produktionsbuild | bis zu 40 Min | ~8,5 Min gemessen |
| API-Image | 1,12 GB | ~839 MB |
| Worker-Image | 1,12 GB | ~828 MB |
| Web-Image | 240 MB | 240 MB |
| Dev-Tools im Runtime-Image | vorhanden | entfernt |

## Nachweis der Akzeptanzkriterien

| Kriterium | Umsetzung |
|---|---|
| Produktionsbuild deutlich schneller, Ziel ≤ 15 Min | ✅ ~8,5 Min sauberer Build, dokumentiert in `docs/docker-image-guide.md` |
| Images ohne Dev-Tools; Start im Compose-Produktionspfad | ✅ Images API/Worker/Web, laufen als `versigo-api`/`versigo-worker`/`versigo-web` |
| Image-Groessen dokumentiert | ✅ `docs/docker-image-guide.md` + Beta-Checkliste |
| UI-Control-Matrix fuer alle UI-steuerbaren Funktionen | ✅ `docs/ui-control-matrix.md` (v1.3) |
| Alle sichtbaren Bedienelemente geprueft, kritische Aktionen getestet | ✅ UI-Vollstaendigkeitspruefung (AP-20): Abmelden + Konto-Loeschen in die UI ergaenzt; Control-Matrix + Family-Sharing-UI-Tests (42 Web-Tests) |
| Berechtigungen konsistent (UI + API) | ✅ AuthGuard + RolesGuard + HouseholdMembershipGuard, Smoke Steps 9/9b |
| README mit AI-Warnhinweis | ✅ README.md Zeilen 5-12 (unveraendert, nicht relativiert) |
| Docker-Image-Anleitung (bauen/taggen/pushen/betreiben) | ✅ `docs/docker-image-guide.md` (inkl. Architekturen/Buildx §3.4, Laufzeit-Netzwerkzugriff §1) |
| Frischer Compose-Smoke-Test, Upgrade-/Migrations-, Backup-/Restore-Verfahren | ✅ Smoke-Test 12 Steps EXIT=0; `docs/08-admin-operations.md` + Image-Guide |
| Beta-Release-Checkliste und Release-Notes-Vorlage versioniert | ✅ `docs/beta-release-checklist.md`, `docs/release-notes-template.md` |
| Alle Qualitaetspruefungen gruen | ✅ Lint, Typecheck, i18n-Guard, 596 API-Tests (55 Files), Web 42, Worker 4, Foundation 95 |

## Ausgefuehrte Befehle und Ergebnisse

- `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` -> EXIT=0 (Lint, Typecheck, i18n-Guard, alle Tests)
- `./scripts/compose-smoke-test.sh --build --clean` -> EXIT=0 (12 Steps inkl. 8p Policy-Fachaktion, 11 Auth-Fail-Fast, 12 Produktions-Erfolgspfad mit frischer DB inkl. Session-basierter Household-Aktion; `COOKIE_SECURE=false` nur fuer den Smoke-Lauf)
- Prisma-Migration auf Bestandsdatenbank angewendet (`prisma migrate deploy`), danach Policy-Create HTTP 201 + Liste

## Dependency-Pruefung

Keine neuen Laufzeit-Abhaengigkeiten von Drittanbietern. `prisma` und
`typescript` wurden von (Root-)DevDependencies in die Runtime-Dependencies
von `apps/api` und `apps/worker` verschoben (bereits vorhandene, gepflegte
Pakete; noetig fuer `prisma migrate deploy`/`generate` im Runner-Image).
`pnpm-lock.yaml` konsistent aktualisiert.

## Sicherheits- und Datenschutzbewertung

- Fail-Fast: Produktion startet ohne konfigurierte Authentifizierung nicht.
- Kein automatischer Default-Admin in Produktion; `.env.example`-Platzhalter-Passwort wird dort abgelehnt.
- Keine Secrets in Logs/Responses (Smoke Steps 8b/8j/8k, Log-Redaktion unveraendert).
- Family-Sharing-UI und Members-Endpoint nur mit AuthGuard + HouseholdMembershipGuard + Rollenpruefung.
- Keine Telemetrie/Tracking; keine neuen Datenfliesse.
- Worker-Health-Port (3100) wird nicht auf den Host veroeffentlicht; er ist nur intern im Compose-Netz erreichbar (Healthcheck + Smoke-Test pruefen im Container).
- `pnpm audit --prod`: 26 transitive Advisories (1 critical, 15 high, 10 moderate; tar/bcrypt, next, sharp, postcss) – dokumentiert als R-12 in der Beta-Checkliste; kein Upgrade ohne Regressionstest; entschaerft durch privates, nicht oeffentlich erreichbares Hosting (siehe README-Warnhinweis).

## Bekannte Grenzen

- Downgrade der Datenbank wird nicht automatisiert unterstuetzt; Wiederherstellung ueber Backup (dokumentiert).
- CI-Smoke-Job fuehrt einen reduzierten Step-Satz aus; der vollstaendige 12-Step-Smoke-Test wurde lokal ausgefuehrt (dokumentiert).
- `FamilySharingService.checkPermission` vergleicht Berechtigungen exakt statt hierarchisch (WRITE-Share erfuellt ggf. keine READ-Anforderung) – vorbestehend, als Follow-up vorgemerkt.
- **Kein Browser-E2E (Playwright/Puppeteer) in `apps/web`:** Kritische UI-Flows sind durch Web-Unit-Tests (42 Tests), die API-Smoke-Steps pro Rolle und die UI-Control-Matrix abgedeckt; ein browserbasiertes E2E-Set ist als bekanntes Limit dokumentiert (Beta, keine neue Abhaengigkeit).
- **Accessibility:** Tastaturbedienbarkeit/Fokus/Labels/Kontrast folgen dem bestehenden Design-System (semantische Buttons/Links, aria-labels, Fokus-Styles); ein eigenstaendiges a11y-Audit/Tooling (z. B. axe) ist nicht vorhanden (Beta-Limit, siehe Checkliste).
- **API-only-Funktionen (Audit/Monitoring/Worker-Health/Datenexport):** Bewusst ohne UI, da privat gehostete Beta – Begruendung in `docs/ui-control-matrix.md` §8 (AP-20 User-Clarification).
