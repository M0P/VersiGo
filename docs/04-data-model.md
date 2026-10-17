# Datenmodell

## Kernaggregate

### Household
- id
- name
- defaultCurrency
- createdAt
- archivedAt

### User
- id
- username (unique, normalisiert: lowercase + getrimmt; lokaler Login-Identifier, AP-16/ADR-007)
- email (optional, kein Login-Merkmal, kein eindeutiger Index)
- displayName
- role (`GlobalRole`: `READ_ONLY` | `USER` | `ADMIN`)
- status (`UserStatus`: `ACTIVE` | `PENDING_APPROVAL` | `DISABLED`)
- oidcIssuer (nullable, optional gebundene OIDC-Identität, AP-16/ADR-007)
- oidcSubject (nullable, UNIQUE zusammen mit oidcIssuer)
- locale (Sprachcode `en` | `de`, Default `en` – globaler Standard; AP-21)
- credential (optional 1:1 relation)

### Credential
- id
- userId (FK -> users.id, unique, cascading delete)
- passwordHash (bcrypt, Kostenfaktor 12, niemals Plaintext)
- createdAt
- updatedAt

### HouseholdMembership
- householdId
- userId
- (dient ausschließlich der Mandantentrennung; keine Rolle mehr, AP-16/ADR-007)

### FamilyShare
- id
- sourceUserId
- targetUserId
- scopeType (`insurance`, `document`, `category`, `all_owned`)
- scopeRef
- permission (`read`, `write`)

### InsurancePolicy
- id
- householdId
- ownerUserId
- type (`haftpflicht`, `hausrat`, `rechtsschutz`, `kfz`, `wohngebaeude`, `unfall`, `leben`, `berufsunfaehigkeit`, ...)
- insurerName
- insurerPortalUrl
- contractNumber
- tariffName
- status
- startDate
- endDate
- renewalDate
- noticePeriod
- paymentFrequency
- premiumAmount
- deductibleAmount
- coverageSummaryShort
- source (`manual`, `ai_extracted`, `imported`)

### CoveredPerson
- id
- policyId
- personName
- relationType
- birthDate

### PolicyCostEntry
- id
- policyId
- validFrom
- validTo
- grossAmount
- netAmount
- frequency
- bookingSource
- note

### PolicyDocument
- id
- policyId
- storageType (`internal`, `paperless_link`)
- fileName
- mimeType
- checksum
- storageRef
- documentDate
- category
- linkOriginManual (AP-22; bool, Default `false` – Dokument wurde manuell verknüpft)
- linkOriginTag (AP-22; bool, Default `false` – Dokument trägt den konfigurierten Paperless-Tag)
- taggingStatus (AP-22; nullable `PENDING` | `APPLIED` | `FAILED` – Stand der externen Tag-Zuweisung)
- taggingErrorCode (AP-22; nullable, nicht sensitiver Fehlercode der Tag-Zuweisung)

### PolicyPaperlessTag (AP-22)
- id
- policyId (FK -> insurance_policies.id, **unique** – max. ein Tag je Versicherung, cascading delete)
- connectionRef (nullable; effektive `PAPERLESS_URL` zum Konfigurationszeitpunkt, ohne Zugangsdaten – erkennt einen Serverwechsel)
- paperlessTagId (externe, stabile Tag-Referenz)
- paperlessTagName (Anzeige-Cache; maßgeblich ist Paperless)
- configVersion (Default `1`; wird bei jeder Änderung erhöht und von jedem Job mitgeführt → Stale-Schutz)
- lastSyncedAt (nullable; Zeitpunkt des letzten vollständig erfolgreichen Abgleichs)
- syncStatus (`SyncStatus`: `PENDING` | `ACTIVE` | `ERROR` | `DISABLED`)
- syncErrorCode (nullable; nicht sensitiver Fehlercode)
- createdAt
- updatedAt

### PaperlessTagJob (AP-22, Outbox-Äquivalent)
- id
- policyId (FK -> insurance_policies.id, cascading delete)
- documentId (nullable; bei `TAG_DOCUMENT` gesetzt)
- kind (`SYNC_POLICY` | `TAG_DOCUMENT`)
- status (`AiJobStatus`-Enum: `PENDING` | `RUNNING` | `COMPLETED` | `FAILED` | `SKIPPED`)
- configVersion (Version der Konfiguration, für die der Job gedacht war)
- retryCount (Default `0`), maxRetries (Default `3`)
- errorCode (nullable; siehe Code-Liste unten), completedAt
- Modellregel (AP-22): Die Zeile entsteht in derselben Transaktion wie die
  Datenänderung und ist damit die dauerhafte Quelle; BullMQ ist nur Transport.
  Der BullMQ-`jobId` entspricht der Zeilen-`id` (idempotente Wiederzustellung).
- Vollständige `errorCode`-Liste (identisch für `PaperlessTagJob.errorCode`
  und `PolicyDocument.taggingErrorCode`; geschrieben vom Worker bzw. von den
  Paperless-Adapter-Aufrufen):
  - Konfiguration/Lebenszyklus: `STALE_CONFIG`, `CONNECTION_CHANGED`,
    `TAG_REMOVED`, `POLICY_ARCHIVED`, `SUPERSEDED`, `NOT_CONFIGURED`
  - Verbindung/API: `UNREACHABLE`, `AUTH_FAILED`, `API_ERROR`, `UNKNOWN`
  - Sync: `SYNC_FAILED`
  - Tag-Lookup: `NOT_FOUND` (der konfigurierte Tag existiert in Paperless nicht mehr)
  - Dokumentzuordnung: `DOCUMENT_NOT_FOUND` (das Paperless-Dokument existiert
    nicht mehr), `DOCUMENT_GONE` (der lokale Link-Datensatz fehlt oder ist kein
    Paperless-Link), `VERIFY_FAILED` (Tag konnte nach dem Schreiben nicht
    bestätigt werden)
  Ein `SKIPPED`-Job trägt immer einen dieser Codes; `null` bedeutet „kein
  Fehler" (erfolgreich bzw. noch nicht gelaufen). `DOCUMENT_NOT_FOUND` und
  `DOCUMENT_GONE` sind bewusst getrennt, damit ein gelöschtes Remote-Dokument
  von einem veralteten lokalen Link unterscheidbar bleibt.

### PortalAccountLink (AP-18)
- id
- policyId
- providerKey (Schlüssel aus dem Portal-Katalog, siehe `docs/06-integrations.md`)
- portalUrl (manuell gesetzte URL; hat Vorrang vor dem Katalog-Deeplink – nur `http(s)`-URLs; andere Schemata/ungültige Werte werden bei der Ausgabe verworfen und fallen auf die Katalog-Vorlage zurück)
- accessHint (individueller Zugangshinweis; fällt sonst auf den Katalog-Hinweis zurück)
- usernameHint
- connectorKey (optionaler Schlüssel eines Connector-Plugins, z. B. `mailbox-sync-browser-automation`)
- credentialsEncrypted (AES-256-GCM verschlüsselte Zugangsdaten, nie Klartext)
- mailboxCapability
- lastSyncAt
- syncStatus
- createdAt
- updatedAt

### AiExtractionJob
- id
- policyId
- providerKey
- model
- status
- inputDocumentRef
- extractedFieldsJson
- confidenceJson
- errorMessage

### AiCoverageSummary
- id
- policyId
- providerKey
- model
- summaryMarkdown
- sourceDocumentRefsJson
- createdAt

### UserPreference (AP-13)
- id
- userId (FK -> users.id, unique per [userId, key], cascading delete)
- key (versionierte Katalog-Allowlist AP-17/AP-21: `ui:accentColour`, `theme`;
  die frühere Präferenz `language` ist obsolet – Sprache liegt seit AP-21 in
  `users.locale` bzw. der Sitzung)
- value (Klartext, z. B. `#1a73e8`)
- createdAt
- updatedAt

### GlobalIntegrationSetting (AP-07/AP-17)
- id
- key (unique, identisch mit dem katalogisierten Env-Variablennamen, AP-17)
- valuePlain (nullable, nur für Nicht-Secrets)
- valueEncrypted (nullable, AES-256-GCM für Secrets, AP-17)
- updatedByUserId (nullable, FK -> users.id, `ON DELETE SET NULL`; Audit-Akteur, AP-17)
- createdAt
- updatedAt
- Modellregel (AP-17): Es existiert genau eine Zeile pro Schlüssel; der Wert ist
  der datenbankgestützte UI-Wert mit Vorrang vor `.env`. Das Löschen der Zeile
  entspricht dem „Zurücksetzen auf Fallback".

### AuditLog
- id
- actorUserId
- entityType
- entityId
- action
- diffJson
- createdAt

## Wichtige Modellregeln
- Kostenhistorie ist append-only mit optionaler Korrekturversion.
- Dokumente sind versionierbar.
- AI-Ergebnisse sind abgeleitete Daten und stets neu erzeugbar.
- Freigaben referenzieren Fachobjekte, nicht Speicherorte.
- Globale Rollen (`GlobalRole`) gelten instanzweit; `HouseholdMembership` entkoppelt fachliche Mitgliedschaft von der Berechtigungsrolle.
- Neue lokale Konten starten mit `PENDING_APPROVAL` und sind bis zur Admin-Freischaltung gesperrt.
- OIDC-Identitäten werden an lokale Konten gebunden (kein Provisioning); `(oidcIssuer, oidcSubject)` ist eindeutig.
