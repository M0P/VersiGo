# Qualitäts- und Bibliothekspolitik

## Zulassungskriterien für Bibliotheken
Eine Bibliothek darf nur verwendet werden, wenn mindestens eine Bedingung erfüllt ist:
- Offizieller LTS-Status, oder
- Aktive Pflege und letzter Release jünger als 12 Monate, oder
- Sehr weite Verbreitung plus laufende Security-Fixes und sichtbare Maintainer-Aktivität

## Prüfkriterien vor Aufnahme
- Letztes Release-Datum
- Release-Frequenz
- Offene Security Advisories
- Kompatibilität mit aktueller Runtime
- Bus-Faktor / Maintainer-Aktivität
- Lizenzkompatibilität

## Technische Leitplanken
- Dependency-Policy-Datei im Repo pflegen
- CI-Check für veraltete Pakete
- Geplanter Maintenance-Review monatlich
- Verbot transitive Altlasten bewusst einzuschleusen

## Empfohlene Kandidaten zur Prüfung bei Projektstart
- Node.js LTS
- NestJS
- Next.js
- React
- PostgreSQL
- Redis
- BullMQ
- Prisma oder TypeORM; bevorzugt Tool-Auswahl erst nach aktueller Maintenance-Prüfung
- Tailwind CSS
- shadcn/ui Bausteine nur mit kontrollierter Aktualisierungsstrategie
