# ADR-001 Vertikale Slices

## Status
Accepted

## Entscheidung
Die Anwendung wird in vertikal geschnittene Feature-Slices organisiert. Jeder Slice enthält Domainlogik, API, Persistenzadapter, UI-Anteile und Jobs.

## Konsequenzen
- Klare fachliche Grenzen
- Bessere Degradierbarkeit optionaler Funktionen
- Höhere Disziplin bei Schnittstellen nötig
