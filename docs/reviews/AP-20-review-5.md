# AP-20 Review, Runde 5

- Datum: 2026-08-03
- Branch: `feat/AP-20-ready-up-for-version-1` (uncommitted)
- Reviewer: @code-reviewer (DeepSeek code-reviewer Subagent)
- Scope: Verifikation der Runde-4-Fixes (A: Catalog-defaultValue Boolean; B: unset COOKIE_SECURE; D: R-13 Checkliste) plus vollständiger Regressions-Scan des uncommitted Diffs (Cleanup-Liste, Schema↔Katalog-Vollständigkeit, set-e-Hazards, COOKIE_SECURE-Doku-Konsistenz).
- Verifiziert vor Review: `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` → EXIT=0 (API 596/55, Web 42, Worker 4, Foundation 95; Lint, Typecheck, i18n-Guard); `./scripts/compose-smoke-test.sh --clean` → EXIT=0, alle 12 Steps grün.

Counts: 0 Critical, 0 High, 0 Medium, 1 Minor — **Verdict: PASS**

---

**Fixes Runde 4 verifiziert (alle korrekt umgesetzt, keine Regression):**
- Fix A: `settings-catalog.ts:333` — `defaultValue: true` (Boolean), Typ-konsistent mit `type: 'boolean'` und `SettingDefinition.defaultValue: string | number | boolean`; Beschreibung nennt die Ableitung aus NODE_ENV. Kein Test betrifft COOKIE_SECURE-defaultValue.
- Fix B: `compose-smoke-test.sh:1194` — `unset ... COOKIE_SECURE` ergänzt; das `export COOKIE_SECURE=false` (Zeile 1097) wird sauber zurückgesetzt.
- Fix D: `beta-release-checklist.md:69` — R-13-Zeile im exakt gleichen 4-Spalten-Format wie R-01..R-12; Aussage entspricht dem tatsächlichen CI-Job (`ci.yml:48-186`).

**Regressions-Scan:**
- (a) /tmp-Artefaktliste: bis auf die zwei Step-8p-Dateien (siehe Finding unten) vollständig; keine Nicht-versigo-/tmp-Dateien.
- (b) Schema↔Katalog-Vollständigkeit: alle 37 appConfigSchema-Keys katalogisiert (Settings-catalog.spec:23-36 grün).
- (c) set-e-Hazards: Schritt-11-`set +e`/`set -e` korrekt; alle Greps/Curls in Schritt 12 abgesichert; kein neuer Silent-Abort.
- (d) COOKIE_SECURE-Doku-Konsistenz: README:221, `.env.example:47-52`, `docker-image-guide.md:170-174`, `docker-compose.yml:92-96`, `docs/07:37-38`, `docs/08:20`, `docs/13:117` — überall gleiche Semantik (Default true in Produktion, nur bei HTTP-Betrieb explizit setzen). Konsistent.

---

**Finding:**

- **[Minor] `scripts/compose-smoke-test.sh:839,850,861` — Step-8p-Temp-Dateien `/tmp/versigo-smoke-policy-create.json` und `/tmp/versigo-smoke-policy-list.json` fehlen in der expliziten EXIT-Trap-Cleanup-Liste**
  - Evidence: Der eigene Vertrag des Skripts (Zeilen 59-62) erklärt die `rm -f`-Liste in `cleanup()` als „VOLLSTAENDIGE, explizite Dateiliste" und verlangt: „Jedes neue Artefakt dieses Skripts muss hier ergaenzt werden". Step 8p erzeugt die beiden Dateien per `curl -o` (Zeilen 839, 850) und entfernt sie nur inline in Zeile 861. Bricht das Skript zwischen Erzeugung und Zeile 861 mit `exit 1` ab (z. B. FAILED-Checks Zeilen 844-857), läuft die EXIT-Trap `cleanup()` ohne die beiden Dateien — das einzige Step-8p-Artefakt-Leck im gesamten Skript. Alle anderen Artefakte (inkl. der `versigo-prod-policy-*`-Pendants) stehen in der Liste. Keine Session-Cookies in diesen Dateien (nur Policy-JSON), Impact also begrenzt auf verwaiste Nicht-Secret-Dateien in /tmp auf Fehlerpfaden — widerspricht aber der zugesicherten Vollständigkeit.
  - Required fix: `/tmp/versigo-smoke-policy-create.json` und `/tmp/versigo-smoke-policy-list.json` in die `rm -f`-Liste von `cleanup()` (Zeilen 63-90) aufnehmen.

---

**Verbleibende Risiken:** Nur die oben genannte Minor-Cleanup-Lücke. Keine funktionalen, sicherheitsrelevanten oder Regressions-Probleme gefunden.
