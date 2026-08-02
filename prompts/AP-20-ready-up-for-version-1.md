# Arbeitspaket AP-20: ready-up-for-version-1

## Ziel

VersiGo wird fachlich, technisch und dokumentarisch für eine erste geschlossene Beta-Version vorbereitet. Der Fokus liegt auf einem deutlich schnelleren und reproduzierbaren Produktionsbuild, reduziertem Ressourcenbedarf, vollständiger UI-Bedienbarkeit, belastbarer Release-Verifikation sowie einer vollständigen und sicherheitsbewussten GitHub-Dokumentation.

Die Anwendung bleibt ausdrücklich ein experimentelles, vollständig AI-erstelltes Projekt. Sie ist nicht für einen Betrieb in einer aus dem Internet erreichbaren Umgebung vorgesehen.

## Prompt für das Umsetzungsmodell

```text
Du implementierst AP-20 im Projekt VersiGo.

Verbindliche Referenzen:
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur-ADRs, Sicherheit, Betrieb, Datenschutz, UI/UX und Bibliothekspolitik
- Bestehende CI-Workflows, Dockerfiles, Compose-Dateien, Skripte, Umgebungsvariablen und die tatsächliche Implementierung aller Feature-Slices

Arbeite in einem neuen Branch `feat/AP-20-ready-up-for-version-1` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
Bereite VersiGo umfassend auf eine erste Beta-Version vor. Betrachte dazu das gesamte Repository, nicht nur einzelne Features. Räume technische Altlasten auf, schließe erkennbare Bedienungs- und Dokumentationslücken und etabliere nachvollziehbare Beta-Release-Gates.

Es handelt sich nicht um eine kosmetische Dokumentationsänderung: Alle bestehenden fachlichen Funktionen, Betriebsfunktionen, Einstellungen und UI-Aktionen müssen auf ihre tatsächliche Verfügbarkeit, Erreichbarkeit, Berechtigung, Fehlerbehandlung und Testabdeckung geprüft werden.

Scope:

1. Produktionsbuild und Build-Performance
- Ermittle und dokumentiere eine nachvollziehbare Baseline für den aktuellen Produktionsbuild: verwendeter Befehl, Umgebung, Dauer, Image-Größen, auffällige langsame Schritte und mögliche Cache-Verluste.
- Optimiere den Produktionsbuild so, dass ein sauberer Build deutlich schneller als die bisher beobachteten bis zu 40 Minuten ist. Als Beta-Ziel gilt: Ein vollständiger sauberer Produktionsbuild einschließlich Image-Erstellung soll in der referenzierten CI-/Docker-Umgebung höchstens 15 Minuten dauern. Falls dies aufgrund reproduzierbar nachgewiesener Plattformgrenzen nicht erreichbar ist, dokumentiere die Ursache, die Messwerte und die verbleibende Abweichung explizit im PR und in der Betriebsdokumentation.
- Nutze effiziente, reproduzierbare Multi-Stage-Docker-Builds. Entwicklungswerkzeuge, Testwerkzeuge, Quellcode, Package-Manager-Caches und nicht benötigte Build-Artefakte dürfen nicht im Runtime-Image landen.
- Prüfe und verbessere `.dockerignore`, Build-Kontexte, Layer-Reihenfolge, pnpm-/Corepack-Caching, Turbo-Cache-Strategie sowie die Wiederverwendbarkeit unveränderter Abhängigkeitslayer.
- Prüfe, ob einzelne Services oder Workspace-Pakete unnötig gebaut, kopiert oder zur Runtime ausgeliefert werden. Entferne ausschließlich nachweislich nicht benötigte Artefakte.
- Produktionsimages müssen ohne Entwicklungsabhängigkeiten starten können und weiterhin die erforderlichen Health- und Readiness-Checks erfüllen.
- Stelle sicher, dass der Produktionsbuild ohne unkontrollierte Netzwerkzugriffe zur Laufzeit auskommt. Buildzeit-Abhängigkeiten müssen durch Lockfile und vorhandene Package-Manager-Mechanismen reproduzierbar festgelegt sein.
- Ergänze eine CI-Prüfung oder einen dokumentierten, automatisierbaren Benchmark-Schritt, der Build-Dauer und Image-Größe erfasst. Ein harter zeitbasierter CI-Fehler ist nur zulässig, wenn er auf der vorhandenen CI-Infrastruktur ausreichend stabil ist.

2. Speicher- und Ressourcenoptimierung
- Erfasse vor und nach der Umsetzung die Größe der Produktionsimages sowie relevante Speicherverbräuche im Laufzeitstack.
- Reduziere Image-Größen, unnötige Laufzeitdateien, überflüssige Artefakte, redundante Abhängigkeiten und unnötige Container-Ressourcen, ohne Funktionalität oder Diagnosefähigkeit zu beeinträchtigen.
- Prüfe insbesondere API, Worker, Web, PostgreSQL-, Redis- sowie Upload-/Dateispeicher-Konfiguration auf unnötige Persistenz, unnötige Duplikate und fehlende Aufbewahrungsgrenzen.
- Dokumentiere erforderliche Mindestressourcen und realistische Empfehlungen für eine kleine private Beta-Installation: CPU, RAM, persistenten Speicher, erwarteten Speicherzuwachs durch Uploads sowie Backup-Speicher.
- Es dürfen keine fachlichen Daten, Uploads, Datenbankvolumes oder Logs durch eine Optimierung stillschweigend gelöscht werden. Lösch- oder Bereinigungsmechanismen benötigen eine explizite, dokumentierte und berechtigte Auslösung.

3. Vollständige UI-Bedienbarkeit
- Erstelle ein vollständiges Funktionsinventar aller aktuell implementierten, benutzer- oder administratorrelevanten Funktionen. Berücksichtige UI-Routen, API-Endpunkte, Hintergrundjobs, Einstellungen, Feature-Flags, Integrationen, Datenexporte, Uploads, Löschvorgänge und Systemoperationen.
- Für jede Funktion, die in einer normalen Nutzung oder Administration über die UI steuerbar sein kann, muss eine explizite UI-Steuerungsmöglichkeit existieren. Sie darf nicht ausschließlich über API-Aufrufe, manuelle Datenbankänderungen, Shell-Befehle, Umgebungsvariablen oder versteckte URLs erreichbar sein.
- Erstelle eine nachvollziehbare Control-Matrix in der Dokumentation oder als versionierte Test-/Inventardatei. Sie enthält mindestens: Funktion, Zielrolle, UI-Einstiegspunkt, auslösende Bedienelemente, erwartetes Ergebnis, Berechtigungsprüfung, Fehlermeldung/-zustand und zugehörigen Test.
- Prüfe jede Route und jeden sichtbaren Button, Link, Menüpunkt, Toggle, Dialog, Formular-Submit und jede destruktive Aktion. Sichtbare Bedienelemente dürfen nicht ohne Funktion, ohne Rückmeldung, mit falschem Ziel oder ohne Berechtigungsprüfung ausgeliefert werden.
- Entferne keine bestehende Funktion allein deshalb, weil ihr UI fehlt. Ergänze stattdessen eine angemessene UI-Steuerung oder markiere die Funktion klar als ausschließlich technische, nicht durch Endanwender steuerbare Betriebsfunktion und dokumentiere die Begründung.
- Nicht verfügbare oder nicht konfigurierte Funktionen müssen in der UI verständlich erklärt werden. Buttons dürfen nicht scheinbar erfolgreich sein, wenn eine Konfiguration, Berechtigung oder externe Integration fehlt.
- Destruktive Aktionen wie Löschen, Trennen einer Integration, Widerrufen eines Zugriffs oder Zurücksetzen von Daten benötigen eine eindeutige Bestätigung, verständliche Folgenbeschreibung und eine nachprüfbare Erfolg- oder Fehlerrückmeldung.
- Prüfe die Bedienbarkeit für die vorhandenen Rollen. Nicht berechtigte Nutzer dürfen weder eine wirksame Steuerungsmöglichkeit erhalten noch über manipulierte UI-Anfragen eine Aktion ausführen.
- Ergänze automatisierte Tests für alle kritischen UI-Flows und mindestens einen systematischen Smoke-Test, der die wichtigsten Buttons und Navigationswege pro Rolle abdeckt.

4. Beta-Qualität und Release-Readiness
- Prüfe alle bekannten Feature-Slices auf unvollständige, nicht erreichbare, kaputte oder nur teilweise implementierte Funktionen.
- Stelle sicher, dass Fehlerzustände für API, Worker, Datenbank, Redis, Dateiablage, OIDC/lokale Anmeldung, optionale AI-Funktionen und optionale Integrationen nachvollziehbar angezeigt oder protokolliert werden, ohne Secrets oder personenbezogene Daten offenzulegen.
- Prüfe Start, Neustart, Upgrade, Migration, Backup und Wiederherstellung des Stacks. Ergänze dokumentierte und getestete Verfahren, soweit sie noch fehlen.
- Datenbankmigrationen müssen vor einem Beta-Release auf einer realistischen Bestandsdatenbank testbar und rückwärts nachvollziehbar sein. Ein Downgrade muss nicht automatisiert unterstützt werden, aber das dokumentierte Wiederherstellungsverfahren aus Backup muss vorhanden sein.
- Prüfe Konfiguration und `.env.example` auf Vollständigkeit, sichere Defaults, eindeutige Beschreibungen und fehlende Validierung. Unbekannte, unsichere oder widersprüchliche Konfigurationen müssen beim Start klar fehlschlagen oder sicher ignoriert werden.
- Stelle sicher, dass produktive Betriebsmodi keine unsicheren Development-Defaults aktivieren, insbesondere keinen automatisch angelegten Default-Admin und keine nicht ausdrücklich aktivierte Authentifizierung.
- Führe einen frischen Installations- und Upgrade-Smoke-Test in Docker Compose durch. Der Test muss die dokumentierte Beta-Installation nachvollziehen und mindestens Anmeldung, API-/Web-Health, Datenbankmigration, eine zentrale fachliche Aktion, Upload sofern aktiviert sowie einen Neustart abdecken.
- Erstelle eine Beta-Release-Checkliste mit klaren Go-/No-Go-Kriterien. Sie muss Build, Tests, Sicherheitsprüfung, Dokumentation, Backup, Wiederherstellung, UI-Control-Matrix, offene Risiken und bekannte Grenzen abdecken.
- Erstelle oder aktualisiere eine Changelog-/Release-Notes-Vorlage für Beta-Releases. Sie muss Änderungen, Migrationshinweise, Sicherheitsrelevanz, bekannte Einschränkungen und Upgrade-Schritte enthalten.

5. GitHub- und Betriebsdokumentation
- Überarbeite die Startseite des GitHub-Repositorys vollständig. README und weiterführende Dokumentation müssen den tatsächlichen Funktionsumfang widerspiegeln; keine geplante oder nicht funktionierende Funktion darf als verfügbar dargestellt werden.
- Platziere am Anfang der README vor der Funktionsbeschreibung einen prominenten, nicht übersehbaren Warnhinweis in deutscher Sprache mit mindestens folgendem Sinn:
  „VersiGo wurde vollständig mit AI erstellt. Das Projekt ist experimentell, nicht sicherheitsgeprüft und nicht für einen aus dem Internet erreichbaren Betrieb vorgesehen. Betreiben Sie es ausschließlich in einer vertrauenswürdigen, abgeschotteten privaten Umgebung und verwenden Sie keine produktiven oder besonders schützenswerten Daten ohne eigene Sicherheitsprüfung.“
- Der Warnhinweis darf nicht durch Formulierungen wie „production ready“, „sicher“ oder „öffentlich betreibbar“ relativiert werden.
- Weise sichtbar darauf hin, dass Hilfe, Reviews, Tests, Fehlerberichte, Sicherheitsmeldungen, Dokumentationsverbesserungen und Pull Requests erwünscht sind. Beschreibe einen klaren, niedrigschwelligen Beitragsweg.
- Ergänze oder aktualisiere mindestens: Funktionsübersicht, Architekturüberblick, Voraussetzungen, Schnellstart, lokale Entwicklung, Tests, Konfiguration, lokale Anmeldung, OIDC, Datenablage, Backups, Updates, Fehlerdiagnose, bekannte Grenzen, Sicherheitsmodell und Datenschutzhinweise.
- Dokumentiere alle erforderlichen Umgebungsvariablen mit Zweck, Pflichtstatus, sicherem Beispielwert, Sicherheitsrelevanz und dem Service, der sie nutzt.
- Dokumentiere, welche Dienste Ports öffnen, welche Volumes persistieren und welche Daten jeweils gespeichert werden.
- Dokumentiere explizit, dass AI- und externe Integrationen optional sind, welche Daten sie erhalten können und wie sie deaktiviert werden.
- Überarbeite die Tool-Dokumentation: Docker/Compose, pnpm, Node-Version, Turbo, Prisma, Redis/BullMQ, Test- und CI-Befehle, relevante Skripte und Diagnosebefehle müssen korrekt, aktuell und kurz erklärt sein.
- Ergänze eine strukturierte Troubleshooting-Sektion für häufige Fehler: fehlende Secrets, fehlerhafte Berechtigungen, nicht erreichbare Datenbank/Redis, fehlgeschlagene Migration, Login-Probleme, Upload-Probleme, Build-Fehler und fehlerhafte externe Integrationen.
- Dokumentiere die Beta-Grenzen offen: kein öffentliches Hosting, keine Sicherheitszertifizierung, keine Garantie für Datenverlustfreiheit, keine Support-Zusage und kein Ersatz für eigene Backups.

6. Docker-Image und Bereitstellung
- Erstelle eine vollständige, reproduzierbare Anleitung zum Bau eines Produktions-Docker-Images.
- Die Anleitung muss mindestens abdecken:
  - Voraussetzungen und unterstützte Architektur(en)
  - notwendige Secrets und Umgebungsvariablen
  - Build eines lokal getaggten Images
  - optionaler Multi-Platform-Build mit Docker Buildx, sofern vom Projekt unterstützt
  - Anmeldung an eine Container-Registry
  - Tagging nach Version und optional nach Commit-Revision
  - Push in eine Registry
  - Verifikation des veröffentlichten Images
  - Start des Images beziehungsweise des vollständigen Stacks auf einer Zielplattform
  - Persistente Volumes, Datenbank, Redis, Uploads, Netzwerk und Reverse-Proxy-Grenzen
  - Upgrade, Rollback über vorheriges Image und Wiederherstellung aus Backup
- Wähle keine konkrete Cloud-Plattform als notwendige Referenz. Die Anleitung muss mindestens für eine OCI-kompatible Registry und eine selbstverwaltete Docker-Compose-Zielumgebung funktionieren.
- Wenn eine Beispielplattform dokumentiert wird, kennzeichne sie als Beispiel und stelle klar, dass kein öffentlich erreichbarer Betrieb empfohlen wird.
- Stelle sicher, dass die dokumentierten Image-Tags, Build-Argumente, Ports, Volumes und Befehle mit der tatsächlichen Implementierung übereinstimmen.
- Ergänze, sofern sinnvoll, einen optionalen CI-Workflow für das Bauen und Veröffentlichen von Images. Ein Push darf nur durch explizite Repository- oder Release-Aktion ausgelöst werden, nie durch Pull Requests aus nicht vertrauenswürdigen Quellen. Registry-Secrets dürfen nicht in Logs erscheinen.

7. Sicherheit, Datenschutz und Accessibility
- Führe eine fokussierte Beta-Sicherheitsprüfung durch: Secrets, Authentifizierung, Berechtigungen, Session-Cookies, CORS, Sicherheitsheader, Upload-Validierung, Pfadmanipulation, SSRF-Risiken bei Integrationen, Log-Redaktion, Abhängigkeitsrisiken und Standardkonfiguration.
- Behebe klar erkennbare kritische oder hohe Risiken innerhalb dieses Arbeitspakets. Für nicht im Scope lösbare Risiken erstelle nachvollziehbare, priorisierte Follow-up-Issues oder dokumentierte bekannte Grenzen.
- Prüfe zentrale UI-Flows auf Tastaturbedienbarkeit, sichtbaren Fokus, aussagekräftige Beschriftungen, Fehlermeldungen und ausreichende Kontraste gemäß bestehendem Design-System.
- Es darf keine Telemetrie, kein Tracking und keine Übermittlung von Nutzungsdaten ohne ausdrückliche Dokumentation und Einwilligung ergänzt werden.

Nicht im Scope:
- Öffentliche SaaS-Bereitstellung, Multi-Tenant-Hosting oder Mandantenbetrieb für Dritte.
- Ein Sicherheitszertifikat, Penetrationstest durch externe Dienstleister oder eine Garantie für Compliance.
- Neue große Fachfeatures, die nicht zur Schließung einer konkret identifizierten Beta-Lücke erforderlich sind.
- Vollständige Internationalisierung.
- Eine automatische Rückwärtsmigration der Datenbank.
- Eine Pflicht zur Veröffentlichung von Container-Images in einer öffentlichen Registry.
- Eine Umgehung der bestehenden Architektur-, Sicherheits-, Datenschutz- oder Abhängigkeitspolitik zugunsten kurzfristiger Build-Optimierung.

Akzeptanzkriterien:
- Ein frischer Produktionsbuild ist gemessen und dokumentiert deutlich schneller als die bisherige Referenz von bis zu 40 Minuten; das Ziel von höchstens 15 Minuten ist erreicht oder die belastbar dokumentierte Ausnahme ist im PR sowie in der Betriebsdokumentation begründet.
- Produktionsimages enthalten keine unnötigen Entwicklungswerkzeuge oder Entwicklungsabhängigkeiten und starten im Compose-Produktionspfad erfolgreich.
- Image-Größen und relevante Laufzeitressourcen sind vor und nach der Optimierung dokumentiert; erkennbare, risikoarme Einsparungen sind umgesetzt.
- Für jede identifizierte UI-steuerbare Funktion existiert ein expliziter UI-Einstiegspunkt oder eine dokumentierte und begründete Ausnahme für rein technische Betriebsfunktionen.
- Alle sichtbaren Buttons, Links, Menüpunkte, Formulare, Dialoge und Toggles wurden geprüft; kritische UI-Aktionen besitzen automatisierte Tests und verständliche Erfolgs-/Fehlerrückmeldungen.
- Berechtigungen werden in UI und API konsistent durchgesetzt.
- README beginnt mit einem prominenten Warnhinweis zum vollständig AI-erstellten, experimentellen Charakter und zum Verbot eines öffentlich aus dem Internet erreichbaren Betriebs.
- README und `/docs` enthalten eine korrekte Funktionsübersicht, eine Hilfe-/Beitragsaufforderung, Betriebsanleitungen, Sicherheitsgrenzen, Konfigurationsreferenz, Troubleshooting und bekannte Einschränkungen.
- Eine vollständige Anleitung zum Bauen, Taggen, Pushen und Betreiben eines Docker-Images auf einer OCI-kompatiblen Registry und Docker-Compose-Zielumgebung ist vorhanden und getestet.
- Ein frischer Docker-Compose-Installations-Smoke-Test, ein Upgrade-/Migrationspfad sowie ein Backup-/Wiederherstellungsverfahren sind dokumentiert und soweit technisch möglich automatisiert getestet.
- Eine Beta-Release-Checkliste und Release-Notes-Vorlage sind versioniert vorhanden.
- Alle vorhandenen Qualitätsprüfungen, die vollständige Docker-Compose-Testpipeline, der Produktionsbuild und der Compose-Smoke-Test sind erfolgreich.

Vorgehen:
1. Gib zunächst ausschließlich folgende Inhalte aus:
   - Ziel und Abgrenzung
   - vollständiges erstes Funktions- und Risiko-Inventar
   - technische Lösung und Architekturentscheidungen
   - Messplan für Build-Dauer, Image-Größe und Laufzeitressourcen
   - Konzept für die UI-Control-Matrix
   - Liste betroffener Dateien
   - neue Abhängigkeiten samt Maintenance-Prüfung, oder die explizite Aussage, dass keine neuen Abhängigkeiten erforderlich sind
   - Sicherheits- und Datenschutzrisiken
   - Test-, Migrations-, Backup-/Restore- und Release-Plan
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur dieses Arbeitspaket. Arbeite in kleinen, nachvollziehbaren Schritten und halte Feature-Grenzen ein.
4. Aktualisiere laufend Dokumentation, Control-Matrix und Beta-Release-Checkliste, sobald eine Abweichung zwischen dokumentiertem und tatsächlichem Verhalten gefunden wird.
5. Führe vor dem finalen Testlauf den aktuellen `main` in den Branch ein.
6. Führe mindestens Formatierung, Linting, Typecheck, Unit-Tests, Integrations-/E2E-Tests, vollständigen Docker-Compose-Testlauf, Produktionsbuild, Build-/Image-Messung und Compose-Smoke-Test aus.
7. Verifiziere die neue Docker-Image-Anleitung in einer frischen, dokumentierten Testumgebung.
8. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-20): ready up for version 1`

PR-Beschreibung muss enthalten:
- Ziel, Scope und Architekturentscheidungen
- Vollständige Liste geänderter Dateien
- Funktionsinventar und UI-Control-Matrix oder Verweis auf deren versionierten Speicherort
- Vorher-/Nachher-Messwerte für Produktionsbuild, Image-Größe und relevante Laufzeitressourcen
- Nachweis aller Akzeptanzkriterien
- Ausgeführte Befehle, Umgebung und Ergebnisse
- Nachweis des frischen Installations-, Upgrade-/Migrations-, Backup-/Restore- und Compose-Smoke-Tests
- Neue oder entfernte Abhängigkeiten mit Maintenance-Prüfung
- Sicherheits- und Datenschutzbewertung einschließlich verbleibender Risiken
- Liste dokumentierter bekannter Grenzen und aller bewusst nicht umgesetzten Punkte
- Beta-Release-Checkliste mit eindeutigem Go-/No-Go-Status

Merge-Gate:
Der Pull Request darf nur nach erfolgreich bestandenem Funktionstest, vollständig grüner CI, aktuellem `main` im Branch, erfolgreicher Verifikation der Docker-Image-Anleitung, erfüllter Beta-Release-Checkliste und unabhängigem Review gemergt werden. Ein Modell darf den eigenen Pull Request nicht freigeben oder mergen. Wenn ein Check fehlschlägt, behebe ihn im selben Branch und aktualisiere Messwerte, Dokumentation, Control-Matrix und Pull Request.
```
