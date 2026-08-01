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

## 9. Notifications
Optionale Benachrichtigungen zu Ablauf, Erneuerung, Beitragserhöhungen und fehlenden Dokumenten.
