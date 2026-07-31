# BugFix-01 Review – Runde 5

Datum: 2026-07-31
Reviewer: `@code-reviewer` (DeepSeek, read-only)
Scope: uncommitted BugFix-01 changes (`fix/BugFix-01-docker-setup`) nach Behebung der Runde-4-Findings.

## Ergebnis: APPROVED

| Schweregrad | Anzahl |
|-------------|--------|
| Critical    | 0      |
| High        | 0      |
| Medium      | 0      |
| Minor       | 2      |

> Die fünf Runde-4-Fixes wurden verifiziert (REDIS_URL aus `.env`, Log-Erfassung
> in Temp-Datei statt grep-Pipeline, Marker-Zählung zum Erkennungszeitpunkt +
> nach 5-s-Fenster, Enqueue-Fehlerausgabe sichtbar, korrekte PASS-Meldung).
> Zusätzlich bestätigt: No-Migration-Changes-Vorgabe eingehalten, keine
> Secrets in Logs/committeten Dateien, Specs decken Bootstrap/IdentityModule
> exakt ab, `tsconfig.build.json` (api+worker) schließt `__tests__` aus.

## Findings (verbatim aus dem Review-Tool)

- **[Minor]** `scripts/compose-smoke-test.sh:444` (+ cleanup trap at `48-57`) — Temp worker-log file is only removed on the success path. Every failure exit (`exit 1`) and any interrupt leaves `/tmp/insura-worker-smoke.log` behind; the `cleanup()` trap runs `$COMPOSE down` but does not remove it. The leftover file is overwritten with `>` on the next run, so there is no correctness impact — purely hygiene. Fix: remove the file in the `cleanup()` trap, e.g. `rm -f "${WORKER_LOG:-}"`.

- **[Minor]** `scripts/compose-smoke-test.sh:76-78` — Fix 1 depends on sourcing the entire user-editable `.env`, which is fragile under `set -euo pipefail`. `set -a; [ -f .env ] && . .env; set +a` executes the whole `.env` as shell code, and step 10's `REDIS_URL` now relies on it. Any value containing spaces or shell metacharacters (common in local passwords) makes the `source` fail, aborting the entire smoke test with an obscure error. (`scripts/dev-services.sh` already shows the safer pattern: parse only the needed keys with `while IFS='=' read -r key value`.) Fix: replace the raw `source` with a key-selective parser (only `REDIS_URL`, `APP_PORT`, `WEB_PORT`, `POSTGRES_*`, `LOCAL_ADMIN_*`).

## Behebung

Beide Minor-Findings wurden behoben und per Smoke-Test verifiziert:

1. `cleanup()`-Trap entfernt die Temp-Datei auch auf Fehlerpfaden (`rm -f "${WORKER_LOG:-/tmp/insura-worker-smoke.log}"`); das explizite `rm` am Erfolgspfad entfällt (Trap ist einziger Cleanup-Punkt).
2. Das rohe `source .env` wurde durch einen schlüsselselektiven Parser ersetzt (Muster aus `scripts/dev-services.sh`): nur `APP_PORT`, `WEB_PORT`, `POSTGRES_USER`, `POSTGRES_DB`, `LOCAL_ADMIN_EMAIL`, `LOCAL_ADMIN_PASSWORD`, `REDIS_URL` werden gelesen, Kommentar-/Leerzeilen übersprungen, CR getrimmt, bestehende Umgebungsvariablen haben Vorrang. Werte mit Leerzeichen/Sonderzeichen brechen den Test nicht mehr.

## Verifikation

- `./scripts/compose-smoke-test.sh --clean` → 10/10 PASS (SMOKE_RC=0), inkl. Schritt 9 (Worker-Marker, kein Restart) und Schritt 10 (BullMQ-Round-Trip).
- `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` → „All checks passed!" (SUITE_RC=0): lint, typecheck, Tests (API 355, foundation 32, web 18, worker 4), Build.

## Fazit

Keine Critical-/High-/Medium-Befunde; 2 Minor-Findings (beide behoben, Zustand erneut per Smoke-Test bestätigt). Akzeptanzbedingung erfüllt (0 Critical, 0 High, 0 Medium, ≤ 8 Minor). Review bestanden.
