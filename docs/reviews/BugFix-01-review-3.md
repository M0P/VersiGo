# BugFix-01 Review – Runde 3

Datum: 2026-07-31
Reviewer: `@code-reviewer` (DeepSeek, read-only)
Scope: uncommitted BugFix-01 changes (`fix/BugFix-01-docker-setup`) nach Behebung der Runde-2-Findings.

> Hinweis: Die Runde-3-Ausgabe des Review-Tools lag vollständig vor, wurde
> aber im Verlauf der Sitzung nicht unmittelbar als Datei persistiert.
> Dieses Dokument ist die treue Rekonstruktion aus dem Sitzungsprotokoll
> (Ergebnis, alle Findings, daraus abgeleitete Fixes) und wurde nach
> Abschluss der Fixes niedergeschrieben. Eine spätere Korrektur am
> Worker-Readiness-Marker (Runde-3-Minor-1-Fix) ist in
> `BugFix-01-review-4.md` dokumentiert.

## Ergebnis: APPROVED

| Schweregrad | Anzahl |
|-------------|--------|
| Critical    | 0      |
| High        | 0      |
| Medium      | 0      |
| Minor       | 3      |

## Minor Findings

### Minor 1 – Worker wird gestartet, aber nie verifiziert

Der Compose-Smoke-Test startete den Worker, prüfte aber nicht, ob er tatsächlich hochkommt und stabil läuft – ein Crash-Loop blieb unentdeckt.

Fix: Schritt 9 im Smoke-Test ergänzt, der die Worker-Logs auf eine Ready-Meldung pollen und bei Timeout `logs worker` ausgibt.

> Korrektur (später): Der ursprünglich verwendete Marker
> `Nest application successfully started` wird von
> `NestFactory.createApplicationContext` nie emittiert (nur der HTTP-Server
> loggt diese Konstante). Der Worker loggt deshalb seit der Korrektur eine
> eigene Meldung (`Worker bereit`), auf die Schritt 9 wartet; zusätzlich
> prüft Schritt 9 die Marker-Anzahl über ein Zeitfenster (Crash-Loop-
> Erkennung) und Schritt 10 verifiziert einen echten BullMQ-Round-Trip.
> Details in `BugFix-01-review-4.md`.

### Minor 2 – `local-admin.bootstrap.ts`: Catch-all verschluckt DB-Fehler

Der Catch-Block behandelte alle Fehler gleich; ein P2002 (Duplikat, harmlos bei Race) war nicht von einem Datenbank-Ausfall unterscheidbar. Beide Fälle wurden still geschluckt.

Fix: P2002 wird als erwarteter Konkurrenzfall mit `warn` geloggt und übersprungen; alle anderen Fehler werden auf `error`-Ebene geloggt und propagieren. Ergänzt um einen Spec-Test, der den Nicht-P2002-Fehlerpfad abdeckt.

### Minor 3 – `.env`-Handling im Smoke-Test: fehlende Datei + Platzhalter-Passwort

Fehlte `.env`, kopierte der Smoke-Test still `.env.example` nach `.env` – inklusive des Platzhalter-Passworts `CHANGE_ME_FOR_LOCAL_DEVELOPMENT`, das dann unbemerkt für den Login-Check verwendet worden wäre.

Fix: Warnung im Smoke-Test, sobald `LOCAL_ADMIN_PASSWORD` noch der Platzhalter aus `.env.example` ist, damit ein versehentlich unverändertes Passwort sichtbar bleibt. Zusätzlich trimmt der Test die gelesenen `.env`-Werte robust (mit Fallback, falls `sed` fehlt).

## Fazit

Alle drei Minor-Findings wurden behoben; keine Critical-/High-/Medium-Befunde. Review bestanden.
