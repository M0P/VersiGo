# Feature: Rollen, Rechte, lokale Registrierung und Freischaltung

## Ziel

Ersetze das bisherige Household-Rollenmodell (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) durch ein klar durchgesetztes globales Rollen- und Rechtekonzept mit genau drei Rollen: `READ_ONLY`, `USER` und `ADMIN`. Jede Person verwendet lokale Zugangsdaten aus Benutzername und Passwort; eine E-Mail-Adresse ist weder erforderlich noch abzufragen. Neue Registrierungen bleiben bis zur expliziten Freischaltung durch einen Admin gesperrt.

Dies ist ein vollständiger vertikaler Slice: Prisma-Migration, sichere lokale Credentials, Registrierung/Freischaltung, API- und Guard-Durchsetzung, UI, Audit, Tests, Docker-Compose-Testvertrag und Dokumentation gehören in denselben Änderungsumfang.

## Vorbedingungen und verbindliche Referenzen

Lies vor Planung und Umsetzung vollständig `AGENTS.md`, `prompts/00-gemeinsame-regeln.md`, alle Dateien unter `docs/` einschließlich ADRs, `dependency-policy.md`, `.opencode/agents/*`, `prompts/PR-REVIEW.md`, bestehende Identity-, Family-Sharing-, Policy-, Settings- und Audit-Implementierungen sowie die zugehörigen Tests und Migrationen.

- Halte alle dortigen Regeln ein, einschließlich vertikaler Feature-Grenzen, Household-Isolation, objektbezogener Freigaben, Security/Privacy, Audit, Dependency Policy, unabhängiger Code Reviews und des verbindlichen Docker-Compose-Testvertrags.
- Bestehende OIDC-Unterstützung darf nicht unbeabsichtigt beschädigt werden. Da alle Nutzer lokale Zugangsdaten benötigen, muss der Agent vor der Umsetzung eine explizite, dokumentierte Entscheidung treffen, ob OIDC entfernt, deaktiviert oder als optionaler, an ein lokales Konto gebundener zweiter Login-Weg erhalten bleibt. Ohne ausdrücklich dokumentierte, sichere Migrations- und Kompatibilitätsentscheidung keine Änderung am Identity-Modell.
- Bereits vorhandene `OWNER`-, `ADMIN`-, `MEMBER`- und `VIEWER`-Daten benötigen eine dokumentierte, verlustfreie Migrationsstrategie. `OWNER` darf nicht stillschweigend zu weniger Rechten führen; der sichere Standard ist eine Migration auf `ADMIN`, sofern die Architekturprüfung keine begründete Alternative festlegt.

## Rollenmodell

| Rolle | Erlaubt | Verboten |
|---|---|---|
| `ADMIN` | Alles, was `USER` darf; Nutzer verwalten; Registrierung freischalten/ablehnen; Rollen zuweisen und ändern; Nutzer deaktivieren; globale System- und Integrationskonfiguration verwalten; Feature Flags verwalten | Eigene letzte aktive Admin-Berechtigung oder letzten aktiven Admin entfernen/degradieren; Secrets im Klartext ansehen oder in Logs/API-Antworten offenlegen |
| `USER` | Eigenes Profil und eigene Oberflächeneinstellungen ändern; eigene Verträge und zugehörige Vertragsinformationen vollständig erstellen, lesen, ändern, archivieren/löschen; zugehörige Kosten, Dokumente, Portal-Links und erlaubte Fachdaten im bestehenden Berechtigungsrahmen verwalten; explizit freigegebene Objekte im Umfang der Freigabe nutzen | Nutzer/Rollen/Systemeinstellungen ändern; fremde oder nur lesend freigegebene Verträge verändern; globale Konfiguration sehen oder ändern |
| `READ_ONLY` | Ausschließlich explizit und einzeln bzw. über vorhandene Freigabe-Scopes lesend freigegebene Verträge und deren erlaubte Detaildaten lesen | Eigene oder fremde Verträge anlegen, ändern, archivieren oder löschen; Dokumente/Kosten/Portal-Links/Freigaben verändern; Profil-, Theme-, Locale- oder sonstige Einstellungen verändern; System-/Admin-UI aufrufen |

Die Durchsetzung erfolgt serverseitig in Guards/Policies und Datenabfragen; das Ausblenden von UI-Steuerelementen ist nur eine zusätzliche UX-Maßnahme. Household- und Objektfreigaben dürfen nicht durch globale Rollen umgangen werden. Ein `READ_ONLY`-Nutzer erhält ohne passende explizite `READ`-Freigabe keinen Zugriff auf Verträge, auch nicht auf eigene historische oder Household-Daten.

## Funktionaler Umfang

### Lokale Konten

- Implementiere ein eindeutiges, normalisiertes Benutzername-Feld; keine E-Mail-Pflicht, kein E-Mail-Versand und keine E-Mail-Rücksetzung als versteckte Voraussetzung.
- Speichere ausschließlich zeitgemäß gehashte Passwörter mit per Passwort individuellem Salt; keine Klartextpasswörter in Datenbank, Logs, Audit, Fehlern, Testausgaben oder API-Responses.
- Ergänze sichere Registrierung, Login, Logout und Session-Integration gemäß bestehender Session-, CSRF-, Cookie- und Proxy-Regeln.
- Neue Registrierungen erhalten den Status `PENDING`/`PENDING_APPROVAL` und können sich nicht anmelden oder geschützte Ressourcen aufrufen, bis ein Admin sie aktiviert. Antworttexte dürfen weder Benutzerexistenz noch Freischaltstatus unnötig offenlegen.
- Implementiere Brute-Force-Schutz/Rate Limiting, sichere Passwortvalidierung, generische Login-Fehler und Audit-Ereignisse ohne sensible Werte.
- Definiere einen sicheren First-Admin-/Bootstrap-Pfad. Er muss explizit konfiguriert, einmalig bzw. sicher begrenzt, auditiert und für Produktion dokumentiert sein; niemals automatische Default-Zugangsdaten erzeugen.

### Nutzerverwaltung

- Admin-UI und autorisierte API für Liste, Detailansicht, Suche/Filter nach Status/Rolle, Aktivierung, Ablehnung/Deaktivierung und Rollenzuweisung bereitstellen.
- Rollenänderungen, Aktivierungen, Deaktivierungen und administrative Identitätsänderungen auditieren; Passwortwerte, Hashes, Sessions und Tokens niemals auditieren.
- Verhindere zuverlässig, dass der letzte aktive Admin deaktiviert, gelöscht oder auf `USER`/`READ_ONLY` herabgestuft wird. Prüfe dies transaktional gegen Race Conditions.
- Eine Rolle ist für die gesamte Instanz gültig. Falls HouseholdMembership für Mandantentrennung weiter erforderlich ist, entferne sie nicht ohne ADR und Migration; entkopple fachliche Mitgliedschaft von der neuen globalen Berechtigungsrolle sauber.

### Verträge und Freigaben

- `USER`-CRUD für eigene Policies muss alle bereits implementierten Vertragsinformationen und verknüpften Daten abdecken, aber keine bestehenden Ownership-, Household- oder Objektfreigabegrenzen schwächen.
- `READ_ONLY` erhält nur echte Leserechte auf explizit freigegebene Policy-Scopes. Detail-Endpunkte, Dokument-Downloads/Metadaten, Kosten, AI-Zusammenfassungen, Portal-Links und Exportpfade müssen jeweils serverseitig auf die Freigabe geprüft werden.
- Bestehende `WRITE`-Freigaben dürfen nicht dazu führen, dass `READ_ONLY` schreibt. Für diese Rolle gilt immer die strengere Rollenregel.

### UI

- Ergänze responsive, zugängliche Seiten für Registrierung, lokale Anmeldung, Freischalt-Hinweis, Admin-Nutzerverwaltung und verbotene Zugriffe. Verwende das vorhandene bzw. nach AP-13 eingeführte zentrale UI-System, ohne parallel ein eigenes Styling-System zu schaffen.
- `READ_ONLY` sieht nur seine lesbaren Inhalte und keine editierbaren Einstellungen. Direkte Route-Aufrufe und API-Anfragen bleiben trotzdem geschützt.
- Nutzernamen, Status, Rolle und Aktionen müssen verständlich dargestellt werden; gefährliche Admin-Aktionen verlangen eine klare Bestätigung.

## Migration, Tests und Docker

- Liefere Prisma-Migrationen mit einer nachvollziehbaren Up-/Datenmigrationsstrategie, einer sicheren Zuordnung alter Rollen und Tests gegen bestehende Daten.
- Ergänze Unit-, API-/Integrations-, UI- und Regressionstests für jede Rolle, jede verbotene Aktion, Household-Isolation, explizite Freigaben, Pending-Accounts, Admin-Freischaltung, letzte-Admin-Schutz, Login, Rate Limits und Audit-Redaction.
- Führe den vollständigen, kanonischen Docker-Compose-Testvertrag aus. Node, pnpm, Prisma, Datenbank, Redis, Build und Tests dürfen in der verbindlichen Prüfung nicht vom Host abhängen.
- Starte und smoke-teste den Laufzeitstack aus sauberem Insura-spezifischem Compose-Zustand. `docker compose up --build` bleibt funktionsfähig.

## Dokumentation und Review

Aktualisiere nach erfolgreicher Umsetzung und erfolgreichem Docker-Compose-Test mindestens Datenmodell, Security/Privacy, Architektur, Admin Operations, README, `.env.example`, Compose-/CI-Konfiguration und die zentralen Regeln, sofern betroffen. Dokumentiere insbesondere die Rollenmatrix, Migrationszuordnung, Bootstrap-Absicherung, lokale Authentifizierung, Pending-Status, Freigabegrenzen und OIDC-Entscheidung.

Halte den vollständigen unabhängigen Review-Loop ein: `@code-reviewer` read-only aufrufen, jedes Ergebnis wortgetreu unter `docs/reviews/` speichern, Critical/High/Medium beheben und bis maximal fünf Runden wiederholen. Ein Commit/PR ist nur bei 0 Critical, 0 High, 0 Medium, höchstens 8 Minor, grüner Compose-CI und bestandenem kanonischem Compose-Testvertrag zulässig.

## Akzeptanzkriterien

- Genau die drei globalen Rollen `READ_ONLY`, `USER`, `ADMIN` sind serverseitig durchgesetzt und korrekt migriert.
- Jeder Nutzer besitzt Benutzername und Passwort; E-Mail ist nicht erforderlich.
- Registrierung erzeugt gesperrte Pending-Konten; nur ein Admin kann sie freischalten.
- `ADMIN` verwaltet Nutzer, Rollen und Systemeinstellungen; `USER` verwaltet ausschließlich eigene Verträge und eigenes Profil; `READ_ONLY` liest nur explizit freigegebene Verträge und ändert keinerlei Einstellungen. „Eigene Verträge" bedeutet die Verträge des eigenen Households (gemeinsame Verwaltung innerhalb des Households, Family-Sharing-Modell; `ownerUserId` ist Provenienz-Information, keine Zugriffsgrenze – siehe ADR-007).
- Rechteverletzungen sind über UI, direkte Routen und APIs gleichermaßen verhindert; Datenisolation bleibt gewährleistet.
- Passwort-, Session-, Audit- und Rate-Limit-Schutz ist vorhanden und getestet.
- Migrationen, Dokumentation, unabhängiger Review und der vollständige Docker-Compose-Test-/CI-Pfad sind erfolgreich.
