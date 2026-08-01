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
- OIDC ist ein zweiter Login-Weg, der an ein bestehendes lokales Konto gebunden ist (`(oidcIssuer, oidcSubject)` auf `users`, AP-16/ADR-007)
- Kein Account-/Rollen-Provisioning aus Claims: Bindung setzt ein Admin (`POST /admin/users/:id/oidc-binding`), fehlgeschlagene Logins liefern generische Fehler
