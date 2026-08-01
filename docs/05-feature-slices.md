# Feature-Slices

## 1. Identity & Access
Zuständig für OIDC-Login, Session, Rollen, Household-Mitgliedschaften und Freigaben.

## 2. Policy Registry
Kernfeature zur Verwaltung von Versicherungsverträgen, Versicherern, versicherten Personen und Portal-Links.

## 3. Documents
Interne Dokumentenablage, Metadaten, Versionierung und Vorschau. Optionaler Adapter zu Paperless-ngx.

## 4. Cost Tracking
Pflege von Beiträgen, Zahlintervallen, Historien und Jahresauswertungen.

## 5. AI Assist
Optionales Feature für Extraktion und Zusammenfassungen über Provider-Adapter.

## 6. Portal Connectors
Katalog von Versicherungsportalen, Deeplinks und optionalen Mailbox-/Dokumenten-Sync-Adaptern je Anbieter.
- **AP-18:** Versicherungsportal-Katalog (`GET /portal-connectors/catalog`) mit
  Deeplinks und Zugangshinweisen pro Anbieter (Kernumfang; lesbar für
  `READ_ONLY`/`USER`/`ADMIN`).
- **AP-18:** Portal-Link-Verwaltung pro Vertrag im Policy-Registry-Slice
  (`createPortalLink`/`updatePortalLink`/`removePortalLink`). Die API
  reichert Links mit aufgelöstem Deeplink, Katalog- und Connector-Sicht an.
- **AP-18:** Plugin-Rahmen (`PortalConnectorPlugin`/`PortalConnectorRegistry`)
  für optionale Connectoren. Mailbox-/Dokumentenabruf ist als
  experimentelles, **deaktiviertes** Plugin (`mailbox-sync-browser-automation`)
  modelliert und liefert kontrollierte Degradation statt Fehler.
- **AP-18:** Optionale Portal-Zugangsdaten werden AES-256-GCM verschlüsselt
  gespeichert (`credentialsEncrypted`); die API gibt nie Werte, nur
  `credentialsSet`, zurück. Audit-Events enthalten ausschließlich
  `credentialsSet` (redigiert).
- **Resilienz:** Ein nicht verfügbarer oder unbekannter Connector
  beeinträchtigt den Portal-Link nicht (Deeplink und Zugangshinweis bleiben
  nutzbar).

## 7. Admin Settings
Webbasierte Konfiguration von Feature-Flags, Integrationen, Speichern, AI-Providern und Systemparametern.
- **AP-17:** Zentraler Settings-Katalog (Allowlist) mit deterministischer Priorität
  UI > `.env` > Code-Default; Admin-UI `/admin/settings` (nur `ADMIN`) mit
  Gruppierung, Suche, Quellen-/Fehler-/Neustart-Filtern, Secret-Maskierung,
  Zurücksetzen und sicheren Connectivity-Tests.
- **AP-17:** Profil-Slice `/user/profile` und persönliche UI-Präferenzen
  (versionierte Allowlist) für `USER`/`ADMIN`; `READ_ONLY` erhält 403.
- Audit aller Änderungen ohne Werte/Secrets (`SYSTEM_CONFIG_UPSERTED`,
  `SYSTEM_CONFIG_RESET`, `PROFILE_UPDATED`).
- Vollständiger Katalog: `docs/13-settings-catalog.md`.

## 8. Audit & Activity
Protokollierung sicherheits- und fachrelevanter Änderungen.
- **AP-19:** Admin-Lese-API (`/admin/audit/events`, `/admin/audit/events/:id`,
  nur `ADMIN`) über den bestehenden revisionssicheren Audit-Trail.
  Die **Liste** liefert bewusst keine `diffJson`-Inhalte (nur `hasDiff`);
  das **Detail** gibt den redigierten Diff zurück (Audit-Redaction-Policy:
  Secrets/Werte werden bereits beim Schreiben nicht in Diffs gespeichert).
  Filter: `entityType`, `action`, `actorUserId`, `from`/`to` (ISO-8601),
  Paginierung `take` (≤ 200) / `skip`.
- **AP-19:** Zentraler, fail-soft `AuditService.record()`-Helfer für neue
  Feature-Aktionen (z. B. `PRIVACY_ACCOUNT_DELETED`).

## 9. Privacy & GDPR
Export und Löschung personenbezogener Daten (nur über die eigene Session).
- **AP-19:** `GET /privacy/export` – strukturierter Export der eigenen Daten
  für `USER`/`ADMIN` (READ_ONLY: 403). Enthält Konto (ohne Passwort-Hash,
  ohne verschlüsselte Werte), Präferenzen, Households, eigene Policen inkl.
  versicherter Personen, Kosten, Dokument-**Metadaten** (nie Speicherpfade),
  Portal-Links (nur `providerKey`/Sync-Metadaten, nie URLs/Zugangsdaten),
  AI-Jobs und eigene Audit-Events. Keine Binärdateien.
- **AP-19:** `DELETE /privacy/account` – Löschung des eigenen Kontos:
  letzter-Admin-Schutz (409), Audit `PRIVACY_ACCOUNT_DELETED` **vor** der
  Löschung, Kaskaden-Löschung eigener Policen, Auflösung von Household-
  Mitgliedschaften (Household nur löschen, wenn leer), physische Datei-
  Bereinigung nach DB-Commit (Path-Traversal-sicher, ENOENT-tolerant).
- **Kein IDOR:** Die Identität stammt ausschließlich aus der Session
  (`@CurrentUser`), nie aus Pfad-/Query-Parametern.

## 10. Monitoring & Health
Betriebsübersicht für ADMINs und Komponenten-Health.
- **AP-19:** `GET /admin/monitoring/queues` – BullMQ-Queue-Zähler (keine Payloads).
- **AP-19:** `GET /admin/monitoring/queues/failed` – fehlgeschlagene Jobs
  (nur Metadaten + gekürzte `failedReason`), `POST .../failed/:jobId/retry`.
- **AP-19:** `GET /admin/monitoring/ai-jobs` – AI-Extraktions-Job-Übersicht aus
  der DB (Status-Zähler, letzte 20) **ohne** `errorMessage`/Extraktions-Payloads.
- **AP-19:** `GET /admin/monitoring/integrations` – Integrationsstatus
  (AI/Paperless/Storage/Portal-Sync) nur als `enabled`/`connected`/Zähler,
  niemals URLs, Tokens oder Zugangsdaten. **AP-18-Integration:** Jedes
  registrierte Portal-Connector-Plugin wird mit `available`/`healthy`
  (gekürzte `reason` ≤ 200 Zeichen) aufgeführt; ein deaktiviertes Plugin
  erscheint kontrolliert als „nicht verfügbar", nie als 500.
- **AP-19 Worker Health:** Liveness-Server (`:3100/health`) und
  PostgreSQL-Heartbeat des Workers; `GET /ready` der API weist den
  Worker-Zustand aus (informativ, siehe `docs/03-architecture.md`).

## 11. Notifications
Optionale Benachrichtigungen zu Ablauf, Erneuerung, Beitragserhöhungen und fehlenden Dokumenten.
