# Nächster Agent: AP-15-docker-compose-delivery-baseline

Die Reihenfolge ist **verbindlich und bewusst nicht numerisch**: zuerst AP-15, danach AP-14. Anschließend geht es bewusst mit AP-11 weiter und danach in regulär aufsteigender Nummerierung (AP-12, AP-13, AP-16, AP-17, …; bereits erledigte oder nicht vorhandene Arbeitspakete werden übersprungen). AP-15 ist ein **Enabler- und Migrations-Work-Package**: Es implementiert nicht nur Compose, sondern stellt den verbindlichen Entwicklungs-, Test- und CI-Standard des Repositories dauerhaft auf Docker Compose um.

---

```text
Du implementierst AP-15 im Projekt Insura.

## Work Package: AP-15-docker-compose-delivery-baseline

### Ziel

Mache Insura aus einem frischen Clone reproduzierbar per Docker Compose ausführbar und verlege das vollständige Testsystem auf Docker bzw. Docker Compose. Nach Abschluss dieses Arbeitspakets dürfen lokale Host-/Distrobox-Node-, pnpm-, PostgreSQL- oder Redis-Prozesse weder für die reguläre Verifikation noch für CI erforderlich sein.

Der verbindliche Sollzustand nach AP-15 ist:

- `docker compose up --build` startet einen nutzbaren, vollständigen Stack.
- Alle vorgesehenen Prüfungen (Formatierung, Lint, Typecheck, Unit-, Integrations-, E2E-/Smoke-Tests, Prisma-Generierung und Migrationsprüfung sowie Production Build) werden reproduzierbar **in Docker-Containern über Compose** ausgeführt.
- Die CI verwendet dieselben containerisierten Test-Einstiegspunkte; sie darf nicht auf separat auf dem Runner installierte Node/pnpm-Tools oder als GitHub-Service-Container außerhalb des Compose-Stacks angewiesen sein.
- Docker-lose Umgebungen bleiben nur ein klar dokumentierter, nicht gleichwertiger Fallback zum Lesen/Ändern von Dateien; sie sind kein Freigabe- oder Merge-Pfad.
- Jeder künftige Feature-Slice erweitert bei Bedarf im selben PR Compose, Test-Compose, Konfiguration, Dokumentation und Smoke-Test und lässt den Docker-Compose-Testpfad grün zurück.

### Verbindliche Quellen und Hierarchie

Lies **vor jeder Planung und Änderung vollständig** die folgenden Dateien sowie alle durch sie referenzierten ADRs und Dokumente. Die Vorgaben sind kumulativ; bei Widerspruch gilt die speziellere Sicherheits-/ADR-/Architekturvorgabe. Widersprüche, insbesondere die derzeit veralteten Hinweise auf „kein Docker“ in `AGENTS.md`, werden in diesem AP bewusst und dokumentiert zugunsten des neuen Docker-Standards aufgelöst.

- `/AGENTS.md`
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dateien unter `/docs`, insbesondere `01-product-vision.md`, `02-requirements.md`, `03-architecture.md`, `04-data-model.md`, `05-feature-slices.md`, `06-integrations.md`, `07-security-privacy.md`, `08-admin-operations.md`, `10-quality-and-library-policy.md`, `11-ui-ux.md`, `12-roadmap.md` und alle ADRs
- `/dependency-policy.md`
- `/README.md`, `/PR_DESCRIPTION.md`, `.env.example`
- Bestehende `Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml`, Skripte, Package-Skripte, Prisma-Schema/Migrationen, Web/API/Worker-Entrypoints und Health-Endpunkte
- `.github/workflows/ci.yml`, `.opencode/agents/*` und jede weitere Contributor-/Agenten-Guidance
- Alle bestehenden Prompts und Reviews, soweit sie verbindliche Projektkonventionen, Akzeptanzkriterien oder offene Architekturentscheidungen enthalten

Beachte dabei ausnahmslos:

- Modularer Monolith mit vertikal geschnittenen Features; keine fachliche Shared-Domain-Sammelstelle und keine unnötige Änderung fremder Fachlogik.
- Feature-Degradation statt Gesamtausfall für optionale Integrationen.
- PostgreSQL, Redis/BullMQ, Prisma, Next.js, NestJS und bestehende Sicherheits-, Session-, Household-Isolation-, Audit-, Verschlüsselungs- und Capability-Flag-Konventionen bleiben kompatibel.
- Least Privilege, keine Secrets in Code/Images/Logs/Tests/Screenshots, keine unnötig veröffentlichten internen Ports, sichere Konfigurationsvalidierung, sichere Cookies/Proxy- und CORS-Konfiguration.
- Keine neue Abhängigkeit ohne vorherige, dokumentierte Maintenance-Prüfung gemäß `docs/10-quality-and-library-policy.md` und `dependency-policy.md`; aktualisiere die Policy im selben PR.
- Keine Abschwächung, Löschung oder Umgehung bestehender Tests, Sicherheitsgrenzen oder Qualitäts-Gates.

Arbeite in einem neuen Branch `feat/AP-15-docker-compose-delivery-baseline` auf Basis des aktuellen `main`. Direkte Commits auf `main` und Selbst-Merge sind verboten.

### Nicht verhandelbare Compliance-Gates

AP-15 gilt **nicht** als umgesetzt, wenn auch nur eine der folgenden Bedingungen offen bleibt. Diese Gates haben Vorrang vor Zeitersparnis, Minimal-Diffs und der Versuchung, Dokumentation später nachzuziehen:

1. **Repositoryweite Regel-Inventur vor Code:** Erstelle vor der Implementierung eine überprüfbare Regelmatrix für jede Datei in `/docs`, `/docs/adr`, `/prompts`, `AGENTS.md`, `README.md`, `dependency-policy.md`, `.github`, `.opencode`, `PR_DESCRIPTION.md`, Docker-/Compose-Dateien, Package-/Workspace-Konfigurationen, Prisma-Dateien und Skripten. Erfasse pro Regel: Quelle, exakte Anforderung, Auswirkung auf AP-15, Umsetzung/Nichtbetroffenheit und Nachweis. Lies auch nicht offensichtlich Docker-bezogene Regeln; Security, Mandantentrennung, optionale Integrationen, Qualitäts- und Dependency-Policy gelten weiterhin.
2. **Keine stillschweigende Abweichung:** Ist eine Regel technisch unvereinbar, unklar oder veraltet, stoppe vor der Implementierung und benenne sie in der ersten Planungsantwort als Konflikt samt vorgeschlagener ADR-/Dokumentationsauflösung. Überschreibe keine ADR, Security-Regel, Architekturgrenze oder Akzeptanzbedingung ohne ausdrücklich dokumentierte Entscheidung.
3. **Ein kanonischer Testvertrag:** Nach AP-15 gibt es genau einen dokumentierten kanonischen Compose-Testbefehl bzw. ein einziges kanonisches Repository-Skript als Einstiegspunkt. Dieser führt sämtliche verpflichtenden Prüfschritte in Containern aus; Teilbefehle dürfen ihn intern verwenden, dürfen den Gesamtvertrag aber nicht umgehen.
4. **Containergrenze:** Node, pnpm, Prisma, Test-Runner, Application Build, PostgreSQL und Redis laufen bei jeder verbindlichen Testausführung in Containern. Auf dem Host dürfen nur Docker/Compose und Hilfen zum Aufruf, zur Konfigurationsvalidierung, zum Warten, Log-Sammeln und Cleanup laufen. Ein Docker-Container, der Host-Daemons, Host-Node-Modules, Host-Datenbanken oder Host-Ports als Testvoraussetzung nutzt, erfüllt das Gate nicht.
5. **Frischstart-Nachweis:** Die finale Verifikation beginnt mit einer dokumentierten Bereinigung der ausschließlich Insura zugeordneten Container, Netzwerke, Testvolumes und Build-Artefakte. Danach werden Images gebaut, Testdienste gestartet, Migrationen angewendet, alle Checks ausgeführt und der Laufzeitstack per `docker compose up --build` gesmokt. Bestehende, nicht zu Insura gehörende Docker-Ressourcen dürfen nicht gelöscht werden.
6. **Dokumentationsschluss erst nach Erfolg:** Erst wenn die vollständige containerisierte Verifikation erfolgreich ist, aktualisiere die Rahmendokumente. Anschließend führe mindestens den kanonischen Compose-Testvertrag noch einmal aus, damit Dokumentations-/Script-Änderungen mitgetestet sind. Der finale PR enthält keinen aktiven, widersprüchlichen oder gleichwertig empfohlenen Host-/Distrobox-Testweg.
7. **Zukunftsgarantie durch Gates:** Der Compose-Testvertrag ist als CI-Pflichtcheck eingerichtet. Die zentrale Agenten-/Prompt-Guidance schreibt vor, dass jeder künftige Slice vor PR, Review und Merge diesen Vertrag nach der Main-Integration ausführen muss. Neue Infrastruktur ohne gleichzeitige Compose-, Test-, CI-, `.env.example`- und Dokumentationsänderung ist ein Blocker.

### Pflichtumfang

#### 1. Vollständiger Laufzeit-Stack

Implementiere/repariere den Compose-Stack für Web, API, Worker, PostgreSQL, Redis und ausschließlich tatsächlich erforderliche optionale Dienste.

- Verwende explizite Netzwerke, benannte Volumes, restriktive Port-Freigaben, sinnvolle Restart-Policies, Container-Health-Checks und dependency conditions auf echte Readiness.
- Dienste kommunizieren über Compose-Service-DNS und interne URLs, nicht über `localhost`- oder Host-Annahmen.
- Baue schlanke, reproduzierbare Multi-Stage-Images. Führe Laufzeitprozesse, soweit technisch möglich, nicht als root aus. Nutze feste/prüfbare Image-Versionen entsprechend der Dependency Policy.
- Konfiguriere Datenbankmigrationen idempotent und vor der funktionalen Bereitschaft von API/Worker. Kein Dienst darf erfolgreich „ready“ sein, wenn das erforderliche Schema fehlt.
- Behandle First Start, Wiederanlauf und persistente Daten robust. Lokale Upload-/Dokumentdaten verwenden, sofern bereits implementiert, ein benanntes Volume mit korrekten Ownership-/Rechte-Einstellungen.
- Optionales MinIO/S3 und optionale Integrationen bleiben optional; fehlende Konfiguration deaktiviert nur die jeweilige Teilfunktion.
- `docker compose up --build` muss mit dokumentierter, nicht geheimer Entwicklungsumgebung ohne externen OIDC-Provider nutzbar sein, soweit die bestehende Authentifizierung dies erlaubt. Es dürfen keine Produktions- oder Default-Credentials stillschweigend entstehen.

#### 2. Docker-Compose-Testsystem

Schaffe einen dedizierten, wiederholbaren Compose-Testpfad, beispielsweise über ein separates Compose-File, Profile oder klar benannte Test-Services. Er muss vom Laufzeitstack sauber getrennt sein, darf aber dieselben Images und Konfigurationsbausteine wiederverwenden.

- Stelle einen einzigen dokumentierten Einstiegspunkt bereit, z. B. `docker compose ... run --rm test` oder ein äquivalentes Repository-Skript, der **innerhalb von Docker Compose** alle verfügbaren Qualitätsprüfungen ausführt.
- Der Test-Container installiert Abhängigkeiten reproduzierbar mit eingefrorenem Lockfile, generiert Prisma Client, wendet Testmigrationen an und führt Tests gegen dedizierte Compose-Testdienste aus.
- Tests verwenden niemals Produktionsvolumes oder Produktionsdaten. Test-Datenbank, Test-Redis, Netzwerk, Namen und Cleanup sind eindeutig isoliert.
- Der Testpfad umfasst mindestens Formatierung/Format-Check, Lint, Typecheck, Unit-Tests, API-Integrationstests, Worker-Tests, Prisma-Generate, Prisma-Migrationsprüfung und Production Build, soweit diese Checks im Repository existieren. Ergänze sinnvolle fehlende Scripts nur, wenn sie echte vorhandene Qualitätsanforderungen abbilden.
- Ergänze einen browser-/HTTP-nahen Smoke-Test gegen den gestarteten Compose-Stack: Warte auf Health/Readiness statt Sleep, prüfe Web-Verfügbarkeit, API-Health und mindestens einen Request mit Datenbank-/Redis-Abhängigkeit. Protokolliere bei Fehlern Diagnoselogs und fahre den Stack zuverlässig herunter.
- Ersetze Host- und Distrobox-Testbefehle in der verbindlichen Guidance durch die neuen Docker-Compose-Befehle. Docker darf nicht nur ein zusätzlicher optionaler Smoke-Test sein.
- Ein lokales Compose-Override darf Entwicklerkomfort liefern, darf aber Produktions- und Test-Defaults nicht unsicher machen und keine Pflicht für freigegebene Tests auf dem Host erzeugen.

#### 3. CI vollständig auf Compose umstellen

Stelle `.github/workflows/ci.yml` auf den Docker-Compose-Testpfad um.

- CI baut die erforderlichen Images und führt sämtliche Qualitätsprüfungen über den identischen Compose-Einstiegspunkt aus.
- Entferne die Abhängigkeit der CI von GitHub-`services` für PostgreSQL/Redis sowie von auf dem Runner ausgeführtem pnpm/Node für Projektprüfungen, wenn Compose diese Dienste bereitstellt.
- Runner-Tools dürfen ausschließlich Docker/Compose starten und Ausgaben einsammeln; die Projekt-Runtime und Testausführung liegen in Containern.
- Validiere Compose-Konfiguration vor dem Start, verwende Health-basierte Wartebedingungen, sichere Cleanup auch bei Fehlern und lade/zeige relevante Containerlogs bei Fehlschlägen.
- Nutze ausschließlich nicht-sensitive CI-Testwerte; echte Secrets werden weder benötigt noch ausgegeben.

#### 4. Rahmenwerk verbindlich migrieren

Nach erfolgreicher Implementierung **und erst nach bestandenem vollständigem Docker-Compose-Testlauf** schreibe alle betroffenen Rahmendokumente und Agentenanweisungen um. Sie müssen den Docker-Compose-Standard klar, konsistent und ohne widersprüchliche Altanweisungen festlegen.

Mindestens zu prüfen und bei Betroffenheit zu aktualisieren:

- `AGENTS.md`: Docker Compose als primäre und verbindliche Entwicklungs-, Prüf- und Verifikationsumgebung; ersetze die Aussage „Es gibt kein Docker“ und die Distrobox-only-Befehle. Falls der Fallback `scripts/dev-services.sh` erhalten bleibt, kennzeichne ihn ausdrücklich als nicht für CI, Freigabe oder vollständige Testverifikation zulässig.
- `prompts/00-gemeinsame-regeln.md`: Jede Änderung muss passende Tests über den standardisierten Docker-Compose-Testpfad ausführen; der finale Test vor PR/Review und nach Main-Integration erfolgt ausschließlich über Compose.
- `README.md`: Voraussetzungen, sichere Erstinstallation, `.env`-Einrichtung, Start, URLs, Logs, Stop, Reset, Update, vollständige Tests, Smoke-Test und Fehlerdiagnose mit exakten Compose-Kommandos.
- `docs/03-architecture.md`: tatsächliche Service-Topologie, Netzwerke, Persistenz, Startup-/Migrations- und Readiness-Reihenfolge sowie Testarchitektur.
- `docs/07-security-privacy.md`: Secrets-/Environment-Handling, Port- und Netzwerkexposition, Container-Privilegien, Testdatenisolation und Reverse-Proxy/TLS-Grenze.
- `docs/08-admin-operations.md`: Betrieb, Konfigurationsmatrix, Health, Migration, Backup/Restore, Reset, Upgrade, Troubleshooting und sichere Nutzung des Compose-Stacks.
- `docs/10-quality-and-library-policy.md`, `dependency-policy.md`: Container-/Basisimage- und neue Tool-Abhängigkeiten nur soweit erforderlich, inklusive Maintenance-Prüfung.
- `.env.example`, CI-Workflow, relevante Package-Skripte, `PR_DESCRIPTION.md`, Agenten-/Review-Guidance und künftige Prompt-Vorlagen: keine veralteten lokalen Testanweisungen; sie müssen den Compose-Testpfad referenzieren.

Füge an geeigneter zentraler Stelle (mindestens `AGENTS.md` und `prompts/00-gemeinsame-regeln.md`) diese verbindliche Regel sinngemäß und unmissverständlich ein:

> Jeder Feature-Slice muss aus einem frischen Clone mit `docker compose up --build` lauffähig bleiben. Neue Runtime-Abhängigkeiten, Dienste, Umgebungsvariablen, Migrationen, Queues, Volumes, Ports, Health Checks oder Testanforderungen werden im selben Slice in Compose, Compose-Testsystem, `.env.example`, CI und Dokumentation ergänzt. Die vollständige Freigabe-Verifikation erfolgt über Docker Compose.

Aktualisiere `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` **erst nach erfolgreichem Commit** zum Auftrag AP-14. Dieser Folgeprompt muss die Docker-Compose-Regeln und sämtliche untenstehenden Review-Regeln als bereits verbindlichen Projektstandard übernehmen und darf keine Host-/Distrobox-Testschritte mehr verlangen.

### Verbindliche Code-Review-Regeln

Der Review ist ein unabhängiges, verpflichtendes Merge-Gate und keine Selbstprüfung. Diese Regeln ergänzen `AGENTS.md`, `prompts/00-gemeinsame-regeln.md`, `.opencode/agents/coding-agent.md`, `.opencode/agents/code-reviewer.md` und `prompts/PR-REVIEW.md`; die strengere Regel gilt.

- Ausschließlich der konfigurierte, **read-only** `@code-reviewer`-Subagent darf den Code Review durchführen. Der Implementierungsagent darf den Review weder selbst ausführen noch simulieren, ersetzen, zusammenfassen oder als bestanden erklären.
- Kann `@code-reviewer` nicht erfolgreich über das Task-Tool aufgerufen werden, stoppe unverzüglich. Implementiere keine vermeintlichen Review-Fixes, committe nicht und melde exakt: `REVIEW AUTOMATION FAILED: DeepSeek code-reviewer could not be invoked.`
- Der Reviewer prüft den vollständigen aktuellen uncommitted Diff und relevante Umgebung gegen: AP-15, die komplette Regelmatrix, alle Repository-Regeln/ADRs, Sicherheits- und Datenschutzvorgaben, Architektur-/Feature-Grenzen, Compose-Laufzeit- und Testarchitektur, CI, Tests, Migrationssicherheit, Dokumentation, Konfigurationsvalidierung, Wartbarkeit und Regressionsrisiken.
- Der Reviewer muss insbesondere validieren, dass der kanonische Compose-Testvertrag vollständig containerisiert ist, keine Host-Runtime/-Datenbank/-Redis-Abhängigkeit verwendet, Testdaten isoliert, der CI-Pfad identisch ist und alle umgeschriebenen Rahmendokumente widerspruchsfrei auf Compose verweisen.
- Der Reviewer darf keine Dateien ändern, keine Code-Fixes schreiben und keine mutierenden Repository-Befehle ausführen. Findings müssen belegbar, durch den aktuellen Scope verursacht oder unmittelbar relevant und mit Dateipfad sowie Zeile dokumentiert sein; hypothetische Findings ohne Repository-Evidenz sind unzulässig.
- Speichere jedes vollständige Review-Ergebnis **wortgetreu und ohne redaktionelle Änderung** unter `docs/reviews/AP-15-review-<iteration>.md`. Der erste Lauf ist `AP-15-review-1.md`; jede Nachprüfung erhält eine fortlaufende Nummer. Das Review-Dokument gehört zum AP-15-Diff.
- Befundschwere: Critical = Datenverlust, RCE, Auth-Bypass, gravierendes Security-Leak oder Produktionsausfall; High = schwere Fehlfunktion, schwerer Security-Fehler, kaputte Kernfunktion oder wahrscheinliche große Regression; Medium = relevanter Defekt, fehlende wichtige Validierung, unzuverlässiger Randfall oder wesentliche Wartbarkeitslücke; Minor = geringer Robustheits-, Klarheits-, Stil-, Benennungs-, Dokumentations- oder nicht blockierender Testmangel.
- Behebe jeden Critical-, High- und Medium-Befund. Minors werden behoben, wenn dies sicher und ohne Scope-Ausweitung möglich ist. Nach jeder Änderung führe die betroffenen Compose-Checks erneut aus und fordere einen neuen unabhängigen Review an.
- Die maximale Zahl vollständiger Review-Runden beträgt fünf. Nach fünf Runden ohne Akzeptanz: nicht committen, alle verbleibenden Findings und Gründe offen berichten und auf Entscheidung des Nutzers warten.
- Akzeptanz besteht nur bei 0 Critical, 0 High, 0 Medium und höchstens 8 Minor **sowie** vollständig bestandenem kanonischem Compose-Testvertrag und Compose-Smoke-Test nach Integration des aktuellen `main`. Ein PASS des Reviewers allein ersetzt keine technischen Tests; grüne technische Tests ersetzen keinen unabhängigen PASS.
- Das finale Review muss die zuletzt getestete Revision abdecken. Jede nach dem PASS vorgenommene Code-, Konfigurations-, Infrastruktur-, CI-, Dokumentations- oder Script-Änderung verlangt erneut mindestens die betroffenen Compose-Tests und einen neuen Review.
- Ein Modell darf den eigenen PR weder freigeben noch mergen. Commit, PR und unabhängiger Review sind getrennte Rollen; Merge erfolgt ausschließlich durch einen Menschen oder separaten Reviewer nach grüner Compose-CI.

### Nicht-Ziele

- Kein Kubernetes, Terraform, Cloud-Vendor-Deployment, Registry-Publishing, Monitoring-Produkt oder spekulative Infrastruktur ohne explizite bestehende Anforderung.
- Kein Wechsel von Facharchitektur, Runtime, ORM, Datenbank, Queue oder Authentifizierungsmodell allein für Compose.
- Keine Produktion von echten Credentials, kein Commit von `.env`-Dateien mit Secrets und keine Lockerung von Sicherheitsmaßnahmen für Bequemlichkeit.

### Verbindlicher Ablauf

1. Prüfe alle oben genannten Quellen und liefere **zunächst ausschließlich**: die vollständige Regelmatrix, Ziel, Constraint-/Widerspruchsanalyse, technische Lösung, Architekturentscheidung, betroffene Dateien, neue/geänderte Abhängigkeiten inklusive Maintenance-Prüfung, Risiken sowie Test-, Migrations-, Clean-Start- und Dokumentationsmigrationsplan. Ohne Regelmatrix und explizite Konfliktauflösung keine Implementierung.
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere ausschließlich AP-15 als vertikalen Slice. Halte die Änderungen klein, nachvollziehbar und kompatibel zu den bestehenden Feature-Grenzen.
4. Führe während der Arbeit die passenden containerisierten Teilprüfungen aus. Verwende für keine Freigabeprüfung direkte Host-pnpm-, Host-Node-, Host-PostgreSQL- oder Host-Redis-Kommandos.
5. Führe nach der Dokumentationsmigration aus sauberem Zustand den vollständigen Compose-Testpfad, den Build und den Compose-Laufzeit-Smoke-Test aus. Verwende keine vorbestehenden Images, Container, Netzwerke, Volumes oder Datenbanken als stillschweigende Voraussetzung.
6. Integriere unmittelbar vor dem finalen Testlauf den aktuellen `main` in den Arbeitsbranch und wiederhole danach die vollständige Docker-Compose-Verifikation.
7. Führe den vollständigen Review-Loop gemäß Abschnitt „Verbindliche Code-Review-Regeln“ aus: Implementierung → kanonische Compose-Checks → unabhängiger `@code-reviewer` → wortgetreues Review-Artefakt → alle blockierenden Findings beheben → erneut containerisiert prüfen und reviewen. Akzeptanz: 0 Critical, 0 High, 0 Medium, höchstens 8 Minor.
8. Committe erst bei erfüllten Akzeptanzkriterien, öffne einen PR gegen `main` und merge niemals selbst.

### PR

PR-Titel:
`feat(AP-15): docker-compose-delivery-baseline`

Die PR-Beschreibung muss enthalten:

- Zweck, Constraint-/Widerspruchsauflösung und Architekturentscheidung
- Service- und Testtopologie mit Netzwerken, Ports, Volumes, Health Checks, Migrations- und Startup-Reihenfolge
- Liste aller geänderten Dateien und konkret umgeschriebenen Rahmendokumente
- Vollständige, secret-freie Konfigurationsmatrix und lokale Compose-Quick-Start-Anleitung
- Vollständige Regelmatrix als PR-Anhang/PR-Abschnitt: jede gefundene Repository-Regel mit Quelle, Umsetzung/Nichtbetroffenheit und Nachweis; jede Konfliktauflösung mit dokumentierter Entscheidung
- Nachweis jedes Akzeptanzkriteriums einschließlich Nachweis, dass CI und lokale Verifikation denselben kanonischen Compose-Testvertrag verwenden und dass keine Host-Runtime oder Host-Datenbank Testvoraussetzung ist
- Exakte ausgeführte Compose-Befehle sowie Resultate des Clean Starts, vollständigen Testlaufs, Migrationstests und Smoke-Tests
- Neue/geänderte Abhängigkeiten und Basisimages samt Maintenance-Prüfung
- Sicherheits- und Datenschutzbewertung, insbesondere Secrets, Ports, Berechtigungen und Testdatenisolation
- Bekannte Grenzen, bewusst nicht umgesetzte Teilfunktionen und Migrationshinweise für bestehende Entwicklerumgebungen

Merge-Gate:
Ein unabhängiger Reviewer oder Mensch darf erst mergen, wenn der aktuelle `main` integriert ist, die Compose-basierte CI grün ist, alle Akzeptanzkriterien erfüllt sind, der Docker-Compose-Clean-Start und vollständige Testpfad nachweislich erfolgreich waren und der Review-Loop die genannten Schwellen erfüllt. Bei jedem fehlgeschlagenen Check wird im selben Branch nachgebessert und der vollständige relevante Compose-Test erneut ausgeführt.
```

## Kurzregeln für diese Session

1. **Nur AP-15 implementieren.** AP-14 und AP-13 werden nicht begonnen.
2. **Keine Host-/Distrobox-Prüfungen als Ersatz.** Distrobox kann höchstens Docker/Compose bereitstellen, falls dies für die lokale Maschine nötig ist; Projekt-Build, Tests, Migrationen und Smoke-Tests laufen trotzdem in Compose-Containern.
3. **Dokumentationsmigration ist ein Akzeptanzkriterium, keine Nacharbeit.** Veraltete, widersprüchliche „kein Docker“- und Distrobox-only-Anweisungen dürfen nach dem Feature nicht mehr als regulärer Test- oder Freigabepfad bestehen.
4. **Nach erfolgreichem Commit** schreibe diese Datei für AP-14 um. Reihenfolge danach: AP-11, AP-12, AP-13, AP-16, AP-17, …; überspringe bereits erledigte oder nicht vorhandene Arbeitspakete. Der AP-14-Prompt übernimmt den Docker-Compose-Standard und die vollständigen Code-Review-Regeln unverändert als verbindliche Basis.
