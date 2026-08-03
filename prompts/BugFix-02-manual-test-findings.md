# BugFix-02: Manual Test Findings – Missing/broken UI functionality

## Kontext
Nach Abschluss von AP-20 (Beta-Ready) wurde eine manuelle Testumgebung auf Ports 2478 (Web) / 2479 (API) gestartet. Der Tester (Projekt-Owner) hat folgende Lücken gefunden, die ein weiteres Testen blockieren.

## Befunde

### 1. Admin-Systemeinstellungen (`/admin/settings`) bleiben leer
- **Symptom:** Seite lädt, zeigt aber dauerhaft "Loading system settings..." (Spinner).
- **API-Seite:** `GET /admin/system-config` liefert 15 Einträge korrekt zurück (Kategorien: KI-Assistent, Paperless-ngx, Authentifizierung, Speicher, …), wenn mit korrektem `Origin`-Header und Session-Cookie aufgerufen.
- **Verdacht:** Client-seitiger Fetch im Browser schlägt fehl – vermutlich CORS- / Cookie-Problem durch die nicht-standardmäßigen Ports (2478/2479). Die Web-App wurde mit `NEXT_PUBLIC_API_BASE_URL=http://localhost:2479` gebaut, aber der Cookie-Name / SameSite / Secure-Flag könnte bei `localhost` + abweichendem Port Probleme machen.
- **Erwartung:** Alle Katalog-Einträge (AP-17) sind in der UI sichtbar, editierbar (Runtime), mit Connection-Test-Buttons wo `connectivityTestable=true`.

### 2. Versicherungs-Details in der UI unvollständig
- **Fehlende Felder beim Anlegen/Bearbeiten einer Police (`/policies/new`, `/policies/[id]`):**
  - Vertragsdatei (Upload/Anzeige)
  - Monatlicher Beitrag (Betrag + Währung + Intervall)
  - Portal-URL (Link zum Versicherer-Portal)
  - Versicherte Personen (Bezug zum Haushalt / Family Sharing)
  - Weitere Metadaten: Versicherungsart, Deckungssumme, Selbstbeteiligung, Laufzeit, Kündigungsfrist, …
- **Status quo:** Policy-Formular deckt nur Basisfelder ab (Vertragsnummer, Anbieter, Typ, Status). Die Datenmodell-Erweiterungen (AP-03, AP-04, AP-05) sind im Backend vorhanden, aber das Frontend-Formular wurde nicht mitgewachsen.
- **Erwartung:** Vollständiges, validiertes Formular für alle Policy-Felder laut Prisma-Schema / API-DTO.

### 3. Registrierung neuer Nutzer schlägt fehl ohne Fehlermeldung
- **Symptom:** `POST /auth/register` gibt HTTP 400 zurück, Body: `{ "message": "Registrierung fehlgeschlagen. Bitte überprüfen Sie Ihre Eingaben." }` – keine Feld-spezifischen Validierungsfehler.
- **Mögliche Ursachen:**
  - Passwort-Policy (Mindestlänge 12, Komplexität) wird im Frontend nicht angezeigt / nicht validiert.
  - Benutzername kollidiert (case-insensitive?) oder reservierte Wörter.
  - Household-Zuordnung fehlt (neue User brauchen Default-Household-Membership erst nach Admin-Freischaltung, aber Registrierung selbst sollte funktionieren).
  - API-Validierung wirft generischen 400 statt strukturierter `ValidationError`-Response (Zod/Class-Validator).
- **Erwartung:** Klare, feldbezogene Fehlermeldungen (z. B. "Passwort muss mindestens 12 Zeichen enthalten", "Benutzername bereits vergeben") – sowohl client-seitig (HTML5/React-Validation) als auch server-seitig (strukturierter Error-Response).

### 4. Admin-Nutzerverwaltung (`/admin/users`) nicht in der Navigation verlinkt
- **Symptom:** Nach Registrierung erscheint "Admin muss freischalten", aber der Admin findet **keinen Menüeintrag** für die Nutzerverwaltung.
- **Ursache:** Die Seite `apps/web/src/app/admin/users/page.tsx` existiert vollständig (Liste, Filter, Approve/Reject/Disable/Enable, Rollenzuweisung), aber in `apps/web/src/components/ui/nav-config.ts` fehlt der Eintrag `{ href: '/admin/users', label: 'nav.adminUsers', icon: 'users' }` im `nav.administration`-Abschnitt.
- **Erwartung:** Menüeintrag "Nutzerverwaltung" (oder i18n-Key `nav.adminUsers`) unter Administration sichtbar für ADMIN-Rolle; Klick öffnet `/admin/users` mit Pending-Approval-Usern oben (Filter default).

### 5. GitHub CI: Web-Docker-Build schlägt fehl (`next: not found`)
- **Symptom:** In der GitHub Actions CI (`docker compose build web`) bricht der Build im `build`-Stage ab:
  ```
  @versigo/web:build: $ next build
  sh: next: not found
  [WARN] Local package.json exists, but node_modules missing, did you mean to install?
  ```
- **Ursache:** Der `deps`-Stage installiert nur `@versigo/web...` (gefiltert), aber der `build`-Stage führt `pnpm run build --filter @versigo/web` vom Repository-Root aus. Dabei wird das `next`-Binary nicht gefunden, weil es im `apps/web/node_modules/.bin/` liegt, nicht im Root-`node_modules/.bin/`. Der `COPY --from=deps /app/node_modules ./node_modules` kopiert nur den Root-`node_modules`, in dem `next` nicht verlinkt ist (pnpm Workspace-Struktur).
- **Erwartung:** Web-Docker-Build läuft in CI durch (lokal funktioniert er wegen Cache/vorhandener `node_modules`). Fix: Entweder im `build`-Stage `cd apps/web && pnpm run build` ausführen, oder `deps`-Stage alle Workspace-Deps installieren lassen (`pnpm install --frozen-lockfile` ohne Filter), oder `PATH` im Build-Stage um `apps/web/node_modules/.bin` erweitern.

## Auswirkungen
- Manuelles Testen der Beta-Funktionen ist **blockiert**.
- Admin kann keine Systemeinstellungen setzen (KI, Paperless, Auth-Parameter, Speicher).
- Versicherungen können nicht vollständig erfasst werden.
- Neue Nutzer können sich nicht registrieren → kein Test von Freischaltung, Household-Mitgliedschaft, Family Sharing, READ_ONLY-Rolle, Sprachwahl etc.

## Nächste Schritte (Scope für BugFix-02)
1. **Admin-Settings UI reparieren** – CORS/Cookie/Origin für nicht-Standard-Ports prüfen; ggf. `NEXT_PUBLIC_API_BASE_URL` zur Laufzeit auflösen statt Build-time; Cookie-Domain/SameSite für `localhost` + Port anpassen.
2. **Policy-Formular vervollständigen** – alle Felder aus `InsurancePolicy` / `CreatePolicyDto` / `UpdatePolicyDto` im Frontend abbilden (inkl. File-Upload für Vertragsdokument, falls `STORAGE_ENABLED=true`).
3. **Registrierung-Validierung** – strukturierte Validierungsfehler zurückgeben (Zod/Class-Validator → `ValidationPipe`); Frontend zeigt Feld-Fehler inline an; Passwort-Policy dokumentiert & client-seitig gespiegelt.
4. **Admin-Nutzerverwaltung in Navigation aufnehmen** – Eintrag in `nav-config.ts` unter `nav.administration` hinzufügen; i18n-Keys `nav.adminUsers` (de/en) ergänzen; Sichtbarkeit auf ADMIN-Rolle beschränkt (wie `/admin/settings`).
5. **Web-Docker-Build in CI reparieren** – `apps/web/Dockerfile` anpassen, damit `next build` im Build-Stage das `next`-Binary findet (z. B. `cd apps/web && pnpm run build` oder volle Workspace-Installation im `deps`-Stage).

## Nicht in BugFix-02 (spätere Pakete)
- OIDC-Auto-Provisioning (ADR-007)
- Paperless Auto-Sync
- Notifications UI
- Browser-E2E-Tests (Playwright)
- Vollständige i18n über de/en hinaus

## Akzeptanzkriterien für BugFix-02
- `/admin/settings` lädt alle 15+ Katalog-Einträge, Edit/Save/Reset/Test funktionieren.
- Policy-Create/Edit zeigt **alle** Felder des Datenmodells; Speichern persistiert korrekt.
- `POST /auth/register` gibt bei Validierungsfehlern strukturierte Feld-Fehler zurück; Frontend zeigt sie benutzerfreundlich an; erfolgreiche Registrierung legt User mit `PENDING_APPROVAL` an.
- **Navigations-Eintrag "Nutzerverwaltung" unter Administration sichtbar für ADMIN**; `/admin/users` öffnet sich, Pending-Approval-User sind filterbar; Approve/Reject funktionieren.
- **UI-Vollständigkeitsprüfung:** Der Agent prüft erneut die `docs/ui-control-matrix.md` (§1–§6) und stellt sicher, dass **jede benutzer-/admin-steuerbare Fachfunktion** (ausgenommen die in §8 dokumentierten API-only-Funktionen) über einen expliziten UI-Einstiegspunkt (Button, Link, Menüpunkt, Dialog) erreichbar ist. Fehlende Einstiegspunkte werden im PR dokumentiert und nachgereicht.
- **GitHub CI Web-Build läuft durch** – `docker compose build web` (bzw. CI-Workflow) baut das Web-Image ohne `next: not found`-Fehler.
- Bestehende Tests (Unit, Integration, Smoke) bleiben grün.
- Keine Regression bei AP-20-Features (Bootstrap, Family Sharing, Logout, Account Delete, Language Selector).

## Referenzen
- AP-17: `docs/13-settings-catalog.md`, `apps/web/src/app/admin/settings/page.tsx`, `apps/api/src/features/admin/settings-resolver.service.ts`
- AP-03/04/05: `prisma/schema.prisma` (InsurancePolicy, PolicyDocument, CostEntry), `apps/api/src/features/policies/`
- AP-16: `apps/api/src/features/identity/auth-local.controller.ts`, `apps/web/src/app/register/page.tsx`
- AP-16/AP-20: `apps/web/src/app/admin/users/page.tsx`, `apps/web/src/components/ui/nav-config.ts` (Navigationseintrag fehlt)
- CI/Docker: `apps/web/Dockerfile` (Build-Stage `next: not found`), `.github/workflows/ci.yml` (compose build)