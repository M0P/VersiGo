# Produktvision

## Zweck
Die Software bietet einem Privathaushalt einen vollständigen Überblick über bestehende Versicherungen, Verträge, Kosten, Dokumente und Zugänge zu Versicherungsportalen.

## Primäre Nutzergruppen
- Einzelperson mit eigenem Versicherungsbestand
- Familienhaushalt mit gemeinsamem Zugriff auf ausgewählte Verträge und Dokumente
- Administrierende Person für Systemkonfiguration

## Kernnutzen
- Zentrale Erfassung aller Versicherungen eines Haushalts
- Einheitliche Sicht auf Vertragsdaten und Dokumente
- Historisierung von Beiträgen und Kostenentwicklung pro Jahr
- Optionale AI-Unterstützung für Datenextraktion und Leistungszusammenfassungen
- Verlinkung zu Versicherungsportalen
- Geringe Betriebs-Komplexität durch Docker-Compose-Deployment und Admin-UI

## Produktprinzipien
- Offline-nahe Kernfunktionen ohne externe AI nutzbar
- Erweiterungen optional und sauber deaktivierbar
- Datenschutz zuerst
- Familien- und Freigabekonzept statt globaler Dateneinsicht
- Alle Einstellungen bevorzugt im Admin-Webinterface statt in Umgebungsvariablen
