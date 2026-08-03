# AP-20 Review, Runde 4

- Datum: 2026-08-03
- Branch: `feat/AP-20-ready-up-for-version-1` (uncommitted)
- Reviewer: @code-reviewer (DeepSeek code-reviewer Subagent)
- Scope: Alle uncommitted Änderungen des Arbeitspakets AP-20, Schwerpunkt auf den Änderungen dieser Runde (COOKIE_SECURE-Feature, Smoke-Test-Schritt 12 Produktions-Erfolgspfad) sowie Regressions-Sicht auf den Gesamt-Diff.
- Verifiziert vor Review: `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` → EXIT=0 (Lint, Typecheck, i18n-Guard; API 596/55, Web 42, Worker 4, Foundation 95); `./scripts/compose-smoke-test.sh --build --clean` → EXIT=0, alle 12 Steps inkl. 12a (Bootstrap+Login) und 12b (Session-basierte Household-Aktion) grün.

Counts: 0 Critical, 0 High, 0 Medium, 3 Minor

---

**A. [Minor] `packages/foundation/src/config/settings-catalog.ts:333` — `defaultValue: 'NODE_ENV=production'` ist ein String-Ausdruck, kein Boolean**
- Evidence: Der Katalog-Eintrag für `COOKIE_SECURE` deklariert `type: 'boolean'`, setzt aber `defaultValue: 'NODE_ENV=production'` — ein Ausdruck, kein Wert. Der tatsächliche Default wird in `app-config.schema.ts:181` abgeleitet (`cfg.COOKIE_SECURE ?? cfg.NODE_ENV === 'production'`). `settings-resolver.service.ts:220-223` verwendet `definition.defaultValue` als Fallback, wenn weder Env noch UI-Konfiguration einen Wert liefern. `COOKIE_SECURE` ist `category: 'bootstrap'` und wird im Admin-Settings-Controller (Zeile 510) abgelehnt und aus `getUiConfigurableKeys()` ausgeschlossen — der Resolver wird für Bootstrap-Keys also nie aufgerufen. Laufzeit-Impact: nil. Aber der Katalog ist als Inventar ALLER Konfigurationsvariablen dokumentiert; ein String-Ausdruck als `defaultValue` eines Boolean-Felds ist irreführend und würde bei künftigen Werkzeugen (Doku-Generierung, Anzeige effektiver Defaults) falsch aufgelöst. Kein Test validiert die Typkonsistenz `defaultValue` ↔ `type`.
- Suggested fix: `defaultValue` auf einen echten Boolean setzen (`true`, da der produktive Default true ist) oder weglassen und sich auf die Beschreibung stützen; Typ-Semantik des Katalogs vereinheitlichen.

**B. [Minor] `scripts/compose-smoke-test.sh:1194` — `unset`-Zeile räumt `COOKIE_SECURE` nicht ab**
- Evidence: Am Ende von Schritt 12 werden `NODE_ENV`, `LOCAL_AUTH_ENABLED`, `LOCAL_ADMIN_USERNAME`, `LOCAL_ADMIN_PASSWORD`, `OIDC_ENABLED` zurückgesetzt, aber `COOKIE_SECURE` fehlt in der Liste. Da das Skript direkt danach mit Exit 0 endet, gibt es keinen funktionalen Impact im Skript selbst; würde das Skript aber erweitert oder gesourct, würde `COOKIE_SECURE=false` in die aufrufende Shell leaken. Inkonsistent mit der Reset-Intention.
- Suggested fix: `COOKIE_SECURE` in die `unset`-Liste aufnehmen.

**C. [Minor] Duplikat von B** (unset räumt `COOKIE_SECURE` nicht ab; bereits oben erfasst).

**D. [Minor] `.github/workflows/ci.yml` — CI-`compose-smoke`-Job führt nur einen reduzierten Stepsatz aus, nicht das vollständige 12-Step-Skript**
- Evidence: Der CI-Smoke-Job prüft Health/Ready/Web/DB, aber nicht den Produktions-Erfolgspfad (Bootstrap, Login, Session, Household-Aktion), Auth-Fail-Fast oder die Policy-Aktion. In PR_DESCRIPTION ist dies als bekannte Einschränkung dokumentiert. Runde-3-Finding #2 bot explizit die Alternative „dokumentieren + dedizierter Produktions-Pass" an; beides ist umgesetzt (Schritt 12 lokal + dokumentierte CI-Grenze). Damit formal erfüllt; als verbleibendes Restrisiko Minor.
- Suggested fix (optional): CI-Job auf das vollständige Skript (`./scripts/compose-smoke-test.sh`) umstellen oder den Produktions-Pass separat in CI laufen lassen; ansonsten dokumentierte Grenze bestehen lassen.

---

**Nicht Befunde (geprüft und OK):**
- E: `docker-compose.yml` `COOKIE_SECURE: "${COOKIE_SECURE:-}"` — leerer String wird von `optionalBooleanFromEnv` wie „nicht gesetzt" behandelt (Test 159-161). OK.
- F: `.env`-Passthrough-Liste enthält `COOKIE_SECURE` nicht — Absicht, da Schritte 1-11 Dev-Modus über HTTP sind (dort wäre `COOKIE_SECURE=true` schädlich). OK.
- G: Schritt 12 frische DB — `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` + erneute Migration auf echter frischer Schema-Basis. OK.
- I: Session-Wert-Extraktion (Jar + Set-Cookie-Fallback) robust. OK.
- J: Passwortgenerierung (urandom/base64/Filter) ausreichend. OK.
- K: `wait_for_api_ready`-Grep-Pattern passt zum `/ready`-JSON. OK.
- M: COOKIE_SECURE-Default-Tests (143-162) decken prod→true, dev→false, expliziter Override, leer→unset ab. OK.
