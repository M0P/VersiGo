# ADR-007: Globale Rollen, lokale Registrierung und OIDC-Bindung

## Status
Akzeptiert

## Kontext
AP-16 ersetzt die bisherige Household-Rolle (OWNER/ADMIN/MEMBER/VIEWER) durch ein einfacheres, globales Rollenmodell und führt eine lokale Registrierung mit Admin-Freischaltung ein. Dabei sind folgende architekturelle Entscheidungen zu treffen:

1. Rollenmodell: global vs. household-gebunden
2. Login-Identifier für lokale Konten (Benutzername vs. E-Mail)
3. Freischaltung neuer Konten (PENDING_APPROVAL)
4. Verhältnis von OIDC zu lokalen Konten (Provisionierung vs. Bindung)
5. Migration der Bestandsdaten (Rollenableitung, Platzhalter-Bereinigung)
6. Schutz vor dem Verlust des letzten Administrators

## Entscheidungen

### 1. Globale Rollen statt Household-Rollen

**Entscheidung:** Die Rollen werden als globale Rollen auf `users.role` geführt (Enum `GlobalRole`: `READ_ONLY`, `USER`, `ADMIN`). `HouseholdMembership` behält ausschließlich die Mandantentrennung (Zugehörigkeit), die `role`-Spalte entfällt.

**Begründung:**
- Der bestehende Funktionsumfang ist auf ein Household fokussiert; eine Rollenverwaltung pro Household erzeugt Komplexität ohne fachlichen Mehrwert
- Ein globales Rollenmodell ist einfacher zu verstehen, zu auditieren und zu administrieren
- `READ_ONLY` beschreibt einen reinen Lesezugriff auf explizit freigegebene Objekte, `USER` einen vollwertigen Teilnehmer, `ADMIN` globale Admin-Rechte (Konten, Settings, Feature-Flags)

**Abgelehnte Alternative:** Beibehaltung der Household-Rollen mit mehrstufiger Ranglogik (`ROLE_RANK`). War die Quelle häufiger Autorisierungsfehler und erschwerte die Rechteprüfung in Guards und Services.

### 2. Benutzername als lokaler Login-Identifier

**Entscheidung:** Der normalisierte Benutzername (`username`, lowercase + trim) ist der eindeutige lokale Login-Identifier (`users.username`, UNIQUE). Die E-Mail ist optional, wird nicht abgefragt und ist kein Login-Merkmal (kein eindeutiger Index mehr).

**Begründung:**
- Die lokale Registrierung verlangt keine E-Mail-Adresse (keine Mail-Infrastruktur im Produkt)
- Der Benutzername ist vom Nutzer frei wählbar und stabil (E-Mail-Adressen ändern sich)
- Normalisierung (lowercase + trim) gewährleistet case-insensitive Eindeutigkeit (unverändert aus ADR-006)

### 3. Admin-Freischaltung neuer Konten (PENDING_APPROVAL)

**Entscheidung:** Neu registrierte lokale Konten erhalten den Status `PENDING_APPROVAL` und können weder lokal noch per OIDC einloggen, bis ein ADMIN sie über `POST /admin/users/:id/approve` freischaltet (oder per `reject` ablehnt → `DISABLED`).

**Begründung:**
- Verhindert unkontrollierte Selbstregistrierung in einem Produktivsystem mit sensiblen Versicherungsdaten
- Die Freischaltung erzeugt einen Audit-Trail (`USER_APPROVED`/`USER_REJECTED`)
- Abgelehnte und gesperrte Konten erhalten denselben Status `DISABLED`; die Unterscheidung bleibt über das Audit-Log nachvollziehbar

### 4. OIDC bleibt als zweiter Login, gebunden an ein lokales Konto

**Entscheidung (Benutzerentscheidung):** OIDC bleibt als alternative Login-Methode bestehen. OIDC **provisioniert keine Konten mehr** (kein Upsert aus Claims): Eine OIDC-Anmeldung ist nur erfolgreich, wenn `(oidcIssuer, oidcSubject)` einem aktiven lokalen Konto zugeordnet ist. Die Bindung wird ausschließlich durch einen ADMIN gesetzt (`POST /admin/users/:id/oidc-binding`, Audit `OIDC_BOUND`/`OIDC_UNBOUND`). `oidcIssuer`/`oidcSubject` sind nullable.

**Begründung:**
- Der bisherige Auto-Provisioning-Pfad erzeugte unkontrollierte Konten aus beliebigen OIDC-Providern
- Durch die Bindung an ein bestehendes (freigeschaltetes) lokales Konto gilt die Admin-Freischaltung auch für OIDC-Zugriffe
- Fehlgeschlagene OIDC-Logins liefern generische Fehler (keine Enumerations-Information)

### 4a. Registrierung: 409 bei vergebenem Benutzernamen (bewusste Ausnahme)

**Entscheidung:** `POST /auth/register` antwortet mit `409 Conflict` und der Meldung „Benutzername ist bereits vergeben", wenn der gewählte Benutzername bereits existiert. Alle anderen Endpunkte (insbesondere Login und OIDC-Callback) liefern bewusst generische Fehler.

**Begründung:**
- Die Registrierung ist der einzige Endpunkt, an dem der Nutzer selbst einen gewünschten Benutzernamen übermittelt und unmittelbar wissen muss, ob er ihn verwenden kann (sonst ist kein Wechsel zu einem freien Namen möglich)
- Es wird ausschließlich die Existenz des **selbst gewählten** Benutzernamens offengelegt – keine weiteren Kontenattribute, kein Freischaltstatus, keine E-Mail, kein Passwort-Hash
- Das AP-16-Kriterium „Antworttexte dürfen weder Benutzerexistenz noch Freischaltstatus unnötig offenlegen" ist damit erfüllt: Für Login und alle anderen Routen bleibt die Fehlerbehandlung generisch; nur die Registrierung weicht bewusst und begrenzt ab
- Massenhafte Abfrage wird durch das per-IP-Rate-Limit auf `POST /auth/register` begrenzt

### 5. Migration der Bestandsdaten

**Entscheidung:** Die Migration (20260731120000_ap16_global_roles_local_registration) ist daten-erhaltend und führt die Änderungen in 7 Stufen aus:

- Ableitung `users.role` aus den Household-Mitgliedschaften (max-wins): `OWNER`/`ADMIN` → `ADMIN`, `MEMBER` → `USER`, `VIEWER` → `READ_ONLY`
- Benutzername-Backfill in Reihenfolge: `credentials.identifier` → E-Mail → OIDC-Subject → `user-<id>`-Fallback; Kollisionen erhalten ein id-abgeleitetes Suffix
- Der bisherige Bootstrap-Admin (`oidcIssuer='local'`) wird explizit `ADMIN`
- OIDC-Platzhalter `local`/`unknown` werden entfernt (Spalten nullable); betroffene Konten verlieren die OIDC-Bindung, behalten aber lokale Zugänge und können durch Admins neu gebunden werden
- `credentials.identifier`, `users_email_key` und `household_memberships.role` entfallen

### 6. Letzter-Admin-Schutz

**Entscheidung:** Der letzte aktive `ADMIN` kann weder gesperrt noch herabgestuft werden. Die Prüfung läuft in einer serialisierbaren Transaktion (Race-sicher).

**Begründung:**
- Verhindert einen Lockout des gesamten Systems durch Fehlbedienung
- Gilt für `disable` und für jede Herabstufung (`setRole` von `ADMIN` auf `USER`/`READ_ONLY`)

## Konsequenzen

- **Schreibzugriff (Write-Gate) ist die Household-Mitgliedschaft, nicht `ownerUserId`:** In Policy-Registry, Cost-Tracking und Documents wird jeder Schreibzugriff (`create`/`update`/`remove`) über die Household-Mitgliedschaft des Users durchgesetzt (`assertHouseholdAccess`). `ownerUserId` ist Provenienz-/Audit-Information (wer hat das Objekt angelegt), bewusst **keine** Zugriffsgrenze: Innerhalb eines Households verwalten Mitglieder die Verträge des Households gemeinsam (Family-Sharing-Modell aus AP-06/AP-16 „keine bestehenden Household-Grenzen schwächen"). Fremde Households bleiben durch die Mandantentrennung ausgeschlossen; `READ_ONLY` erhält Schreibzugriff grundsätzlich nicht (Rollenregel schlägt Freigabe).
- `SessionAuthGuard` lässt nur `ACTIVE`-Konten an geschützte Routen (PENDING_APPROVAL und DISABLED werden abgewiesen)
- `RolesGuard` prüft die globale Rolle des Users gegen `@Roles(GlobalRole…)` mit hierarchischer Mindest-Rang-Semantik: `ADMIN (3) > USER (2) > READ_ONLY (1)`. Zugelassen ist, wer mindestens die niedrigste geforderte Rolle erreicht (`Math.min` über die geforderten Rollen) – damit darf ADMIN auch alles, was mit `@Roles(GlobalRole.USER)` ausgezeichnet ist, ohne dass jede Route explizit alle höheren Rollen auflisten muss. Die Guard-Logik erzeugt weder Eskalation noch Lockout.
- `READ_ONLY` erhält Lesezugriff ausschließlich über explizite `ObjectShare`-Freigaben mit `READ`-Permission (Policy-/Dokument-/Kosten-/KI-Lese-Endpunkte)
- Die Admin-Verwaltung (`UserAdminService`) deckt Liste, Freischaltung, Ablehnung, Sperre, Entsperrung, Rollenwechsel und OIDC-Bindung ab
- Der lokale Bootstrap verwendet `LOCAL_ADMIN_USERNAME`/`LOCAL_ADMIN_PASSWORD` (kein `LOCAL_ADMIN_EMAIL` mehr)
- `.env.example`, `app-config.schema.ts`, Docker-Compose und der Compose-Smoke-Test werden auf den Benutzernamen umgestellt
