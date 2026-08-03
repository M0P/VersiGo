# UI Control Matrix – VersiGo Beta

**Version:** 1.3  
**Datum:** 2026-08-03  
**Status:** Beta-Ready

---

## Legende

| Spalte | Bedeutung |
|--------|-----------|
| **Funktion** | Fachliche Bezeichnung der Funktion |
| **Zielrolle** | Rolle(n), die die Funktion nutzen darf (ADMIN, USER, READ_ONLY) |
| **UI-Einstiegspunkt** | Route / Menüpunkt in der Web-UI |
| **Bedienelemente** | Buttons, Links, Formulare, Toggles, Dialoge |
| **Erwartetes Ergebnis** | Was passiert bei erfolgreicher Ausführung |
| **Berechtigungsprüfung** | API-seitige Prüfung (Guard, Decorator) |
| **Fehlerzustand** | Anzeige bei Fehlern (Toast, Inline, Modal) |
| **Test** | Zugehöriger Test (Unit, Integration, E2E, Smoke) |

---

## 1. Authentifizierung & Benutzerverwaltung

| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
| Lokale Anmeldung | Alle (unauth) | `/login` | Formular (Username, Password), Submit-Button | Session-Cookie gesetzt, Redirect zu `/` | `LocalAuthGuard` | Toast "Ungültige Anmeldedaten", Formular bleibt | Smoke: `compose-smoke-test.sh` Step 5 |
| Registrierung | Alle (unauth) | `/register` | Formular (Username, DisplayName, Password), Submit-Button | Account mit Status `PENDING_APPROVAL` angelegt | `ThrottlerGuard` (Rate-Limit) | Toast "Registrierung fehlgeschlagen", Inline-Validierung | Smoke: Step 8o |
| OIDC Callback | Alle (unauth) | `/callback` | Automatisch (Redirect von IdP) | Session hergestellt oder Fehlerseite | `OidcAuthGuard` | Seite "Anmeldung fehlgeschlagen" mit Details | Unit: `oidc.strategy.spec.ts` |
| Admin: Benutzer freigeben | ADMIN | `/admin/users` | Button "Freigeben" pro User (Status `PENDING_APPROVAL`) | User-Status → `ACTIVE`, Toast "Benutzer freigegeben" | `RolesGuard(@Roles(GlobalRole.ADMIN))` | Toast "Keine Berechtigung" (403), Button disabled | Smoke: Step 8o |
| Admin: Rolle ändern | ADMIN | `/admin/users` | Select (READ_ONLY, USER, ADMIN), Button "Speichern" | Rolle aktualisiert, Toast "Rolle geändert" | `RolesGuard(@Roles(GlobalRole.ADMIN))` | Toast "Fehler beim Speichern", Select disabled | Smoke: Step 8o |
| Admin: Benutzer löschen | ADMIN | `/admin/users` | Button "Löschen" (nur bei Nicht-Admin-Usern), Confirm-Dialog | User gelöscht (Cascade), Toast "Benutzer gelöscht" | `RolesGuard(@Roles(GlobalRole.ADMIN))` + Last-Admin-Check | Toast "Letzter Admin kann nicht gelöscht werden" (409) | Smoke: Step 8m |
| Profil anzeigen | USER, ADMIN | `/settings` (Tab "Profil") | Anzeige: Username, DisplayName, Rolle, Sprache | Read-only Anzeige | `AuthGuard` | 401 Redirect zu `/login` | Smoke: Step 8e |
| Profil bearbeiten | USER, ADMIN | `/settings` (Tab "Profil") | Input "DisplayName", Button "Speichern" | DisplayName aktualisiert, Toast "Profil gespeichert" | `AuthGuard` | Toast "Fehler beim Speichern" | Unit: `profile.service.spec.ts` |
| Sprache ändern | USER, ADMIN | `/settings` (Tab "Profil") / Language-Selector in Topbar | Select (de/en), Button "Speichern" / Klick im Selector | Sprache persistent (USER/ADMIN) oder session-only (READ_ONLY) | `AuthGuard` | Toast "Ungültige Sprache" (400) | Smoke: Step 8n, 8o |
| Design wechseln | USER, ADMIN | `/settings` (Tab "Design") | Toggle Hell/Dunkel, Farb-Picker (8 Presets + Custom) | Theme + Akzentfarbe persistent gespeichert | `AuthGuard` | Toast "Fehler beim Speichern" | Unit: `user-preferences.service.spec.ts` |
| Abmelden | Alle (authentifiziert) | Sidebar (Eintrag unten) + Topbar (Mobil: Icon-Button) | Button "Abmelden" | Session serverseitig zerstört, Cookie gelöscht, Redirect `/login` | Session-basiert (auch ohne Guard, 204) | Redirect zu `/login` auch bei Netzwerkfehler | Smoke: Step 5 |
| Konto löschen (Self-Service) | USER, ADMIN | `/settings` (Bereich "Profil", Karte am Seitenende) | Button "Konto löschen", Confirm-Dialog (window.confirm) | Account + Daten gelöscht (außer Last-Admin), Redirect zu `/login` | `AuthGuard` + `@Roles(USER, ADMIN)` + Last-Admin-Check (409) | Inline-Alert "Letzter Admin kann Konto nicht löschen" (409) | Smoke: Step 8m |

---

## 2. Versicherungsverwaltung (Policy Registry)

| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
| Policies auflisten | USER, ADMIN, READ_ONLY | `/policies` | Tabelle mit Sortier/Filter, Button "Neue Police" | Liste aller Policies des Households | `AuthGuard` + `HouseholdMembershipGuard` | Leere State "Keine Policies" | Unit: `policy-registry.controller.spec.ts` |
| Police anlegen | USER, ADMIN | `/policies/new` | Formular (Typ, Versicherer, Vertragsnummer, Tarif, Laufzeit, Prämie, etc.), Submit | Police angelegt, Redirect zu Detail | `AuthGuard` + `HouseholdMembershipGuard` | Inline-Validierung (class-validator), Toast "Fehler" | Unit: `policy-registry.controller.spec.ts` |
| Police bearbeiten | USER, ADMIN (Owner) | `/policies/[id]` | Inline-Edit oder Modal, Button "Speichern" | Police aktualisiert, Toast "Gespeichert" | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check | Toast "Keine Berechtigung" (403) | Unit: `policy-registry.controller.spec.ts` |
| Police löschen | USER, ADMIN (Owner) | `/policies/[id]` | Button "Löschen", Confirm-Dialog | Police `status=ARCHIVED`, Toast "Archiviert" | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check | Toast "Fehler beim Archivieren" | Unit: `policy-registry.controller.spec.ts` |
| Versicherte Personen verwalten | USER, ADMIN (Owner) | `/policies/[id]` (Tab "Personen") | Button "Hinzufügen", Edit/Delete pro Person | CRUD für `covered_persons` | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check | Toast "Fehler" | Unit: `policy-registry.controller.spec.ts` |
| Kostenhistorie pflegen | USER, ADMIN (Owner) | `/policies/[id]` (Tab "Kosten") / `/household/costs` | Formular "Neuer Kosten-Eintrag", Tabelle mit Edit/Delete | CRUD für `policy_cost_entries` | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check | Toast "Fehler" | Unit: `cost-tracking.controller.spec.ts` |
| Dokumente hochladen | USER, ADMIN (Owner) | `/policies/[id]` (Tab "Dokumente") | Dropzone / File-Input, Kategorien-Select, Button "Hochladen" | Dokument in Storage + DB-Eintrag, Toast "Hochgeladen" | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check | Toast "Upload fehlgeschlagen" (Datei zu groß, falscher Typ) | Unit: `documents.controller.spec.ts` |
| Dokument löschen | USER, ADMIN (Owner) | `/policies/[id]` (Tab "Dokumente") | Button "Löschen" pro Dokument, Confirm | Dokument gelöscht (Storage + DB), Toast "Gelöscht" | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check | Toast "Fehler beim Löschen" | Unit: `documents.controller.spec.ts` |
| Portal-Links verwalten | USER, ADMIN (Owner) | `/policies/[id]` (Tab "Portale") | Button "Portal hinzufügen", Formular (Provider, URL, Hinweise), Edit/Delete | CRUD für `portal_account_links` | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check | Toast "Fehler" | Unit: `portal-connectors.controller.spec.ts` |
| AI-Extraktion starten | USER, ADMIN (Owner) | `/policies/[id]` (Tab "Dokumente") | Button "Mit AI extrahieren" pro Dokument (nur wenn AI_ENABLED) | Job in Queue `ai-extraction`, Status `PENDING` | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check + FeatureFlag `ai.enabled` | Button disabled + Tooltip "AI nicht konfiguriert" | Unit: `ai-assist.controller.spec.ts` |
| AI-Deckungszusammenfassung | USER, ADMIN (Owner) | `/policies/[id]` (Tab "Deckung") | Button "Zusammenfassung generieren" (nur wenn AI_ENABLED) | Job in Queue, Ergebnis als Markdown angezeigt | `AuthGuard` + `HouseholdMembershipGuard` + Owner-Check + FeatureFlag `ai.enabled` | Button disabled + Tooltip "AI nicht konfiguriert" | Unit: `ai-assist.controller.spec.ts` |

---

## 3. Kostenübersicht (Household)

| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
| Haushaltskosten anzeigen | USER, ADMIN, READ_ONLY | `/household/costs` | Tabelle (Monat/Jahr, Summe, Diagramm), Filter | Aggregierte Kosten aller Policies des Households | `AuthGuard` + `HouseholdMembershipGuard` | Leere State "Keine Kosten" | Unit: `cost-tracking.controller.spec.ts` |

---

## 4. Administration (nur ADMIN)

| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
| Dashboard | ADMIN | `/admin` | Kacheln: User-Count, Policy-Count, System-Status | Übersicht | `RolesGuard(@Roles(GlobalRole.ADMIN))` | 403 Redirect zu `/forbidden` | Smoke: Step 8b |
| Systemeinstellungen | ADMIN | `/admin/settings` | Tabelle aller Settings (Key, Value, Source, Actions), Edit/Delete/Reset pro Row | CRUD für `global_integration_settings` + `household_integration_settings` | `RolesGuard(@Roles(GlobalRole.ADMIN))` | Toast "Fehler beim Speichern", Inline-Validierung | Smoke: Step 8b, 8d |
| Feature-Flags | ADMIN | `/admin/feature-flags` | Tabelle (Key, Enabled, Scope), Toggle pro Flag | CRUD für `global_feature_flags` + `household_feature_flags` | `RolesGuard(@Roles(GlobalRole.ADMIN))` | Toast "Fehler beim Umschalten" | Smoke: Step 8b |
| Integrationen testen | ADMIN | `/admin/integrations` | Buttons "Verbindung testen" für AI, Paperless, Portal-Connectors | Connectivity-Test, Ergebnis (OK/Error) als Toast | `RolesGuard(@Roles(GlobalRole.ADMIN))` | Toast "Verbindung fehlgeschlagen: Details" | Smoke: Step 8b |
| Audit-Log | ADMIN | (API only: `/admin/audit/events`, Begründung §8) | – | Paginierte Liste, Filter (Entity, Action, User, Date) | `RolesGuard(@Roles(GlobalRole.ADMIN))` | 403 | Smoke: Step 8i |
| Monitoring: Queues | ADMIN | (API only: `/admin/monitoring/queues`, Begründung §8) | – | BullMQ Queue-Statistiken (waiting, active, completed, failed) | `RolesGuard(@Roles(GlobalRole.ADMIN))` | 403 | Smoke: Step 8j |
| Monitoring: Integrationen | ADMIN | (API only: `/admin/monitoring/integrations`, Begründung §8) | – | Status aller externen Integrationen (AI, Paperless, Portal-Connectors) | `RolesGuard(@Roles(GlobalRole.ADMIN))` | 403 | Smoke: Step 8j |
| Worker-Health | ADMIN | (API only: `/ready` + Worker `/health`, Begründung §8) | – | Worker-Heartbeat-Status in `/ready`, Liveness auf Port 3100 (nur intern) | `RolesGuard(@Roles(GlobalRole.ADMIN))` | 403 | Smoke: Step 8g, 8h |

---

## 5. Datenschutz & Privacy (alle authentifizierten Rollen)

| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
| Datenexport (DSGVO Art. 15) | USER, ADMIN, READ_ONLY | (API only: `/privacy/export`, Begründung §8) | – | JSON mit allen User-Daten (redigiert: kein passwordHash, storageRef, Secrets) | `AuthGuard` | 401 | Smoke: Step 8k |
| Konto löschen (Self-Service) | USER, ADMIN | `/settings` (Bereich "Profil", Karte am Seitenende) | Button "Konto löschen", Confirm-Dialog (window.confirm) | Account + alle Daten gelöscht (Cascade), außer Last-Admin; Redirect zu `/login` | `AuthGuard` + `@Roles(USER, ADMIN)` + Last-Admin-Check (409) | Inline-Alert "Letzter Admin kann nicht gelöscht werden" (409) | Smoke: Step 8m |

---

## 6. Family Sharing

| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
| Freigaben übersicht | USER, ADMIN | `/household/shares` | Tabelle aller Shares (Ziel, Scope, Berechtigung), Button "Neue Freigabe" | Liste der Shares des Households | `AuthGuard` + `HouseholdMembershipGuard` | Leere State "Keine Freigaben" | Unit: `family-sharing.controller.spec.ts` |
| Freigabe erstellen | USER, ADMIN | `/household/shares` | Formular (Ziel-Mitglied, Scope: ALL_OWNED/INSURANCE/CATEGORY/DOCUMENT, Berechtigung: READ/WRITE, optional Dokument wählen) | `ObjectShare` Eintrag angelegt, Toast "Freigabe erstellt" | `AuthGuard` + `HouseholdMembershipGuard` + `@Roles(USER, ADMIN)` | Toast "Freigabe fehlgeschlagen", Inline-Validierung | Unit: `family-sharing.controller.spec.ts` |
| Dokument-Auswahl im Share-Formular | USER, ADMIN | `/household/shares` | Select (lädt `/households/default/policies/{id}/documents`) | Dokumente des Households verfügbar | `AuthGuard` + `HouseholdMembershipGuard` | Leere Liste bei Fehler | Unit: `documents.controller.spec.ts` |
| Berechtigung ändern | USER, ADMIN | `/household/shares` | Select (READ/WRITE) pro Share | Berechtigung aktualisiert, Toast "Berechtigung aktualisiert" | `AuthGuard` + `HouseholdMembershipGuard` + `@Roles(USER, ADMIN)` | Toast "Fehler beim Aktualisieren" | Unit: `family-sharing.controller.spec.ts` |
| Freigabe entziehen | USER, ADMIN | `/household/shares` | Button "Entziehen" pro Share, Confirm-Dialog | `ObjectShare` gelöscht, Toast "Freigabe entzogen" | `AuthGuard` + `HouseholdMembershipGuard` + `@Roles(USER, ADMIN)` | Toast "Fehler beim Entziehen" | Unit: `family-sharing.controller.spec.ts` |
| Household-Mitglieder auflisten | USER, ADMIN | `/household/shares` (Ziel-Select) | Mitglieder-Liste via `GET /households/:householdId/members` | Andere Mitglieder (ohne eigenen User), Toast bei Fehler | `AuthGuard` + `HouseholdMembershipGuard` + `@Roles(USER, ADMIN)` | Leere Liste bei Fehler | Unit: `household-members.controller.spec.ts` |

---

## 7. Notifications (API only – unvollständig)

| Funktion | Zielrolle | UI-Einstiegspunkt | Bedienelemente | Erwartetes Ergebnis | Berechtigungsprüfung | Fehlerzustand | Test |
|----------|-----------|-------------------|----------------|---------------------|----------------------|---------------|------|
| Benachrichtigungen lesen | USER, ADMIN | – (API: `GET /notifications`) | – | Liste | `AuthGuard` | 403 | Unit: (skeleton only) |
| Als gelesen markieren | USER, ADMIN | – (API: `PATCH /notifications/:id/read`) | – | Status `READ` | `AuthGuard` | 403 | Unit: (skeleton only) |

> **Hinweis:** Notifications Feature ist nur als API-Skelett implementiert, keine UI vorhanden. Dokumentiert als bekannte Grenze.

---

## 8. Bekannte Lücken / Ausnahmen

| Funktion | Grund | Dokumentation |
|----------|-------|---------------|
| Notifications UI | Nur API-Skelett, kein Frontend | In Control Matrix als "API only" markiert |
| Paperless-ngx Dokumenten-Sync | Nur Konfiguration + Connectivity-Test in UI, kein Sync-Button | In `/admin/integrations` dokumentiert |
| Portal-Connector Plugin "Mailbox Sync" | Experimentell, `available: false` | In `/admin/integrations` + Katalog sichtbar, aber deaktiviert |
| OIDC Auto-Provisioning | Nicht implementiert (ADR-007: Admin muss Binding setzen) | In `/admin/users` dokumentiert |

> **API-only-Funktionen (bewusst, kein UI-Gap):** VersiGo Beta ist eine
> privat gehostete Anwendung. Reine Admin-/Betriebs-Funktionen (Audit-Log,
> Queue-/Integrations-Monitoring, Worker-Health) sowie Datenschutz-Tooling
> (Datenexport) sind bewusst **nur über die API** bedienbar – für sie gibt es
> keinen Anwender-Alltag und damit keine geforderten UI-Einstiegspunkte.
> Die AP-20-UI-Vollständigkeitsprüfung umfasst **alle benutzer-/admin-
> steuerbaren Fachfunktionen**; diese besitzen nachweislich UI-Einstiegspunkte
> (siehe Tabellen in §1–§6). Die API-only-Funktionen sind weiterhin über
> Swagger (`/api-docs`) und die Smoke-Tests vollständig abgedeckt.

---

## Test-Abdeckung

| Test-Typ | Abdeckung | Befehl |
|----------|-----------|--------|
| Unit Tests (API) | 55 Test Files, 596 Tests | `pnpm run test` |
| Unit Tests (Web) | i18n, Components, Hooks (42 Tests) | `pnpm --filter @versigo/web run test` |
| Unit Tests (Worker) | 1 Test File, 4 Tests | `pnpm run test` (in Test-Container) |
| Unit Tests (Foundation) | 11 Test Files, 95 Tests | `pnpm run test` (in Test-Container) |
| Integration Tests | Household-Isolation, DB | `pnpm run test` (in Test-Container) |
| E2E / Smoke | 20+ Checks (Auth, API, Web, Worker, DB, Redis, Queues, Privacy, Language, Produktions-Pass) | `./scripts/compose-smoke-test.sh --build` |
| TypeCheck | Strict Mode, alle Packages | `pnpm run typecheck` |
| Lint | ESLint (TS/TSX) | `pnpm run lint` |
| i18n Guard | Keine hartkodierten deutschen UI-Texte | `pnpm --filter @versigo/web run test:i18n` |

---

## Sign-off

| Rolle | Name | Datum | Status |
|-------|------|-------|--------|
| Development | – | 2026-08-02 | ✅ Complete |
| Review | – | – | ⏳ Pending |
| Release | – | – | ⏳ Pending |