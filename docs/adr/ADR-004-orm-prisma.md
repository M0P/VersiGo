# ADR-004: ORM-Auswahl Prisma

## Status
Angenommen

## Kontext
AP2 benötigt eine Persistenzbasis für PostgreSQL. Gemäß
`docs/10-quality-and-library-policy.md` ist die Wahl zwischen Prisma und
TypeORM erst nach aktueller Maintenance-Prüfung zu treffen.

## Prüfkriterien (docs/10-quality-and-library-policy.md)
- Letztes Release-Datum: Prisma und TypeORM beide < 12 Monate.
- Release-Frequenz: Prisma regelmäßiger, kürzere Zyklen.
- Offene Security Advisories: keine kritischen bei beiden zum Prüfzeitpunkt.
- Kompatibilität mit aktueller Node.js-LTS-Runtime: beide kompatibel.
- Bus-Faktor / Maintainer-Aktivität: Prisma mit kommerziellem Träger
  (Prisma Data Platform) und großer Community; TypeORM community-getragen,
  historisch geringere Release-Kadenz.
- Lizenzkompatibilität: Prisma Apache-2.0, TypeORM MIT – beide unkritisch.

## Entscheidung
Prisma wird als ORM für den modularen Monolithen verwendet.

## Begründung
- Schema-first-Ansatz vermeidet ein Shared-Domain-Monster-Modul, da jedes
  Feature-Slice sein Teilschema eigenständig ergänzen kann.
- Generierter, vollständig typisierter Client reduziert Laufzeitfehler.
- Eigenständiges, versioniertes Migrationswerkzeug passt zum
  CI-gestützten Monorepo-Ansatz.
- Bessere Werkzeugunterstützung für Row-Level-Mandantentrennung über
  explizite `householdId`-Filterung in generierten Queries.

## Konsequenzen
- Jedes Feature-Slice pflegt eigene Modelle im gemeinsamen
  `prisma/schema.prisma`, gruppiert per Kommentarblock, ohne fachliche
  Query-Logik in einer zentralen Stelle zu bündeln.
- Migrationsdisziplin (additive Migrationen, keine destructive Changes ohne
  Review) wird in `dependency-policy.md` ergänzt.
- Monatlicher Maintenance-Review gemäß Qualitätspolitik schließt Prisma ein.
