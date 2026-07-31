# Bugfix: Lokalen Docker- und Monorepo-Start vollständig lauffähig machen

Du arbeitest in einem bestehenden TypeScript-Monorepo mit Docker Compose, pnpm, Turborepo, NestJS, Prisma, PostgreSQL, Redis und Next.js.

## Ziel

Behebe die aktuellen Startfehler so, dass der vollständige lokale Entwicklungsstack zuverlässig startet und aktiv bleibt:

- PostgreSQL
- Redis
- Prisma-Migrationen
- NestJS API
- NestJS Worker
- Next.js Web-Frontend

Die Funktionalität, Sicherheitsanforderungen und Datenbankmigrationen dürfen nicht zurückgebaut oder umgangen werden. Behebe die Ursachen sauber, minimal-invasiv und reproduzierbar.

## Aktueller Befund

Die Infrastruktur und Datenbankseite funktionieren bereits:

- PostgreSQL startet.
- Redis startet.
- Alle vier Prisma-Migrationen werden erfolgreich ausgeführt.
- Der dedizierte API-Container startet NestJS, registriert seine Routen und kann bei gesetzter Konfiguration mit lokaler Authentifizierung starten.
- Der vorhandene API-Stack enthält unter anderem die Endpunkte `/health`, `/ready`, `/auth/local/login`, `/auth/me` und `/auth/logout`. [file:15]

Folgende Fehler verhindern jedoch einen vollständigen Systemstart.

---

## 1. Web-Container: Dateiberechtigungsfehler bei pnpm

Der Web-Container scheitert wiederholt beim Start:

```text
EACCES: permission denied, open /app/tmp/<temporäre-datei>
pnpm install
Command failed with exit code 243
```

Der Container gerät dadurch in eine Restart-Schleife.

### Anforderungen

- Ermittle die Ursache für die fehlenden Schreibrechte unter `/app/tmp`.
- Prüfe Dockerfile, Compose-Konfiguration, `USER`, `WORKDIR`, `COPY --chown`, Bind-Mounts, Volumes und Entrypoint-Skripte.
- Stelle sicher, dass der Nutzer im Container Schreibrechte für alle während des Starts benötigten Pfade besitzt, insbesondere:
  - `/app/tmp`
  - pnpm-Cache
  - `node_modules`
  - Next.js-Artefakte wie `.next`
- Falls `pnpm install` im Containerstart nicht nötig ist, installiere Abhängigkeiten reproduzierbar im Image-Build oder ersetze es durch einen lockfile-sicheren Ablauf wie:

```bash
pnpm install --frozen-lockfile
```

- Vermeide `chmod 777`, Container-Ausführung als root und andere unsichere Workarounds, sofern eine saubere Ownership- und Mount-Lösung möglich ist.
- Stelle sicher, dass vorhandene Bind-Mounts keine im Image korrekt gesetzten Rechte wieder überschreiben.

### Akzeptanzkriterien

- Der Web-Container startet ohne `EACCES`.
- `pnpm install` endet nicht mehr mit Exit-Code 243.
- Der Container gerät nicht mehr in eine Restart-Schleife.
- Das Next.js-Frontend ist nach dem Start erreichbar.

---

## 2. API im Turborepo-Dev-Modus: falscher NestJS-Einstiegspunkt

Beim Monorepo-Start läuft für die API:

```text
nest start --watch
```

Die TypeScript-Kompilierung meldet zunächst keine Fehler, anschließend scheitert Node jedoch mit:

```text
Error: Cannot find module '/app/apps/api/dist/main'
code: 'MODULE_NOT_FOUND'
```

Der funktionierende Container-Build verwendet hingegen offenbar einen verschachtelten Ausgabepfad wie:

```text
/app/apps/api/dist/apps/api/src/main.js
```

### Anforderungen

- Prüfe insbesondere:
  - `apps/api/package.json`
  - `apps/api/nest-cli.json`
  - `apps/api/tsconfig.json`
  - `apps/api/tsconfig.build.json`
  - Root-`nest-cli.json`, falls vorhanden
  - `turbo.json`
  - Docker-`WORKDIR`
  - Startkommandos und Entrypoints
- Stelle sicher, dass `nest start --watch` den korrekten TypeScript-Einstiegspunkt und den richtigen Ausgabepfad verwendet.
- Behebe die Inkonsistenz zwischen Arbeitsverzeichnis, `sourceRoot`, `entryFile` und `outDir`.
- Verwende keinen manuellen Kopier-, Symlink- oder Dummy-Workaround für `dist/main`; die Nest-Konfiguration muss korrekt sein.
- Der API-Dev-Prozess muss nach der Kompilierung dauerhaft weiterlaufen.
- Der API-Container und der lokale Turborepo-Dev-Start sollen dieselbe gültige Nest-Projektkonfiguration verwenden.

### Akzeptanzkriterien

- Der API-Dev-Task startet ohne `MODULE_NOT_FOUND`.
- Der Prozess bleibt nach erfolgreicher Kompilierung aktiv.
- `GET /health` und `GET /ready` liefern erfolgreich Antworten.
- Quellcodeänderungen lösen im Watch-Modus einen erfolgreichen Rebuild aus.

---

## 3. Worker: NestJS Dependency Injection für AppConfigService defekt

Der Worker startet, scheitert dann jedoch mit:

```text
UnknownDependenciesException:
Nest can't resolve dependencies of the AppConfigService (?).
The dependency at index  is undefined at runtime.
```

Nest weist darauf hin, dass dies häufig durch `import type` statt eines Laufzeitimports, fehlende `@Injectable()`-Dekorierung oder einen nicht registrierten bzw. exportierten Provider entsteht.

### Anforderungen

- Finde die Definition von `AppConfigService` sowie seine Konstruktorabhängigkeit an Index 0.
- Prüfe alle betroffenen Imports auf unzulässige `import type`-Verwendung bei injizierbaren Klassen.
- Stelle sicher, dass alle zur Laufzeit injizierten Klassen regulär importiert werden.
- Stelle sicher, dass alle Provider:
  - mit `@Injectable()` dekoriert sind,
  - im richtigen Modul unter `providers` registriert sind,
  - bei modulübergreifender Nutzung korrekt exportiert werden,
  - vom Worker-Modul bzw. dessen importierten Modulen erreichbar sind.
- Wenn ein Injection-Token vorgesehen ist, nutze ihn explizit mit `@Inject(TOKEN)` und stelle den passenden Provider bereit.
- Prüfe und löse mögliche zirkuläre Modulabhängigkeiten sauber, falls vorhanden.
- Stelle sicher, dass API und Worker dieselben Foundation- bzw. Config-Module konsistent verwenden.

### Akzeptanzkriterien

- Der Worker startet ohne `UnknownDependenciesException`.
- Der Worker bleibt aktiv.
- Der Worker verbindet sich erfolgreich mit PostgreSQL und Redis.
- Der Worker kann mindestens einen vorhandenen Queue- oder Testjob verarbeiten.

---

## 4. Lokale Authentifizierung als Standard und konfigurierbarer Initial-Admin

Die API beendet den Start, wenn keine Authentifizierungsmethode explizit konfiguriert ist:

```text
KEINE AUTHENTIFIZIERUNGSMETHODE KONFIGURIERT.
Setze mindestens eine der folgenden Umgebungsvariablen:
OIDC_ENABLED=true oder LOCAL_AUTH_ENABLED=true.

Error: No authentication method configured.
Set OIDC_ENABLED=true or LOCAL_AUTH_ENABLED=true.
```

Die lokale Authentifizierung soll für die lokale Entwicklungsumgebung der Standard sein. OIDC soll nur bei expliziter Aktivierung verwendet werden. Der vorhandene lokale Login-Endpunkt `POST /auth/local/login` muss mit einem initialen Administrator nutzbar sein.

### Anforderungen

- Prüfe die Konfigurationsauflösung im `IdentityModule`, in `AppConfigService` sowie in allen Docker-, Compose-, `.env`- und `.env.example`-Dateien.
- Setze `LOCAL_AUTH_ENABLED` standardmäßig auf `true`, wenn die Variable nicht gesetzt ist und die Anwendung im lokalen Entwicklungsmodus läuft.
- Setze `OIDC_ENABLED` standardmäßig auf `false`, wenn die Variable nicht gesetzt ist.
- Eine explizit gesetzte Umgebungsvariable muss stets Vorrang vor dem Default haben.
- Die Anwendung darf bei fehlenden Auth-Flags im lokalen Entwicklungsmodus nicht abbrechen, sondern muss mit lokaler Authentifizierung starten.
- Behalte einen sicheren Fail-Fast-Mechanismus für nicht-lokale bzw. produktive Umgebungen bei: Dort darf die Anwendung nicht versehentlich ohne eine explizit zulässige Authentifizierungskonfiguration starten.
- Definiere die erforderlichen Variablen für den initialen lokalen Administrator in der lokalen `.env` sowie als dokumentierte Platzhalter in `.env.example`.
- Verwende eindeutige, konsistente Variablennamen entsprechend der bestehenden Konventionen des Projekts. Falls noch keine Namen bestehen, verwende:

```dotenv
# Lokale Entwicklung
LOCAL_AUTH_ENABLED=true
OIDC_ENABLED=false

# Initialer lokaler Administrator
LOCAL_ADMIN_EMAIL=admin@local.test
LOCAL_ADMIN_PASSWORD=<nur-lokal-sicheres-passwort>
LOCAL_ADMIN_FIRST_NAME=Local
LOCAL_ADMIN_LAST_NAME=Admin
```

- Der konkrete Wert für `LOCAL_ADMIN_PASSWORD` darf in einer lokalen, nicht versionierten `.env` stehen.
- Hinterlege kein echtes oder allgemein bekanntes Passwort in `.env.example`, Dockerfile, Docker-Compose-Datei, Quellcode, Test-Fixtures oder Logs.
- `.env.example` muss für das Passwort ausschließlich einen klaren Platzhalter enthalten, zum Beispiel:

```dotenv
LOCAL_ADMIN_PASSWORD=CHANGE_ME_FOR_LOCAL_DEVELOPMENT
```

- Stelle sicher, dass die lokale `.env` durch `.gitignore` geschützt ist und nicht eingecheckt wird.
- Implementiere einen idempotenten Bootstrap für den Initial-Admin:
  - Beim ersten Start auf einer leeren Datenbank wird der lokale Admin angelegt.
  - Bei weiteren Starts wird kein Duplikat angelegt.
  - Das Passwort wird ausschließlich gehasht gespeichert.
  - Wenn sich das konfigurierte Passwort nach dem ersten Start ändert, darf es nicht stillschweigend bei jedem Start überschrieben werden.
  - Ein bewusst dokumentierter Reset- oder Seed-Mechanismus ist zulässig.
  - Fehlende oder unsichere Default-Zugangsdaten dürfen außerhalb der lokalen Entwicklungsumgebung keinen Start mit einem bekannten Administrator ermöglichen.
- Stelle sicher, dass alle API- und Worker-Container dieselbe Auth-Konfiguration erhalten, falls beide sie benötigen.
- Ergänze Tests für die Default-Auflösung der Auth-Flags und den idempotenten Initial-Admin-Bootstrap.
- Logge niemals Zugangsdaten, Passwort-Hashes oder vollständige sensible Konfigurationswerte.

### Akzeptanzkriterien

- Ein lokaler Start ohne gesetzte `OIDC_ENABLED`- oder `LOCAL_AUTH_ENABLED`-Variable startet die API mit lokaler Authentifizierung.
- Die Logs zeigen eindeutig: OIDC inaktiv, lokale Authentifizierung aktiv.
- Die API beendet sich nicht mehr mit `No authentication method configured`.
- Bei leerer Datenbank wird genau ein lokaler Admin aus den lokalen `.env`-Variablen angelegt.
- Der Login über `POST /auth/local/login` mit den konfigurierten Zugangsdaten ist erfolgreich.
- Das gespeicherte Passwort liegt nur als Hash vor.
- Ein zweiter Start erzeugt keinen zweiten Admin-Benutzer.
- In Produktion oder einer als nicht-lokal definierten Umgebung ist kein festes bzw. bekanntes Default-Passwort zulässig.
- Dort bleibt eine explizite und sichere Authentifizierungskonfiguration erforderlich.

---

## 5. Next.js: Cross-Origin für Entwicklung zulassen

Next.js blockiert HMR-Anfragen von:

```text
192.168.24.8
```

mit dem Hinweis, die IP in `allowedDevOrigins` zu ergänzen.

### Anforderungen

- Ergänze die verwendete Entwicklungsadresse in der Next.js-Konfiguration über `allowedDevOrigins`.
- Kapsle die Einstellung auf die Entwicklungsumgebung.
- Falls die IP je nach Umgebung variiert, ermögliche eine sichere Konfiguration über eine Umgebungsvariable oder eine klar begrenzte Whitelist.
- Schwäche keine produktiven Origin-Schutzmaßnahmen pauschal ab.
- Dokumentiere die Konfiguration in `.env.example`, falls eine Umgebungsvariable ergänzt wird.

### Akzeptanzkriterien

- HMR- und Next.js-Dev-Requests über die konfigurierte Entwicklungsadresse werden nicht mehr blockiert.
- Die Einstellung greift ausschließlich in der Entwicklungsumgebung.
- Produktiv bleibt die Origin-Prüfung restriktiv.

---

## 6. Turborepo-Dev-Start modernisieren

Der Root-Start verwendet:

```text
turbo run dev --parallel
```

Dafür wird eine Deprecation-Warnung ausgegeben.

### Anforderungen

- Migriere die Dev-Task-Konfiguration in `turbo.json` auf die aktuelle Turborepo-Konvention.
- Konfiguriere persistente Dev-Tasks korrekt.
- Verwende bei Bedarf `with` oder andere aktuelle Task-Abhängigkeiten, ohne den Startablauf unnötig zu verkomplizieren.
- Entferne die Verwendung von `--parallel` aus dem Root-Startskript.
- Stelle sicher, dass der Root-Start konsistente Fehler liefert und nicht wegen einer fehlerhaften Orchestrierung alle Prozesse unkontrolliert beendet.
- Prüfe, ob API, Worker und Web als `persistent` konfiguriert werden müssen und ob Build-/Codegen-Abhängigkeiten vor dem Start erfüllt sein müssen.

### Akzeptanzkriterien

- Der Root-Dev-Befehl startet API, Worker und Web als dauerhafte Prozesse.
- Es erscheint keine `--parallel`-Deprecation-Warnung mehr.
- Der Root-Dev-Prozess läuft weiter, solange die einzelnen Dienste gesund sind.
- Fehler eines Dienstes werden klar im Log ausgewiesen.

---

## Nicht Teil des Bugfixes

Folgende Logmeldungen sind aktuell nicht ursächlich für den Systemstart und sollen nur dann angepasst werden, wenn dies ohne zusätzlichen Scope möglich ist:

- Hinweis auf eine neue npm-Version.
- PostgreSQL-Warnung bezüglich fehlender System-Locale im Alpine-Container.
- Next.js-Warnung zur veralteten `middleware`-Konvention.
- Hinweis auf ein langsames Dateisystem.
- Turborepo- und Next.js-Telemetriehinweise.

---

## Vorgehensweise

1. Prüfe zuerst die vorhandene Repository-, Docker-, pnpm-, NestJS- und Turborepo-Konfiguration, bevor du Änderungen vornimmst.
2. Ermittle für jeden Fehler die Ursache anhand der tatsächlich verwendeten Dateien und Laufzeitwerte.
3. Führe gezielte Änderungen mit möglichst kleinem Scope durch.
4. Ändere keine Datenbankmigrationen, außer wenn dies für den idempotenten Initial-Admin zwingend erforderlich und sauber begründet ist.
5. Ergänze oder aktualisiere Tests, wenn für Startkonfigurationen, DI, Authentifizierung, Bootstrap oder Health Checks bereits Testinfrastruktur vorhanden ist.
6. Dokumentiere jede Änderung kurz: Ursache, geänderte Datei und technische Begründung.
7. Führe anschließend einen vollständigen Clean-Start aus und prüfe die Logs aller Dienste.
8. Prüfe nach Möglichkeit sowohl Docker Compose als auch den Root-Turborepo-Dev-Start.

---

## Abschlussprüfung

Der Fix ist nur abgeschlossen, wenn alle Punkte erfüllt sind:

```bash
docker compose down -v
docker compose up --build
```

Erwartetes Ergebnis:

- PostgreSQL ist erreichbar.
- Redis ist erreichbar.
- Prisma-Migrationen werden auf einer leeren Datenbank erfolgreich angewendet.
- API startet mit lokaler Authentifizierung, sofern keine abweichende sichere Konfiguration gesetzt ist.
- API-Health- und Readiness-Endpunkt antworten erfolgreich.
- Ein initialer lokaler Admin wird bei leerer Datenbank genau einmal angelegt.
- Der lokale Admin kann sich über `POST /auth/local/login` erfolgreich anmelden.
- Worker startet ohne DI-Fehler und verarbeitet einen Testjob.
- Web startet ohne Berechtigungsfehler und ist erreichbar.
- HMR funktioniert über die konfigurierte Entwicklungsadresse.
- Keine Service-Restart-Schleife.
- Der Monorepo-Dev-Start bleibt aktiv und beendet sich nicht mit fehlgeschlagenen Tasks.
- Die Turborepo-Dev-Konfiguration verwendet kein `--parallel`.

Führe außerdem mindestens diese Prüfungen aus, angepasst an die tatsächlichen Ports und Endpunkte des Projekts:

```bash
curl -fsS http://localhost:<API_PORT>/health
curl -fsS http://localhost:<API_PORT>/ready

curl -fsS -X POST http://localhost:<API_PORT>/auth/local/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<LOCAL_ADMIN_EMAIL>","password":"<LOCAL_ADMIN_PASSWORD>"}'
```

Prüfe zusätzlich:

- Dass die Datenbank nur einen passenden Initial-Admin enthält.
- Dass der gespeicherte Passwortwert gehasht ist.
- Dass beim zweiten Start kein weiterer Admin angelegt wird.
- Dass sensible `.env`-Dateien nicht durch Git getrackt werden.
- Dass keine Passwörter oder Tokens in den Logs auftauchen.

---

## Abschlusslieferung

Liefere zum Schluss:

1. Eine Liste aller geänderten Dateien.
2. Eine knappe Erklärung je Änderung.
3. Die ausgeführten Validierungsbefehle mit Ergebnis.
4. Die verwendete lokale Auth-Konfiguration ohne Preisgabe des Passwortwerts.
5. Verbleibende Warnungen, klar getrennt von echten Fehlern.
6. Hinweise auf notwendige manuelle Schritte, falls lokale `.env`-Werte angelegt oder geändert werden müssen.
