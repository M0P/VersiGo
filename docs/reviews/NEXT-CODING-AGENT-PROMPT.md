# Nächster Agent: AP-10-ai-coverage-summaries

Führe den folgenden Prompt im nächsten Coding-Agent-Session aus:

---

```text
Du implementierst AP-10 im Projekt Insura.

## Work Package: AP-10-ai-coverage-summaries

Ziel: AI-Leistungszusammenfassungen mit Quellenbezug, Status und übersichtlicher UI.

Full contents of `prompts/AP-10-ai-coverage-summaries.md`:

# Arbeitspaket AP-10: ai-coverage-summaries

## Ziel
AI-Leistungszusammenfassungen mit Quellenbezug, Status und übersichtlicher UI.

## Prompt für das Umsetzungsmodell

```text
Du implementierst AP-10 im Projekt Insura.

Verbindliche Referenzen:
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur-ADRs, Sicherheit und Bibliothekspolitik

Arbeite in einem neuen Branch `feat/AP-10-ai-coverage-summaries` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
AI-Leistungszusammenfassungen mit Quellenbezug, Status und übersichtlicher UI.

Akzeptanzkriterien:
- Zusammenfassungen sind als abgeleitete, regenerierbare Daten gespeichert.
- Quellendokumente und Modell/Provider sind sichtbar.
- Die UI zeigt klare Hinweise auf fehlende oder deaktivierte AI-Konfiguration.
- Keine Beratung oder nicht belegbare Zusage erzeugen; Darstellung ist als Vertragszusammenfassung gekennzeichnet.
- Tests decken Degradierung, Fehlerfälle und Quellenverknüpfung ab.

Vorgehen:
1. Gib zunächst ausschließlich Ziel, technische Lösung, Architekturentscheidung, betroffene Dateien, neue Abhängigkeiten samt Maintenance-Prüfung, Risiken und Testplan aus.
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur dieses Arbeitspaket. Halte Feature-Grenzen strikt ein.
4. Führe Formatierung, Linting, Typecheck, Unit-Tests, Integrations-/E2E-Tests und Build aus, soweit im Projekt verfügbar.
5. Aktualisiere vor dem finalen Testlauf den Branch mit dem aktuellen `main`.
6. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-10): ai-coverage-summaries`

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

### Wichtige Anweisungen

1. **Implementiere NUR dieses Arbeitspaket (AP-10).** Nicht später beginnende Arbeitspakete anfangen.
2. **Verwende denselben Review-Loop** wie in AGENTS.md beschrieben:
   - Implementieren → Checks laufen lassen → @code-reviewer aufrufen → Review-Ergebnis in docs/reviews/ speichern → Findings fixen → erneut reviewen → bei Akzeptanz committen.
   - Akzeptanzbedingung: 0 Critical, 0 High, 0 Medium, ≤8 Minor.
3. **Starte in einem neuen Branch** `feat/AP-10-ai-coverage-summaries` auf Basis von `main`.
4. **Nach erfolgreichem Commit** das nächste Arbeitspaket identifizieren (`prompts/AP-11-portal-connectors.md`) und eine neue NEXT-CODING-AGENT-PROMPT.md erstellen. Danach stoppen.

## Basis-Wissen

- Distrobox `fedora-app` für alle CLI-Befehle: `distrobox enter fedora-app -- <command>`
- PostgreSQL läuft in der Distrobox. Dev-Server: `distrobox enter fedora-app -- bash -c "pnpm run dev"`
- Alle relevanten Checks: lint, typecheck, test (API: vitest, Worker: vitest)
- Prisma: `distrobox enter fedora-app -- bash -c "CI=true pnpm --filter @insura/api exec prisma generate"`
- CI=true verhindert interaktive Nachfragen bei pnpm
```
