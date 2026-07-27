# Integrationen

## AI Provider Abstraktion
Ein einheitliches Provider-Interface:
- `extractContractFacts(documentRefs, schema)`
- `summarizeCoverage(policyId, documentRefs, promptProfile)`
- `healthCheck()`

### Provider
- Ollama Adapter, lokal oder remote
- OpenAI-kompatibler Adapter
- Weitere kompatible Endpunkte per Basis-URL und API-Key

### Sicherheitsregeln
- Prompts und Antworten protokollierbar, aber sensible Inhalte konfigurierbar maskiert.
- Provider sind global deaktivierbar.
- Pro Haushalt optional abschaltbar.

## Paperless-ngx
Mögliche Modi:
- Nur Deep-Link zu Dokumenten
- Metadaten-Synchronisation
- Referenzierte Anzeige im Policy-Kontext
- Optionaler Importvorschlag anhand Tags/ASN/Document Type

## Versicherungsportale
Technisch realistisch in Stufen:
- Stufe 1: Manuelle Deeplinks und Zugangshinweise
- Stufe 2: Anbieter-spezifische Dokument- oder Nachrichtenschnittstellen, falls vorhanden
- Stufe 3: Browser-Automation nur als experimentelles Plugin, nicht Kernsystem

## OIDC
Unterstützte Modi:
- Externer Issuer via Discovery
- Claim-Mapping im Admin-UI
- Rollen-/Gruppen-Mapping auf Household- oder Systemrollen
