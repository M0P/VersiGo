# AP-02: Persistenz-Grundlage und technische Foundations

## Ziel
Persistenz-Grundlage, Konfigurationsbasis und technische Foundation-Module
für den modularen Monolithen, ohne fachliche Endpunkte oder UI-Features.

## Scope
- ORM-Entscheidung (siehe docs/adr/ADR-004-orm-prisma.md)
- Prisma-Schema: Household, User, HouseholdMembership, ObjectShare,
  IntegrationSetting, FeatureFlag, AuditEvent
- Zentrale typisierte Konfigurationsschicht (zod + @nestjs/config)
- Foundation-Module: Database, Config, Health/Readiness, Capability-Flags,
  Encryption-Port
- Worker-Startpunkt mit gemeinsamer Queue-Infrastruktur (BullMQ), ohne
  fachliche Jobs
- Tests für Kernlogik der Foundations

## Nicht im Scope
- Fachliche Versicherungs-Use-Cases
- OIDC-Login-Implementierung
- AI-Provider-Implementierung
- Paperless-Anbindung
