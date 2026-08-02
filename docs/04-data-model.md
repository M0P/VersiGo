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
