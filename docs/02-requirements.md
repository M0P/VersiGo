# Anforderungen

## Funktionale Anforderungen

### Pflicht
- Nutzer können Versicherungen anlegen, bearbeiten, archivieren und löschen.
- Pro Versicherung können Stammdaten, Vertragsdaten, Zahlweise, Kosten, Laufzeiten, Selbstbeteiligung, versicherte Personen, Versicherer, Tarifname und Kündigungsfristen gepflegt werden.
- Pro Versicherung können Dokumente gespeichert oder referenziert werden.
- Pro Versicherung existiert mindestens ein Portal-Link.
- Kostenhistorien können jahresbezogen und mit Gültigkeitszeitraum gepflegt werden.
- Das System berechnet Gesamtkosten pro Vertrag und aggregiert pro Haushalt, Person, Versicherungsart und Jahr.
- Benutzerverwaltung mit Rollen ist vorhanden (globale Rollen `READ_ONLY`/`USER`/`ADMIN`).
- Familienfunktion erlaubt Freigaben auf Verträge und Dokumente zwischen Benutzern.
- Lokale Registrierung mit Benutzername/Passwort; neue Konten bleiben bis zur Admin-Freischaltung gesperrt.
- Login unterstützt OIDC (optionaler zweiter Login-Weg, gebunden an ein lokales Konto).
- UI unterstützt Light/Dark Mode.
- Einstellungen erfolgen primär über Admin-UI.
- Vollständige Auditierbarkeit relevanter Änderungen.

### Optional
- AI-Extraktion von Eckdaten aus hochgeladenen Verträgen.
- AI-Zusammenfassung von Leistungen je Versicherung.
- Mehrere AI-Provider: Ollama, OpenAI-kompatible APIs.
- Verknüpfung zu Paperless-ngx über API.
- Abruf von Versicherungsportal-Postfächern, falls technisch und rechtlich pro Anbieter möglich.

## Nichtfunktionale Anforderungen
- Docker-Compose-fähig.
- Moderne Web-UI.
- Modularer Aufbau in vertikalen Features.
- Feature-Degradation statt Gesamtausfall bei fehlenden Integrationen.
- Datenbankmigrationen ohne manuelle Eingriffe.
- Bibliotheken nur bei aktivem Maintenance-Status oder LTS; letzte Release jünger als 12 Monate.
- Mehrsprachigkeit vorbereitbar, initial Deutsch.

## Abgrenzung
- Keine Beitragsoptimierung oder Tarifberatung als Kernfunktion.
- Kein generischer Passwort-Manager.
- Kein vollautomatisierter Portalabruf als zugesicherte Standardfunktion.
