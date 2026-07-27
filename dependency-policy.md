# Dependency-Policy

## Zulassungskriterien
Siehe docs/10-quality-and-library-policy.md. Jede neue Abhängigkeit wird vor Aufnahme geprüft auf:
- Letztes Release-Datum (< 12 Monate oder LTS)
- Offene kritische Security-Advisories
- Maintainer-Aktivität / Bus-Faktor
- Lizenzkompatibilität

## Review-Rhythmus
Monatlicher Review via `pnpm outdated -r` und `pnpm audit`. Ergebnisse werden im PR-Log dokumentiert.

## Aktuell freigegebene Kern-Stack-Versionen
| Paket | Version | Quelle |
|---|---|---|
| Node.js | 24 LTS | Node.js Release Blog |
| NestJS | ^11.0.0 | nestjs/nest Releases |
| Next.js | 16.2.6 | Vercel Next.js Blog |
| React | 19.1.0 | offiziell freigegeben mit Next 16 |
| PostgreSQL | 16.4 | Docker Official Image |
| Redis | 7.4 | Docker Official Image |
