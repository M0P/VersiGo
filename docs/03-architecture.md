# Architektur

## Zielbild
Empfohlen wird ein **modularer Monolith** mit vertikal geschnittenen Feature-Slices. Jedes Feature kapselt API, Domainlogik, Persistenzadapter, UI-Module, Hintergrundjobs und Integrationen soweit möglich eigenständig.

## Warum modularer Monolith zuerst
- Ein Deployment-Artefakt reduziert Betriebsaufwand im Docker-Compose-Setup.
- Klare Feature-Grenzen bleiben erhalten.
- Spätere Extraktion einzelner Features in Dienste bleibt möglich.
- Admin-UI, OIDC, Jobs und Berechtigungen sind in einer Anwendung einfacher konsistent.

## Technologievorschlag
- Backend: NestJS oder Spring Boot; bevorzugt **NestJS** wegen guter Modularisierung, OpenAPI, WebSocket/Jobs-Ökosystem und schneller Fullstack-Umsetzung.
- Frontend: **Next.js** oder React + Vite; bevorzugt **Next.js** mit App Router nur für UI/SSR, kein erzwungener Coupling zur API.
- Datenbank: **PostgreSQL**.
- Objekt-/Dateispeicher: S3-kompatibel, initial MinIO optional; alternativ lokales Volume.
- Queue/Jobs: Redis + BullMQ.
- Suche optional: PostgreSQL Full Text zuerst, keine zusätzliche Suchmaschine in V1.
- Auth: OIDC via Keycloak, Authentik oder externer IdP.

## Strukturelle Regeln
- Kein Shared-Domain-Monster-Modul.
- Gemeinsame Bausteine nur als technische Foundation-Module, nicht als fachliche Sammelstelle.
- Kommunikation zwischen Features über interne Events, stabile Interfaces oder Query-Ports.
- Jede Integration ist optional und über Capability-Flags registriert.
- Wenn ein abhängiges Feature fehlt, wird nur die konkrete Teilfunktion deaktiviert.

## Deployment-Topologie
- `web`: Frontend
- `api`: Backend
- `worker`: Hintergrundjobs
- `db`: PostgreSQL
- `redis`: Queue/Cache
- `storage`: optional MinIO
- optional externer OIDC Provider

## Beispiel Feature-Degradation
- AI Provider nicht konfiguriert: Vertragserfassung bleibt nutzbar, nur Extraktion/Zusammenfassung wird ausgeblendet.
- Paperless nicht verbunden: Dokumentenablage im lokalen Speicher bleibt nutzbar.
- Portal-Mailbox-Connector fehlt: Portal-Link bleibt sichtbar, Inbox-Ansicht entfällt.
