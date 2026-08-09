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

## Lizenzpolitik (Third-Party-Notices)

### Inventar und Prüfung
- **`docs/third-party-notices.md`** listet **alle** npm-Pakete (direkt und
  transitiv, inkl. Dev-Tooling) mit ihrer Lizenz. Die Datei wird generiert:
  `pnpm run licenses:generate` (`node scripts/dependency-licenses.mjs generate`,
  Quelle: installierter pnpm-Store `node_modules/.pnpm`) und muss mit
  `pnpm-lock.yaml` synchron bleiben. Die Generierung ist deterministisch
  (sortiert nach Paketname/-version, unabhängig von Dateisystem- und
  Locale-Reihenfolge).
- **`scripts/dependency-licenses.mjs`** ist die Single Source of Truth der
  Lizenzpolitik (Allowlist, Restriktionen, Sonderfälle). Der **CI/Test-Gate-Check**
  `node scripts/dependency-licenses.mjs check` (in `docker-compose.test.yml`,
  lokal `pnpm run licenses:check`) schlägt fehl, wenn (a) ein Paket eine
  nicht auf der Allowlist stehende Lizenz trägt oder gar keine Lizenz
  deklariert, (b) eine restriktive Lizenz von einem nicht freigegebenen Paket
  genutzt wird, oder (c) die Notices-Datei nicht mehr dem Ist-Zustand
  entspricht.
- **Allowlist (generell erlaubt):** MIT, Apache-2.0, ISC, BSD-2-Clause,
  BSD-3-Clause, BlueOak-1.0.0, Unlicense, 0BSD, Python-2.0.
- **Restriktive Lizenzen (nur für die genannten Pakete, werden vom Check
  erzwungen):** CC-BY-4.0 nur für das Datenpaket `caniuse-lite`,
  LGPL-3.0-or-later nur für `@img/sharp-libvips-linuxmusl-x64`. Jede neue
  Verwendung erfordert eine dokumentierte Freigabe (Eintrag in
  `scripts/dependency-licenses.mjs` + Begründung im Commit).

### Nutzungsregeln je Lizenz („use as intended")
- **MIT / ISC / BSD-2/3-Clause / BlueOak-1.0.0 / 0BSD / Unlicense /
  Python-2.0 (permissiv):** Pakete werden unverändert als Bibliothek genutzt.
  Pflicht bei Weitergabe/Distribution: Urheberrechts- und Lizenzhinweis
  beilegen. Umsetzung: Notices-Datei + Lizenztexte in den Images.
- **Apache-2.0:** wie permissiv, zusätzlich müssen vorhandene `NOTICE`-Dateien
  der Pakete mitgeliefert werden (werden vom Collect-Schritt erfasst).
- **CC-BY-4.0 (`caniuse-lite`):** reines Datenpaket (Browser-Support-Datenbank);
  keine Code-Pflichten, Attribution erfolgt über die Notices-Datei.
- **LGPL-3.0-or-later (`@img/sharp-libvips-linuxmusl-x64`):** das vorgebaute
  libvips-Native-Binary wird **unverändert** und **dynamisch** von sharp
  geladen (LGPL erlaubt dies). Es bleibt ersetzbar (reguläres npm-Update,
  kein statisches Linken, keine Modifikation des Binarys). Die README des
  Pakets (im License-Collect enthalten) listet die gebündelten Dritt-Bibliotheken
  (LGPLv3, MPL-2.0, BSD, MIT).

### Lizenztexte in den Artefakten (Distribution)
- **API/Worker-Images:** `node_modules` wird vollständig kopiert → alle
  `LICENSE*`-Dateien sind im Image vorhanden (Stichprobe: API 172, Worker 155).
- **Web-Image (Next.js standalone):** der Standalone-Output traced nur
  Laufzeitdateien und verwirft Lizenzdateien. Der Web-Dockerfile sammelt die
  Lizenztexte deshalb explizit nach
  (`node scripts/dependency-licenses.mjs collect` →
  `THIRD_PARTY_LICENSES/<store-entry>/<package>/…` im Standalone-Baum; jede
  Paketversion erhält ein eigenes Unterverzeichnis, sodass gleichnamige
  Lizenzdateien sich nicht überschreiben). Dies stellt sicher, dass
  next/react/sharp und das LGPL-libvips-Binary mit ihren Lizenztexten
  ausgeliefert werden.
- Änderungen an Abhängigkeiten erfordern die Regenerierung der Notices-Datei
  (`generate`) und einen grünen `check` im Test-Gate.

## Container- und Basisimage-Policy
- Basisimages: Offizielle Docker-Images von Node.js, PostgreSQL, Redis und MinIO.
- Image-Versionen werden explizit und eingefroren (kein `latest`-Tag außer in lokalen Overrides).
- Multi-Stage-Builds minimieren Final-Image-Größe.
- `node:24-alpine` als Basis für Node.js-Container.
- Alpine-basierte Images für PostgreSQL und Redis.
- MinIO-Image mit festem Datums-Tag.
- Laufzeitcontainer verwenden Non-Root-User.
- Regelmäßige Security-Scans der Basisimages (Dependabot o. Ä.).

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
