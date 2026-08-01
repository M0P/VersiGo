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

### Umsetzungsstand (AP-18)
- **Portal-Katalog** (`apps/api/src/features/portal-connectors/portal-catalog.ts`):
  Versionierter Katalog (`PORTAL_CATALOG_VERSION`) mit je Anbieter `providerKey`,
  `displayName`, Deeplink-Vorlage (Vorlage ohne Platzhalter oder manuelle URL)
  und Zugangshinweis (`accessHint`). Derzeit enthaltene Anbieter:
  HUK-COBURG, HUK24, Allianz, AXA, ERGO, Generali, DEVK, Signal Iduna, VGH,
  Wüstenrot, VKB und CosmosDirekt.
- **Deep-Link-Auflösung:** Reihenfolge manueller `portalUrl` > Katalog-Vorlage.
  Nur manuelle `http(s)`-URLs haben Vorrang; andere Schemata (z. B.
  `javascript:`, `data:`) und unparsbare Werte werden verworfen und fallen
  auf die Katalog-Vorlage zurück (dasselbe gilt für die Ausgabe der
  `portalUrl` – der Client erhält nie ein Nicht-`http(s)`-Link-Ziel).
  Die Katalog-Vorlage kann optional `{contractNumber}` enthalten; die
  Vertragsnummer wird dabei URL-encodiert eingesetzt. Ohne bestimmbaren
  Deeplink liefert die API `deepLinkUrl: null`, ohne den Link zu brechen.
- **Plugin-Rahmen:** `PortalConnectorPlugin`-Interface + `PortalConnectorRegistry`.
  Der Mailbox-/Dokumentenabruf ist als experimentelles, **deaktiviertes** Plugin
  (`mailbox-sync-browser-automation`) registriert. Health-Endpunkte
  (`GET /portal-connectors/plugins/:key/health`) degradieren kontrolliert
  (`available: false`) statt Fehler zu werfen.
- **REST-API:** `GET /portal-connectors/catalog`, `GET /portal-connectors/catalog/:providerKey`,
  `GET /portal-connectors/plugins`, `GET /portal-connectors/plugins/:key/health`
  – jeweils für alle authentifizierten Rollen lesbar.
- **Portal-Links pro Vertrag:** Verwaltung über das Policy-Registry-Slice
  (`PortalAccountLink`, inkl. optionalem `connectorKey`, `accessHint` und
  verschlüsselten Zugangsdaten).

## OIDC
Unterstützte Modi:
- Externer Issuer via Discovery
- OIDC ist ein zweiter Login-Weg, der an ein bestehendes lokales Konto gebunden ist (`(oidcIssuer, oidcSubject)` auf `users`, AP-16/ADR-007)
- Kein Account-/Rollen-Provisioning aus Claims: Bindung setzt ein Admin (`POST /admin/users/:id/oidc-binding`), fehlgeschlagene Logins liefern generische Fehler
