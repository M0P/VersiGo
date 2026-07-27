# Sicherheit und Datenschutz

## Grundsätze
- Datenschutzfreundliche Voreinstellungen.
- Verschlüsselung ruhender Dateien optional, für produktiven Einsatz empfohlen.
- TLS-Termination via Reverse Proxy außerhalb oder vor dem Stack.
- Least-Privilege für Rollen und Freigaben.

## Zugriffsschutz
- OIDC Login
- Lokale Fallback-Admin-Anmeldung nur für Bootstrap optional und standardmäßig deaktiviert
- CSRF-Schutz, sichere Cookies, Session Rotation
- Mandantentrennung auf Household-Ebene plus objektbezogene Freigaben

## Datenschutz
- AI-Nutzung nur nach expliziter Aktivierung.
- Dokumente können von AI-Verarbeitung ausgeschlossen werden.
- Export- und Löschfunktionen für personenbezogene Daten.
- Vollständiges Audit für Zugriff auf sensible Dokumente.

## Secrets
- Nur technische Bootstrap-Secrets in Docker-Umgebung.
- API-Keys im verschlüsselten Settings-Store in der Datenbank.
- Rotation über Admin-UI.
