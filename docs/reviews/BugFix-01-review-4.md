# BugFix-01 Review – Runde 4

Datum: 2026-07-31
Reviewer: `@code-reviewer` (DeepSeek, read-only)
Scope: uncommitted BugFix-01 changes (`fix/BugFix-01-docker-setup`) nach Behebung der Runde-3-Findings, inklusive Worker-Readiness-Marker und Smoke-Test-Schritte 9/10.

## Ergebnis: APPROVED

| Schweregrad | Anzahl |
|-------------|--------|
| Critical    | 0      |
| High        | 0      |
| Medium      | 0      |
| Minor       | 5      |

> Der Diff erfüllt die Akzeptanzkriterien des Work Packages, respektiert
> die „No-Migration-Changes“-Vorgabe und folgt den Projektkonventionen.
> Alle Findings sind Minor-Robustheits-/Doku-Nits in den neuen
> Smoke-Test-Schritten 9/10; keines betrifft die Korrektheit des
> Laufzeitcodes.

## Findings (verbatim aus dem Review-Tool)

- **[Minor]** `scripts/compose-smoke-test.sh:365` — Smoke-test step 10 hardcodes `redis://redis:6379` instead of deriving the connection from `REDIS_URL`. Evidence: The worker's BullMQ connection comes from `REDIS_URL` (`packages/foundation/src/queue/queue.module.ts:18`, from `.env`), while the enqueue in step 10 connects to a hardcoded URL. In the default setup they match, but if a developer's `.env` sets a Redis password, non-default host/port, or a different URL (`.env.example` documents `REDIS_URL` as configurable), the enqueued job goes to a different Redis than the worker consumes — step 10 fails with a misleading "could not enqueue" or the job is never picked up. Fix: Read the api container's `REDIS_URL` (e.g., from the sourced `.env` at the top of the script, falling back to `redis://redis:6379`) and pass it into the `node -e` Queue connection.

- **[Minor]** `scripts/compose-smoke-test.sh:323,384` — `grep -qF` in a pipeline under `set -o pipefail` can spuriously fail on large worker logs (SIGPIPE race). With `pipefail`, if `grep -q` finds the match and exits while `docker compose logs` still has output pending (> 64 KB pipe buffer), the producer dies on SIGPIPE (exit 141) and the pipeline returns non-zero even though the marker exists. Fix: For these two new checks, consume the full stream or capture logs to a temp file first and grep that.

- **[Minor]** `scripts/compose-smoke-test.sh:339-340` — The two marker-count samples are taken back-to-back, making the `-ne` comparison effectively dead code. The meaningful guard is `MARKER_COUNT_2 -gt 1`. Fix: Sample the count at detection time and again after the sleep window, or rely on the `> 1` check and document that step 10 is the backstop for slow crash-loops.

- **[Minor]** `scripts/compose-smoke-test.sh:375` — Enqueue failure output is fully suppressed, hiding the root cause (`... >/dev/null 2>&1` swallows the `node -e` error). Fix: Capture stdout/stderr of the enqueue command and print it in the failure branch.

- **[Minor]** `scripts/compose-smoke-test.sh:423` — PASS message "Job fully processed" is misleading given the current schema (the processor's first DB write throws Prisma P2021, so the smoke job ends in FAILED; the check correctly accepts any terminal state). Fix: Reword the PASS message to state the job reached a terminal BullMQ state (queue drained), noting that the DB-success path is covered by the worker unit tests.

## Verifikation durch den Reviewer

- Akzeptanzkriterien des Work Packages vollständig abgedeckt (Web-EACCES, API-Einstiegspunkt, Worker-DI, lokale Auth-Defaults inkl. Produktions-Fail-Fast, idempotenter Admin-Bootstrap mit bcrypt-only, `allowedDevOrigins` dev-only, turbo persistent ohne `--parallel`, `.env` gitignored, keine echten Secrets, keine Migrationsänderungen).
- Worker-Readiness-Marker korrekt: `createApplicationContext` emittiert Nest's "successfully started" nie (nur HTTP-Pfad); Marker wird nach dem awaited `DatabaseService.$connect` geloggt, die PostgreSQL-Aussage stimmt; Grep-Muster matcht die emittierte Zeile.
- Smoke-Test-Schritte 9/10 end-to-end nachvollzogen: Enqueue löst `bullmq` korrekt auf, Queue-Name matcht API und Worker, Log-Marker ist die erste Anweisung in `process()`, der P2021-Fehler führt deterministisch zu einem BullMQ-FAILED-Status mit gesetztem `finishedOn`, Terminals-State-Assertion hält, Cleanup entfernt Job-Hash und ZSet-Einträge, `redis-cli`-Exit-Codes sind behandelt, Quoting ist sicher.
- Verbleibende Risiken: (1) Crash-Loop-Heuristik in Schritt 9 ist Best-Effort (langsame Restarts fängt Schritt 10 ab – akzeptabel); (2) Redis-Hardcode bricht nur bei nicht-Standard-`.env` (Minor oben); (3) der beabsichtigte P2021-Pfad ist vorwärtskompatibel – sobald eine spätere Migration die Tabelle anlegt, bleibt der Test grün (Job läuft dann über den SKIPPED-Pfad).

## Behebung (Runde 5-Gegenstand)

Alle fünf Minor-Findings wurden behoben:
1. `REDIS_URL` wird aus der gesourcten `.env` verwendet (Fallback `redis://redis:6379`).
2. Worker-Logs werden in eine Temp-Datei geschrieben und auf der Datei gegrept (kein SIGPIPE-Risiko unter `pipefail`).
3. Marker-Zählung wird zum Erkennungszeitpunkt und nach dem 5-s-Fenster gesampelt; Vergleich auf Zuwachs; Kommentar zur Schritt-10-Absicherung.
4. Enqueue-Fehlerausgabe wird erfasst und im Fehlerfall ausgegeben.
5. PASS-Meldung umformuliert („Job reached terminal BullMQ state (queue drained)") mit Hinweis auf die Unit-Test-Abdeckung des DB-Erfolgspfads.

## Fazit

Keine Critical-/High-/Medium-Befunde, 5 Minor-Findings (alle behoben). Review bestanden.
