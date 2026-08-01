# Next Work Package

## Status
Work package **AP-18** (portal-connectors) is committed at hash `c65ecb1` on branch `feat/AP-18-portal-connectors`. Final review verdict: 0 Critical / 0 High / 0 Medium / 2 Minor (rounds 1–5 documented in `docs/reviews/AP-18-review-{1,2,4,5}.md`). All findings were fixed and re-verified. Both canonical gates are green: the docker-compose test suite passed ("All checks passed!", 44 test files / 517 API tests + 75 foundation + 18 web + 4 worker, lint + typecheck + prisma migrate deploy + build) and `./scripts/compose-smoke-test.sh --build` passed all steps (including the AP-18 endpoint checks 8f/9). The branch was updated to the current `main` (`1acd65c`) before the final test run, per the work package.

Cleanup was performed after the final verification run (per AGENTS.md rule 9 / `prompts/00-gemeinsame-regeln.md` "Aufräum-Pflicht"): debug containers `iter-test` and `mig-pg` and session images `localhost/insura:latest` and `localhost/insura-test:latest` were removed; pre-existing containers and shared base images were left untouched.

AP-13 through AP-18 are committed. The next work package in rising order is **AP-19 — audit-privacy-monitoring**.

## Prompt for the next coding-agent

Below is the full content of the next work package. Implement only this work package. Use the same review loop (invoke @code-reviewer, save each result verbatim under `docs/reviews/`, fix Critical/High/Medium findings, iterate until 0 Critical / 0 High / 0 Medium and at most 8 Minor findings, with the canonical Docker Compose test suite green). Clean up all Docker/Podman artifacts you create at the end of the work package (see AGENTS.md rule 9). Do not start any later work package.

---

/prompts/AP-19-audit-privacy-monitoring.md

# Arbeitspaket AP-19: audit-privacy-monitoring

## Ziel
Audit, Datenschutzexport/-löschung, Health Checks, Monitoring und Produktionshärtung.

## Prompt für das Umsetzungsmodell

```text
Du implementierst AP-19 im Projekt Insura.

Verbindliche Referenzen:
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur-ADRs, Sicherheit und Bibliothekspolitik

Arbeite in einem neuen Branch `feat/AP-19-audit-privacy-monitoring` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
Audit, Datenschutzexport/-löschung, Health Checks, Monitoring und Produktionshärtung.

Akzeptanzkriterien:
- Sicherheits- und fachrelevante Mutationen sind auditierbar.
- Export und Löschung personenbezogener Daten sind berechtigungsgeprüft.
- Health-/Readiness-Checks existieren pro wesentlicher Komponente.
- Queue-, Job- und Integrationsfehler sind sichtbar, ohne sensible Daten offenzulegen.
- Sicherheits- und End-to-End-Tests decken kritische Abläufe ab.

Vorgehen:
1. Gib zunächst ausschließlich Ziel, technische Lösung, Architekturentscheidung, betroffene Dateien, neue Abhängigkeiten samt Maintenance-Prüfung, Risiken und Testplan aus.
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur dieses Arbeitspaket. Halte Feature-Grenzen strikt ein.
4. Führe Formatierung, Linting, Typecheck, Unit-Tests, Integrations-/E2E-Tests und Build aus, soweit im Projekt verfügbar.
5. Aktualisiere vor dem finalen Testlauf den Branch mit dem aktuellen `main`.
6. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-19): audit-privacy-monitoring`

PR-Beschreibung muss enthalten:
- Zweck und Architekturentscheidung
- Liste geänderter Dateien
- Nachweis aller Akzeptanzkriterien
- Ausgeführte Befehle und Ergebnisse
- Neue Abhängigkeiten mit Maintenance-Prüfung
- Sicherheits- und Datenschutzbewertung
- Bekannte Grenzen oder bewusst nicht umgesetzte Teilfunktionen

Merge-Gate:
Der Pull Request darf nur nach erfolgreich bestandenem Funktionstest, grüner CI, aktuellem `main` im Branch und unabhängigem Review gemergt werden. Wenn ein Check fehlschlägt, behebe ihn im selben Branch und aktualisiere den Pull Request.
```
