# ADR-008: Worker-Health, Admin-Monitoring-Redaction und Privacy-Löschsemantik

## Status
Akzeptiert

## Kontext
AP-19 führt drei Querschnittsbereiche ein, die jeweils eine architekturelle
Entscheidung erfordern:

1. **Worker-Health:** Der Worker besitzt keinen HTTP-Stack; für einen
   Compose-Healthcheck und die Readiness der API fehlt eine Aussage über den
   Worker-Zustand. Wie wird der Worker ohne vollen HTTP-Server health/ready?
2. **Admin-Monitoring:** ADMINs benötigen Einblick in Queue, Jobs und
   Integrationen – bei sensiblen Versicherungsdaten dürfen dabei keine
   Payloads, URLs, Tokens oder Zugangsdaten nach außen gelangen. Wie wird
   Monitoring ohne Datenlecks gebaut?
3. **Privacy/GDPR:** Die Löschung eines Kontos muss vollständig und
   revisionssicher sein (Audit-Trail bleibt erhalten), ohne Daten anderer
   Nutzer (Household-Mitglieder) zu gefährden oder Dateien außerhalb des
   Storage-Roots zu löschen.

## Entscheidungen

### 1. Worker-Liveness-Server + PostgreSQL-Heartbeat (kein voller HTTP-Server)

**Entscheidung:** Der Worker startet beim Boot einen winzigen, eigenständigen
HTTP-Server (`WorkerLivenessService`) auf `WORKER_HEALTH_PORT` (Standard 3100,
nur intern, nicht nach außen publiziert), der ausschließlich `GET /health` und
`GET /` mit `{"status":"ok"}` beantwortet (sonst 404, keine Konfigurations-
oder sensiblen Werte). Parallel schreibt `WorkerHeartbeatService` im Intervall
`WORKER_HEARTBEAT_INTERVAL_MS` einen Upsert (`workerId = hostname:pid`) in
`worker_heartbeats` (PostgreSQL). `start()` läuft nur im Worker-Prozess; die
API injiziert denselben Service, nutzt aber ausschließlich `getStatus()`
(liest den neuesten Heartbeat, bewertet gegen `WORKER_HEARTBEAT_TIMEOUT_MS`
→ `up`/`down`/`unknown`).

**Begründung:**
- Ein voller Nest-HTTP-Stack im Worker wäre Overhead (Port, Middleware,
  Guards) ohne Mehrwert – ein minimaler `http`-Server genügt für Liveness.
- Der Heartbeat liegt in PostgreSQL (nicht Redis), da die API sonst Redis
  zusätzlich auswerten müsste und ein reiner Prozess-Check keine
  fachliche Aussage über die DB-Verbindung des Workers liefert.
- Der Worker-Zustand in `GET /ready` ist **informativ**: Er kippt den
  Gesamtstatus nie (die API bleibt ready, auch wenn der Worker fehlt), damit
  ein Worker-Ausfall die API/Web-Topologie nicht als „nicht ready" abreißt.
- Fail-soft: DB-Fehler beim Heartbeat loggen eine Warnung, werfen nie;
  `getStatus()` liefert bei DB-Fehlern `unknown`.

**Abgelehnte Alternative:** Worker als voller NestJS-HTTP-Dienst mit
eigenem `/health` im API-Stil (Overhead) oder reiner Prozess-Existenz-Check
via `pgrep`/PID im Compose-Healthcheck (keine Aussage über DB-Anbindung,
nicht portabel, Healthcheck-Logik im Compose statt im Code).

### 2. Monitoring nur mit Redaction (Metadaten statt Payloads)

**Entscheidung:** Die Admin-Monitoring-API (`/admin/monitoring/*`, nur
`ADMIN`) liefert ausschließlich Zähler und Metadaten:
- Queue-Übersicht: `getJobCounts()`-Zähler, niemals Job-Payloads.
- Fehlgeschlagene Jobs: `id`, `name`, `attemptsMade`, gekürzte
  `failedReason` (max. 500 Zeichen), `finishedOn` – nie `job.data`.
- AI-Jobs: DB-Metadaten (`status`, `retryCount`, Zeitstempel) ohne
  `errorMessage` und `extractedFieldsJson`.
- Integrationen: nur `enabled`/`connected` und Sync-Status-Zähler, niemals
  URLs, Tokens oder Zugangsdaten. Portal-Connector-Plugins (AP-18) werden
  mit `available`/`healthy` und gekürzter `reason` (≤ 200 Zeichen)
  aufgeführt – der Health-Pfad des Plugins ist fail-soft und liefert nie
  HTTP-500.

**Begründung:**
- Versicherungsdokumente sind besonders schützenswert; ein Monitoring-Pfad,
  der Payloads spiegelt, wäre ein neues Exfiltrationsrisiko.
- Retry benötigt nur die Job-ID (kein Payload) – der Operator bleibt
  handlungsfähig, ohne sensible Daten zu sehen.
- Konsistenz mit der bestehenden Audit-Redaction-Policy (Secrets/Werte nie in
  Diffs) und der Settings-Allowlist.

**Abgelehnte Alternative:** Vollständige Job-/Payload-Ansicht im Monitoring
(bequemer, aber unvereinbar mit der Datenschutz-Linie des Produkts).

### 3. Privacy-Löschung: Audit zuerst, Kaskade, Household-Guard, Datei-Cleanup nach Commit

**Entscheidung:**
- **Letzter-Admin-Schutz:** Ein `ADMIN` kann sein Konto nicht löschen, wenn
  er der letzte aktive Admin ist (409 `ConflictException`) – analog zum
  Sperr-/Downgrade-Schutz aus ADR-007.
- **Audit vor der Löschung:** `PRIVACY_ACCOUNT_DELETED` (mit
  `diffJson: { selfService: true }`) wird *innerhalb* der Lösch-Transaktion
  vor dem User-Delete geschrieben. Danach wird `actorUserId` per
  `ON DELETE SET NULL` neutralisiert – der Eintrag bleibt revisionssicher
  erhalten, ohne auf den gelöschten User zu verweisen. Dies ist eine bewusste
  Abweichung von der Fail-soft-Regel des `AuditService.record()`: Ein
  fehlschlagendes Audit-Insert bricht die gesamte Transaktion ab, damit kein
  Konto ohne unumstößlichen Lösch-Nachweis entfernt wird (GDPR-Nachweispflicht).
- **Kaskade in einer Transaktion:** Eigene Policen werden gelöscht
  (Kaskade: CoveredPerson, PolicyCostEntry, PolicyDocument, PortalAccountLink,
  AiExtractionJob, AiCoverageSummary) → Household-Mitgliedschaften aufgelöst →
  ein Household wird **nur** gelöscht, wenn weder Mitglieder noch Policen
  verbleiben (Guard gegen Datenverlust anderer Nutzer im Family-Sharing-
  Modell, ADR-007) → User löschen.
- **Datei-Cleanup nach DB-Commit:** Physische Dateien (INTERNAL-`storageRef`)
  werden erst nach erfolgreichem Commit entfernt, ausschließlich wenn der
  aufgelöste Pfad innerhalb des Storage-Roots liegt (Path-Traversal-Schutz);
  `ENOENT` wird toleriert, andere Fehler werden geloggt und werfen nie.

**Begründung:**
- Audit-Vorabschreiben ist die einzige Möglichkeit, den Löschvorgang selbst
  revisionssicher festzuhalten (nach dem Delete ist der Actor weg).
- Der Household-Guard verhindert, dass die Löschung eines Mitglieds Daten
  anderer Mitglieder beschädigt (Invariante: alle Policen eines Households
  gehören dessen Mitgliedern).
- Cleanup erst nach Commit vermeidet, dass Dateien entfernt werden, obwohl
  die Transaktion fehlgeschlagen ist; der Pfad-Guard verhindert
  Path-Traversal über manipulierte `storageRef`-Werte.

**Akzeptiertes Restrisiko (TOCTOU):** Die Letzter-Admin-Prüfung
(`count` + `delete`) läuft zwar in derselben Transaktion, ist aber nicht
gegen parallele Anfragen serialisiert: Zwei gleichzeitige Löschungen zweier
verschiedener aktiver Admins können beide `activeAdmins = 2` beobachten und
sich selbst löschen – Ergebnis: kein aktiver Admin mehr (System-Lockout).
Die Transaktionsisolation (Read-Committed) kann bei echter Parallelität
nicht ausschließen, dass beide `count`s vor dem jeweiligen `delete`
durchlaufen. Der Schutz greift damit zuverlässig für den sequenziellen
und den praktisch dominierenden Fall (ein Admin, der sich selbst löscht);
eine Serialisierung per Advisory Lock oder bedingtem Delete wurde bewusst
verworfen: Der Mehrbenutzer-Admin-Fall ist durch die Rollenhierarchie
selten, und eine Sperre würde die Löschoperation unnötig komplex machen.

**Abgelehnte Alternative:** Hard-Delete aller Household-Daten bei
Kontolöschung (Datenverlust für verbleibende Mitglieder) und sofortiges
Datei-Löschen vor dem DB-Commit (verwaiste Dateien bei Transaktionsfehlern).

## Konsequenzen
- `worker_heartbeats` wächst pro Worker-Instanz (ein Upsert-Row); verwaiste
  Rows (z. B. nach Worker-Neustarts mit neuem PID) werden beim Worker-Boot
  fail-soft aufgeräumt (Retention 1 Stunde, vgl.
  `WorkerHeartbeatService.pruneStaleHeartbeats()`).
- Monitoring liefert bewusst keine Vollansicht; bei Bedarf muss ein Admin
  direkt in Redis/DB nachsehen (dokumentiert in `docs/08-admin-operations.md`).
- Die Löschsemantik ist durch die Privacy-Service-Spec abgedeckt
  (Last-Admin, Audit-Reihenfolge, Household-Guard, Pfad-Guard, ENOENT).
