# BugFix-01 Review – Runde 2

Datum: 2026-07-31
Reviewer: `@code-reviewer` (DeepSeek, read-only)
Scope: uncommitted BugFix-01 changes (`fix/BugFix-01-docker-setup`) nach Behebung der Runde-1-Findings.

> Hinweis: Die Runde-2-Ausgabe des Review-Tools lag vollständig vor, wurde
> aber im Verlauf der Sitzung nicht unmittelbar als Datei persistiert.
> Dieses Dokument ist die treue Rekonstruktion aus dem Sitzungsprotokoll
> (Ergebnis, alle Findings, daraus abgeleitete Fixes) und wurde nach
> Abschluss der Fixes niedergeschrieben.

## Ergebnis: APPROVED

| Schweregrad | Anzahl |
|-------------|--------|
| Critical    | 0      |
| High        | 0      |
| Medium      | 0      |
| Minor       | 3      |

## Minor Findings

### Minor 1 – `Dockerfile` (Runner-Stage): toter `corepack prepare`-Aufruf

Die Runner-Stage enthielt `RUN corepack enable && corepack prepare pnpm@11.17.0 --activate`. Zur Laufzeit ruft kein Service pnpm auf (Compose startet ausschließlich `node`/`npx`); die Zeile war damit tote Konfiguration und blähte die Laufzeit-Image auf.

Fix: `RUN corepack enable && corepack prepare pnpm@11.17.0 --activate` aus der Runner-Stage entfernt. Die Build-Stage behält ihr eigenes corepack-Setup für den `pnpm install`-Schritt.

### Minor 2 – `scripts/compose-smoke-test.sh` (Schritt 7): Roh-`ADMIN_EMAIL` vs. getrimmte Speicherung

Die Admin-Zählung (`SELECT count(*) FROM users WHERE email = '${ADMIN_EMAIL}'`) nutzte den unverarbeiteten Wert aus `.env`, während der Bootstrap die E-Mail getrimmt speichert. Enthielt `.env` umgebende Leerzeichen, fand die Zählung keinen Treffer (false FAIL) bzw. war inkonsistent.

Fix: `ADMIN_EMAIL` wird nach dem Sourcing von `.env` genau einmal getrimmt (`sed`), sodass Login-Check, E-Mail-Abgleich und Datenbank-Zählung denselben normalisierten Wert verwenden. Das Passwort wird bewusst NICHT getrimmt (es wird vom Bootstrap verbatim gehasht).

### Minor 3 – `turbo.json`: `envMode: "loose"` ohne Begründung

`envMode: "loose"` weicht von der strikten Task-Env-Isolation ab; ohne Erklärung wirkt das wie ein Versehen und verschleiert den Cache-Invalidierungs-Caveat.

Fix: JSONC-Kommentar in `turbo.json` ergänzt, der erklärt, warum `envMode: "loose"` für den Dev-/Compose-Betrieb erforderlich ist (Env-Variablen werden an die Services durchgereicht, ohne sie je Task-Konfiguration bekannt zu geben), sowie den Hinweis, dass build-relevante Env-Variablen bei Änderung eine manuelle Cache-Invalidierung (`turbo build --force`) erfordern.

## Fazit

Alle drei Minor-Findings wurden behoben; keine Critical-/High-/Medium-Befunde. Review bestanden.
