# Insura

Softwarekonzept für eine private Haushalts-Versicherungsübersicht mit modularer, vertikal geschnittenen Architektur.

## Ziel
Insura verwaltet Versicherungsverträge, Dokumente, Kostenhistorien, Portal-Links und optionale AI-gestützte Extraktion/Zusammenfassungen für Privathaushalte.

## Entwicklungssetup

Da dieses Projekt in einer Distrobox-Umgebung ohne Docker läuft, sind spezielle Docker-Komponenten nicht relevant.

### Voraussetzungen
- Node.js 24.x
- pnpm 11.x
- PostgreSQL 16.x (lokal installiert)
- Redis 7.x (lokal installiert)

### Lokale Entwicklung

1. Klonen Sie das Repository
2. Installieren Sie Abhängigkeiten: `pnpm install`
3. Erstellen Sie eine lokale PostgreSQL-Datenbank:
   ```bash
   createdb insura
   ```
4. Erstellen Sie eine lokale Redis-Instanz
5. Kopieren Sie `.env.example` nach `.env` und passen Sie die Einstellungen an
6. Führen Sie die Migration durch:
   ```bash
   pnpm --filter @insura/api exec prisma migrate dev
   ```
7. Starten Sie die Entwicklungsumgebung:
   ```bash
   pnpm run dev
   ```

## Dokumente
- `docs/01-product-vision.md`
- `docs/02-requirements.md`
- `docs/03-architecture.md`
- `docs/04-data-model.md`
- `docs/05-feature-slices.md`
- `docs/06-integrations.md`
- `docs/07-security-privacy.md`
- `docs/08-admin-operations.md`
- `docs/09-ai-agent-implementation-plan.md`
- `docs/10-quality-and-library-policy.md`
- `docs/11-ui-ux.md`
- `docs/12-roadmap.md`
- `docs/adr/ADR-001-vertical-slices.md`
- `docs/adr/ADR-002-modular-monolith-first.md`
- `docs/adr/ADR-003-async-ai-and-imports.md`