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

## AP-02-identity-access: neu geprüfte Abhängigkeiten

| Paket | Version | Letztes Release | Security Advisories | Bus-Faktor / Wartung | Lizenz | Ergebnis |
|---|---|---|---|---|---|---|
| openid-client | ^6.8.0 | Apr 2026 (6.8.4) | keine offenen kritischen (Snyk-geprüft) | panva, sehr aktiv, 821+ abhängige Projekte | MIT | Zugelassen |
| @nestjs/passport | ^11.0.5 | Feb 2026 | keine | NestJS-Core-Team, offizielles Modul | MIT | Zugelassen |
| passport | ^0.7.0 | aktiv gepflegt | keine kritischen | jaredhanson + Community, sehr weite Verbreitung | MIT | Zugelassen |
| express-session | ^1.19.0 | Jan 2026 | keine offenen (Snyk-geprüft) | expressjs-Organisation | MIT | Zugelassen |
| cookie-parser | ^1.4.7 | aktiv gepflegt | keine | expressjs-Organisation | MIT | Zugelassen |
| class-validator | ^0.14.1 | aktiv gepflegt, weite Verbreitung | keine kritischen | typestack, weite Verbreitung | MIT | Zugelassen |
| class-transformer | ^0.5.1 | aktiv gepflegt | keine kritischen | typestack | MIT | Zugelassen |

## AP-08-paperless-ngx: neu geprüfte Abhängigkeiten

| Paket | Version | Letztes Release | Security Advisories | Bus-Faktor / Wartung | Lizenz | Ergebnis |
|---|---|---|---|---|---|---|
| @nestjs/axios | ^4.0.1 | Apr 2026 | keine offenen kritischen | NestJS Core Team, offizielles Modul, aktiv | MIT | Zugelassen |
| axios | ^1.18.1 | Apr 2026 | keine offenen kritischen (Snyk-geprüft) | Weite Verbreitung, aktiv, 30M+ wöchentl. Downloads | MIT | Transitiv zugelassen |

## AP-09-ai-assist: neu geprüfte Abhängigkeiten

| Paket | Version | Letztes Release | Security Advisories | Bus-Faktor / Wartung | Lizenz | Ergebnis |
|---|---|---|---|---|---|---|
| @nestjs/bullmq | ^11.0.0 | Feb 2026 | keine offenen kritischen | NestJS Core Team, offizielles Modul, aktiv | MIT | Bereits in foundation zugelassen |
| axios | ^1.18.1 | Apr 2026 | keine offenen kritischen (Snyk-geprüft) | Weite Verbreitung, aktiv, 30M+ wöchentl. Downloads | MIT | Bereits via @nestjs/axios in API zugelassen |

### Explizit verworfene Kandidaten
- **passport-openidconnect** (jaredhanson): letztes Release Feb 2024 (>12 Monate), geringere Aktivität als openid-client. Nicht zugelassen.
- **passport-jwt**: letztes Release >4 Jahre zurück, kein aktiver Bus-Faktor sichtbar. Nicht zugelassen; JWT-Validierung erfolgt bei Bedarf über @nestjs/jwt.
