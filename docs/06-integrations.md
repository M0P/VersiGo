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

### Umsetzungsstand (AP-22 – tag-basierte Dokumentzuordnung)
- **Konfiguration je Versicherung:** `PolicyPaperlessTag` (1:1 zur Versicherung)
  speichert die externe `paperlessTagId` als stabile Referenz, den Anzeigenamen
  als Cache, eine `configVersion` (Stale-Schutz), `lastSyncedAt`, `syncStatus`
  und einen nicht sensitiven `syncErrorCode`. `connectionRef` hält die zum
  Konfigurationszeitpunkt verwendete, effektive `PAPERLESS_URL` (ohne
  Zugangsdaten).
- **REST-API:** `GET /households/:id/paperless-tags` (serverseitige Suche in
  Paperless), `POST /households/:id/paperless-tags` (Tag anlegen, idempotent),
  `GET|PUT|DELETE /households/:id/policies/:id/paperless-tag` (lesen, setzen/
  wechseln, entfernen), `GET .../paperless-tag/status`,
  `POST .../paperless-tag/sync` (Sofortabgleich),
  `POST .../paperless-tag/retry` (fehlgeschlagene Tag-Zuweisung wiederholen).
  Lesende Rollen dürfen den Zustand sehen, Änderungen sind `USER`/`ADMIN`.
- **Outbox + Worker:** Die Änderung und die dauerhafte Job-Zeile
  (`paperless_tag_jobs`) entstehen in **einer** Transaktion; danach wird der
  Job in die Queue `paperless-tag-sync` eingereiht. Ein fehlgeschlagener
  Enqueue bleibt `PENDING` und wird vom periodischen Abgleich (`reconcile`)
  erneut zugestellt. Der Worker führt `sync-policy`, `tag-document` und
  `reconcile` aus.
- **Stale-Schutz:** Jeder Job trägt die `configVersion`. Wird der Tag geändert
  oder entfernt, werden offene Jobs als `SKIPPED` verworfen und können die
  neue Konfiguration nicht überschreiben. Zeigt `PAPERLESS_URL` auf einen
  anderen Server als `connectionRef`, werden Jobs als `CONNECTION_CHANGED`
  beendet und die Zuordnungen bleiben unangetastet (kein stilles Verschieben
  auf einen fremden Server).
- **Abgleich-Semantik:** Der Tag-Abgleich führt nur nach einem vollständig
  erfolgreichen Seitenlauf Änderungen aus. Ein unerreichbares Paperless oder
  eine fehlgeschlagene Seite führt zu einem Retry (bounded, über die outbox)
  und entfernt **nie** bestehende Zuordnungen. Verliert ein manuell
  verknüpftes Dokument den Tag, entfällt nur die automatische Herkunft
  (`linkOriginTag`); rein automatisch zugeordnete Dokumente werden archiviert,
  nicht gelöscht.
- **Manuelle Verknüpfungen:** Das bestehende Verlinken (BugFix-07) bleibt
  unverändert nutzbar und setzt zusätzlich `linkOriginManual`. Ist ein Tag
  konfiguriert, wird der Tag additiv auf dem Dokument ergänzt und sein Erfolg
  durch erneutes Lesen in Paperless bestätigt (`taggingStatus`
  `PENDING`/`APPLIED`/`FAILED`, inkl. `taggingErrorCode`).
- **Bewusste Grenzen:** Es wird ausschließlich der Tag additiv gesetzt; keine
  Dokumentdateien werden übertragen oder verändert, keine Tags oder Dokumente
  in Paperless gelöscht. Der Abgleich erfolgt pollend
  (`PAPERLESS_TAG_SYNC_INTERVAL_MS`, Default 5 Minuten), es gibt keine
  Paperless-Webhooks.
- **Benötigte Paperless-Rechte:** Der verwendete API-Token muss
  (a) Tags **lesen** (`GET /api/tags/`), (b) Tags **anlegen** (`POST /api/tags/`)
  – nur nötig, wenn der Nutzer einen neuen Tag erzeugt, (c) Dokumente **lesen**
  (`GET /api/documents/`) und (d) Dokumente **ändern** (`POST /api/bulk_edit/`
  bzw. `PATCH /api/documents/:id/`), um den Tag zu ergänzen. Ein Token ohne
  Änderungsrecht funktioniert für die reine Anzeige, manuell verknüpfte
  Dokumente bleiben dann im Zustand `FAILED` (erneut ausführbar über
  „Tag-Zuweisung wiederholen“).
- **Unterstützte Paperless-Versionen:** Die REST-Endpunkte
  `/api/tags/`, `/api/documents/` und `/api/bulk_edit/` sind seit
  Paperless-ngx **1.7** stabil und in den 2.x-Releases unverändert. Der
  additive Bulk-Edit ist der bevorzugte Weg; antwortet die Instanz mit
  `404`/`405`, fällt der Adapter auf ein lesend-verschmelzendes
  `PATCH /api/documents/:id/` zurück. Getestet wird gegen die minimale
  unterstützte Version **2.0** (ältere Versionen sind nicht Teil der
  Support-Matrix).
- **Archivierte Versicherungen:** Wird eine Versicherung archiviert, sind
  zugehörige Job-Zeilen veraltet; der Worker verwirft laufende/pending Jobs
  (`POLICY_ARCHIVED`), der periodische Abgleich überspringt archivierte
  Policen. Beim harten Löschen entfernt der Fremdschlüssel
  (`ON DELETE CASCADE`) Konfiguration und Job-Zeilen.

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
