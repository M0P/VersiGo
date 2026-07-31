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
- oidcSubject
- email
- displayName
- locale
- status
- credential (optional 1:1 relation)

### Credential
- id
- userId (FK -> users.id, unique, cascading delete)
- identifier (unique, normalisiert: lowercase + getrimmt)
- passwordHash (bcrypt, niemals Plaintext)
- createdAt
- updatedAt

### HouseholdMembership
- householdId
- userId
- role (`owner`, `admin`, `member`, `viewer`)

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

### PortalAccountLink
- id
- policyId
- providerKey
- portalUrl
- usernameHint
- mailboxCapability
- lastSyncAt
- syncStatus

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
- key (z. B. `ui:accentColour`)
- value (Klartext, z. B. `#1a73e8`)
- createdAt
- updatedAt

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
