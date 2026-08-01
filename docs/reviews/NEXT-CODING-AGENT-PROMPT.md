# Next Work Package

## Status
Work package **AP-17** (Profil- und Systemeinstellungen in der UI) is committed at hash `cc61483` on branch `feat/AP-17-profil-und-systemeinstellungen-ui`. Final review verdict: 0 Critical / 0 High / 0 Medium / 2 Minor (rounds 1–3 documented in `docs/reviews/AP-17-review-{1..3}.md`). Round 3 returned 2 Minor findings (m9-ext: `valuePlain: null` causing an HTTP 500 instead of a clean 400; M5-ext: missing SSRF guidance on the legacy connectivity-test path); both were fixed immediately after the review and re-verified. Both canonical gates are green: the docker-compose test suite passed ("All checks passed!", 39 test files / 471 API tests + 75 foundation + 18 web + 4 worker, lint + typecheck + prisma migrate deploy + build) and `./scripts/compose-smoke-test.sh --build` passed all steps.

AP-13, AP-14, AP-15, AP-16 and AP-17 are committed. The next work package in rising order is **AP-18 — Portal-Connectoren**.

## Prompt for the next coding-agent

Below is the full content of the next work package. Implement only this work package. Use the same review loop (invoke @code-reviewer, save each result verbatim under `docs/reviews/`, fix Critical/High/Medium findings, iterate until 0 Critical / 0 High / 0 Medium and at most 8 Minor findings, with the canonical Docker Compose test suite green). Do not start any later work package.

---

/prompts/AP-18-portal-connectors.md

# Arbeitspaket AP-18: portal-connectors

## Ziel
Versicherungsportal-Katalog, Deeplinks und Plugin-Rahmen für optionale Connectoren.

## Prompt für das Umsetzungsmodell

```text
Du implementierst AP-18 im Projekt Insura.

Verbindliche Referenzen:
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur-ADRs, Sicherheit und Bibliothekspolitik

Arbeite in einem neuen Branch `feat/AP-18-portal-connectors` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
Versicherungsportal-Katalog, Deeplinks und Plugin-Rahmen für optionale Connectoren.

Akzeptanzkriterien:
- Portal-Link-Verwaltung ist pro Vertrag möglich.
- Kernumfang enthält ausschließlich Deeplinks und Zugangshinweise.
- Mailbox-/Dokumentenabruf ist als experimentelles, deaktiviertes Plugin modelliert.
- Credentials werden nicht als Klartext gespeichert.
- Ein nicht verfügbarer Connector beeinträchtigt den Portal-Link nicht.

Vorgehen:
1. Gib zunächst ausschließlich Ziel, technische Lösung, Architekturentscheidung, betroffene Dateien, neue Abhängigkeiten samt Maintenance-Prüfung, Risiken und Testplan aus.
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur dieses Arbeitspaket. Halte Feature-Grenzen strikt ein.
4. Führe Formatierung, Linting, Typecheck, Unit-Tests, Integrations-/E2E-Tests und Build aus, soweit im Projekt verfügbar.
5. Aktualisiere vor dem finalen Testlauf den Branch mit dem aktuellen `main`.
6. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-18): portal-connectors`

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
