# AI-Agent Umsetzungsplan

## Ziel
Ein AI Agent soll das Projekt strukturiert, dateibasiert und iterativ implementieren können.

## Arbeitsmodus
- Strikte Arbeitspakete mit klaren Definition-of-Done-Kriterien
- Pro Schritt nur begrenzte Dateimengen ändern
- Architekturregeln maschinell prüfbar machen
- Jedes Feature Ende-zu-Ende lauffähig bevor das nächste beginnt

## Reihenfolge
1. Repository-Scaffold mit Monorepo-Struktur
2. Foundation: Auth, Config, DB, Jobs, UI-Theme, Design System
3. Feature Slice `policy-registry`
4. Feature Slice `cost-tracking`
5. Feature Slice `documents`
6. Feature Slice `family-sharing`
7. Feature Slice `admin-settings`
8. Feature Slice `ai-assist`
9. Feature Slice `portal-connectors`
10. Audit, Notifications, Hardening

## Monorepo-Vorschlag
- `apps/web`
- `apps/api`
- `apps/worker`
- `packages/ui`
- `packages/config`
- `packages/types`
- `packages/testing`
- `docs`

## Definition of Done je Slice
- Datenmodell und Migration vorhanden
- API-Endpunkte dokumentiert
- UI-Masken funktionsfähig
- Tests für Kernlogik vorhanden
- Feature-Flag integrierbar
- Health/Readiness berücksichtigt
- Fehlende Abhängigkeiten sauber degradierbar

## Agent-Regeln
- Keine Bibliothek ohne Maintenance-Prüfung aufnehmen
- Keine Querschnittslogik in fachliche Shared-Ordner verschieben
- Keine direkten Imports zwischen fachlichen Slices ohne Port/Adapter
- Alle externen Integrationen hinter Capability-Interfaces
