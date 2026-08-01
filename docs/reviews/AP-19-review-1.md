# AP-19 Review — Round 1

- Date: 2026-08-01
- Reviewer: code-reviewer subagent (read-only)
- Scope: uncommitted AP-19 changes vs origin/main (worker health foundation, ADMIN audit API, GDPR privacy slice, ADMIN monitoring API, infra, docs)
- Status: PASS

## Result (verbatim)

# Review result

**Note:** The maximum step budget for this review was reached before I could finish every planned check (docs 03/05/07/08/13 + ADR-008, and the full `documents.service.ts` `storeFile()` path shape). Findings below are based on the code that was fully reviewed. The report is complete enough for a decision; the remaining items are listed under "Remaining risks."

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 5
- Verdict: PASS

## Findings

- [Minor] `docker-compose.yml:168` — Worker healthcheck hardcodes port `3100`
  - Evidence: The work package makes `WORKER_HEALTH_PORT` configurable (`WORKER_HEALTH_PORT: "${WORKER_HEALTH_PORT:-3100}"`, line 154; `.env.example` line 114; schema default 3100). The container healthcheck (`test: ["CMD","node","-e",...'http://127.0.0.1:3100/health'..."]`) does not interpolate the variable, so a deployment that sets `WORKER_HEALTH_PORT` to another value gets a permanently unhealthy worker despite a running liveness server.
  - Required fix: Derive the probe from the env var (e.g. a `CMD-SHELL` form using `$WORKER_HEALTH_PORT`, or document that the healthcheck is bound to the default port).

- [Minor] `apps/api/src/features/privacy/privacy.service.ts:310` — `PRIVACY_ACCOUNT_DELETED` audit write is not fail-soft
  - Evidence: Requirement 2 states "Audit `record()` must be fail-soft (never break the mutation)". The privacy path bypasses `AuditService.record()` and does a direct `tx.auditEvent.create` inside the deletion transaction, so an audit-write failure aborts the whole deletion (user cannot delete the account = GDPR erasure blocked by an audit problem). In practice the impact is limited because a failing audit insert implies a failing transaction anyway, and the atomic write guarantees the trail, so this is a deliberate trade-off — but it deviates from the explicit requirement.
  - Required fix: Either keep the atomic in-transaction write and add a code comment referencing the requirement decision (ADR), or wrap the audit insert so a failure does not roll back the deletion while still writing the event best-effort.

- [Minor] `apps/api/src/features/privacy/privacy.service.ts:279-288` — Last-admin check has a TOCTOU window
  - Evidence: `tx.user.count(...)` and the subsequent `tx.user.delete(...)` run inside the same transaction, but two concurrent `DELETE /privacy/account` requests from two different active admins can both observe `activeAdmins = 2` and both delete themselves, leaving zero active admins (system lockout). Sequential cases (incl. the smoke test 8l) are handled correctly via `ConflictException`/409.
  - Required fix: Optionally serialize the guard (e.g. advisory lock or conditional delete of the admin row) or document the race as an accepted residual risk in ADR-008.

- [Minor] Missing security-relevant negative tests (requirement 5)
  - Evidence: No test asserts that a non-ADMIN (USER/READ_ONLY) receives 403 on `/admin/audit/events` and `/admin/monitoring/*`, even though the `@Roles(GlobalRole.ADMIN)` gate is the central authorization control for these features. The smoke test covers unauthenticated 401 (step 8k) but not the 403 role case. The smoke test also does not exercise audit detail (diff redaction), failed-jobs redaction, the retry endpoint (404 path), or `ai-jobs`.
  - Required fix: Add controller/e2e assertions for 403 on the ADMIN endpoints for a non-admin session, and extend the smoke test to the remaining new endpoints.

- [Minor] `packages/foundation/src/worker-health/worker-heartbeat.service.ts` — stale heartbeat rows are never cleaned up
  - Evidence: `workerId = ${os.hostname()}:${process.pid}` changes on every worker restart, and `getStatus()` reads only the newest row; rows of crashed/restarted workers accumulate in `worker_heartbeats` indefinitely (only `lastSeenAt` is updated on upsert). No functional impact, but unbounded table growth over time on long-lived deployments.
  - Required fix: Optionally delete rows older than a retention window (e.g. a periodic cleanup) or prune on boot.

## Verification
- Tests/checks reviewed (not executed — read-only review):
  - `worker-heartbeat.service.spec.ts` (start/idempotency, interval, fail-soft write/read, up/down/unknown), `worker-liveness.service.spec.ts` (200 payload, 404, idempotent start/stop).
  - `health.controller.spec.ts` (ready/degraded logic, worker does not flip status, no URL leaks).
  - `audit.service.spec.ts` (no `diffJson` in list, `hasDiff`, take clamp 200/default 50, where-clause filters, detail w/ diff, 404, fail-soft `record`), `audit.controller.spec.ts`.
  - `privacy.service.spec.ts` (no `passwordHash`/`storageRef`/`portalUrl`/`usernameHint` in export, last-admin 409, audit-before-delete ordering, household retention, post-commit deletion with root guard + ENOENT), `privacy.controller.spec.ts`.
  - `monitoring.service.spec.ts` (no payloads, `failedReason` ≤ 500, retry 404, no `errorMessage`/`extractedFieldsJson`, no token/URL in integrations), `monitoring.controller.spec.ts`.
  - `settings-catalog.spec.ts` — new WORKER_* keys are catalogued as `bootstrap`, so the schema/catalog parity test passes; the new keys do not collide with the UI-configurable/secret tests.
- Important areas inspected:
  - AuthZ wiring: `RolesGuard` is hierarchical (ADMIN > USER > READ_ONLY), so `@Roles(USER)` on privacy lets ADMIN through and blocks READ_ONLY with 403; `@Roles(ADMIN)` on audit/monitoring enforces ADMIN-only. Session identity (`request.user` re-fetched from DB in `SessionAuthGuard`) is the sole identity source in privacy — no IDOR.
  - Redaction requirements: audit list omits `diffJson` (selects it only to compute `hasDiff`), detail endpoint ADMIN-only; monitoring strips payloads, truncates `failedReason`, AI jobs exclude `errorMessage`/`extractedFieldsJson`; privacy export excludes credential/portal/storage fields; health/liveness payloads expose only booleans/status.
  - File deletion: post-commit (`filesToRemove` collected in-tx, unlinked after), root-path guard `resolved.startsWith(storagePath + sep)`, ENOENT tolerated, non-ENOENT errors logged.
  - Worker bootstrap: `preloadRestartSettingsIntoEnv()` still first; heartbeat + liveness started only in worker; API never starts the liveness server (only imports the module for `getStatus`).
  - Module wiring: `AiAssistModule`/`PaperlessNgxModule` exports (`AiExtractionQueue`, `PAPERLESS_ADAPTER`, `AiAssistService`) satisfy `MonitoringModule` DI; `WorkerHealthFoundationModule` imports `DatabaseModule`/`ConfigFoundationModule`; all three new modules wired in `app.module.ts`.
- Remaining risks / not fully verified (step budget exhausted):
  - Docs 03/05/07/08/13 and ADR-008 were not read; spot-check them against the described behavior (esp. port/redaction/last-admin statements).
  - `documents.service.ts:218` (`storeFile`) was not fully read; if `storageRef` is ever stored as a relative path, `path.resolve(filePath)` would resolve against the API cwd and the root-path guard would silently skip deletion (files retained on disk — retention issue, not a traversal risk). Unit test data uses absolute paths under `/tmp/uploads/...`, consistent with the guard.
  - Concurrency behavior of BullMQ `getFailed(0,20)`/`retry` and multi-worker heartbeat semantics were reasoned about but not executed.
