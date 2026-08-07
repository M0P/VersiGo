# BugFix-03: Post-BugFix-02 Issues – Lint, Middleware, Runtime Config

## Kontext
Nach Abschluss von BugFix-02 (Manual Test Findings) wurde eine manuelle Testumgebung auf Ports 2475 (Web) / 2473 (API) gestartet. Dabei traten folgende Probleme auf, die ein weiteres Testen blockieren.

## Befunde

### 1. Lint-Fehler in neuen Komponenten (BugFix-02 Regression)
- **Datei:** `apps/web/src/app/policies/[id]/covered-persons-tab.tsx` Zeile 6
  - `Select` importiert aber nie verwendet
- **Datei:** `apps/web/src/app/policies/[id]/page.tsx` Zeile 11
  - `EmptyState` importiert aber nie verwendet
- **Auswirkung:** `pnpm run lint` schlägt fehl, CI blockiert

### 2. Middleware blockiert `/runtime-config.js` (Kritisch)
- **Symptom:** Die Edge-Middleware in `apps/web/src/middleware.ts` leitet Anfragen an `/runtime-config.js` auf `/login` um, da der Pfad nicht in `PUBLIC_PATHS` enthalten ist.
- **Folge:** 
  - Das Runtime-Config-Skript wird nicht geladen
  - `getApiBaseUrl()` fällt auf Build-Time-Default `http://localhost:3001` zurück
  - API läuft aber auf Port 2473 (konfiguriert via `NEXT_PUBLIC_API_BASE_URL=http://localhost:2473`)
  - Login-Seite kann `/auth/config` nicht erreichen → zeigt "Der Anmeldedienst ist derzeit nicht verfügbar"
  - Alle API-Calls aus dem Frontend gehen an den falschen Port
- **Erwartung:** `/runtime-config.js` muss in `PUBLIC_PATHS` aufgenommen werden (wie `/_next`, `/favicon.ico`)

### 3. Login-Seite zeigt "Anmeldedienst nicht verfügbar"
- **Ursache:** Direkte Folge von Problem #2 – die Login-Seite lädt die Auth-Konfiguration via `fetch(`${apiBaseUrl}/auth/config`)`, aber `apiBaseUrl` ist falsch (3001 statt 2473).
- **Erwartung:** Nach Fix von #2 funktioniert Login wieder automatisch.

## Auswirkungen
- Manuelles Testen der BugFix-02-Features ist **blockiert**
- CI/Lint schlägt fehl
- Login funktioniert nicht über Web-UI (API direkt via curl funktioniert)

## Nächste Schritte (Scope für BugFix-03)
1. **Lint-Fehler beheben** – ungenutzte Imports in `covered-persons-tab.tsx` und `page.tsx` entfernen
2. **Middleware korrigieren** – `/runtime-config.js` zu `PUBLIC_PATHS` in `apps/web/src/middleware.ts` hinzufügen
3. **Verifizierung** – Testumgebung auf Ports 2475/2473 starten, Login testen, alle BugFix-02-Akzeptanzkriterien prüfen

## Nicht in BugFix-03 (spätere Pakete)
- Neue Features
- OIDC-Auto-Provisioning
- Paperless Auto-Sync
- Notifications UI
- Browser-E2E-Tests (Playwright)

## Akzeptanzkriterien für BugFix-03
- `pnpm run lint` läuft fehlerfrei durch
- `pnpm run typecheck` läuft fehlerfrei durch
- `pnpm run test` alle Tests grün
- Testumgebung startet auf Ports 2475/2473 via `.env.test-manual`
- Login über Web-UI funktioniert (localadmin / CHANGE_ME_FOR_LOCAL_DEVELOPMENT)
- Alle BugFix-02-Akzeptanzkriterien erfüllbar:
  - `/admin/settings` lädt 15+ Katalog-Einträge
  - Policy Create/Edit zeigt alle Felder
  - Registrierung mit strukturierten Validierungsfehlern
  - Navigation → Administration → "Benutzerverwaltung" erreichbar
  - Policy Detail Tabs (Master Data, Covered Persons, Documents, Portal Links, Coverage, Costs) funktional
- Bestehende Tests (Unit, Integration, Smoke) bleiben grün
- Keine Regression bei BugFix-02-Features

## Referenzen
- BugFix-02: `prompts/BugFix-02-manual-test-findings.md`
- Middleware: `apps/web/src/middleware.ts`
- Runtime Config: `apps/web/src/lib/runtime-config.ts`, `apps/web/docker-entrypoint.sh`
- Lint-Fehler: `apps/web/src/app/policies/[id]/covered-persons-tab.tsx:6`, `apps/web/src/app/policies/[id]/page.tsx:11`