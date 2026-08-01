# AP-19 Review — Round 2

- Date: 2026-08-01
- Reviewer: code-reviewer subagent (read-only)
- Scope: verification of 5 Round-1 Minor fixes + closing Round-1 unfinished items (docs accuracy, storageRef root-guard)
- Status: PASS

## Result (verbatim)

## Statement: Maximum steps for this agent have been reached

This review pass was interrupted by the step limit before the full report could be finalized through additional tool calls. The report below is based on the static inspection completed up to the interruption. The two automated gates (docker-compose test suite and compose smoke test) were **not re-run** in this read-only environment — the implementer-reported green results (API 45 files / 506 tests; smoke steps 8f–8l) are trusted per the review instructions.

---

# Review result (Round 2, AP-19)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: **PASS**

## Verification of the five Round-1 fixes

1. **Worker healthcheck port** — **FIXED, correct.** `docker-compose.yml:167-170` now reads `process.env.WORKER_HEALTH_PORT || '3100'` with an explanatory comment. Consistent with `app-config.schema.ts:77` (default 3100), `.env.example:114`, and `settings-catalog.ts:544-552` (bootstrap, group "Worker Health").
2. **Atomic audit-write deviation** — **FIXED, correct.** `privacy.service.ts:307-315` now carries a comment explaining the deliberate in-transaction `tx.auditEvent.create` deviation from the fail-soft `AuditService.record()` rule, referencing GDPR proof-of-erasure and ADR-008. ADR-008 decision 3 (lines 83-90) documents the same deviation.
3. **Last-admin TOCTOU** — **DOCUMENTED, correct.** ADR-008 lines 112-123 add an "Akzeptiertes Restrisiko (TOCTOU)" paragraph explaining the two-concurrent-admin scenario, the Read-Committed isolation limitation, and the deliberate rejection of advisory-lock/conditional-delete.
4. **403 negative tests** — **ADDED, correct.** `audit.controller.spec.ts:19-49` and `monitoring.controller.spec.ts:28-58` assert (a) `ROLES_KEY` metadata on both controllers contains `GlobalRole.ADMIN` and (b) a real `RolesGuard` throws `ForbiddenException` for `USER`/`READ_ONLY`. Verified `roles.guard.ts:46-48` actually throws on insufficient rank, so the tests are meaningful.
5. **Stale heartbeat pruning** — **IMPLEMENTED, correct.** `worker-heartbeat.service.ts:40` (`PRUNE_RETENTION_MS` = 1h), `:60` (fire-and-forget from `start()`), `:70-81` (fail-soft `pruneStaleHeartbeats`). Spec (`worker-heartbeat.service.spec.ts:157-194`) covers pruning cutoff semantics and fail-soft rejection. ADR-008 Konsequenzen updated accordingly.

## Round-1 unfinished item 1 — Docs accuracy (checked)
- `docs/03-architecture.md:63-85` — worker `:3100/health`, `WORKER_HEALTH_PORT` default, `GET /ready` `worker` field (informative), heartbeat interval/timeout. Accurate.
- `docs/05-feature-slices.md:33-73` — ADMIN-only audit/monitoring, privacy redaction, last-admin 409, worker health. Accurate.
- `docs/07-security-privacy.md:93-116` — GDPR export redaction, account-deletion semantics (audit-first, cascade, post-commit file cleanup, path-traversal guard, ENOENT-tolerant). Accurate.
- `docs/08-admin-operations.md:54-75,199-202` — health endpoint table incl. worker field, ADMIN-only admin API table, redaction policy. Accurate.
- `docs/13-settings-catalog.md:125-127` — `WORKER_HEALTH_PORT` / `WORKER_HEARTBEAT_INTERVAL_MS` / `WORKER_HEARTBEAT_TIMEOUT_MS` as bootstrap group "Worker Health". Matches `settings-catalog.ts:542-588`.
- ADR-008 — decisions 1-3, TOCTOU paragraph, Konsequenzen: all consistent with the code.

## Round-1 unfinished item 2 — storageRef absolute vs relative + deleteAccount root-guard
- `documents.service.ts:53` resolves `DOCUMENTS_STORAGE_PATH` to an **absolute** path; `resolveSafePath` (lines 62-69) and `storeFile` (lines 138-146) produce **absolute** `storageRef` values (e.g. `<root>/<policyId>/<documentId>/<documentId>`).
- `privacy.service.ts:371-388` `removeFileSafely` builds `root = this.storagePath + path.sep` (absolute) and `path.resolve(filePath)` on the absolute storageRef, then a `startsWith(root)` prefix check. This behaves correctly for the actual stored values.
- Traversal implications: storageRef is server-generated (UUID-only segments), never user-supplied, so the guard is defense-in-depth. One theoretical caveat: `path.resolve` does **not** resolve symlinks, so a symlinked directory *inside* the root pointing outside could be followed by `unlink`; this requires local filesystem write access and is not a realistic attack surface here. Retention semantics are correct: files outside root are skipped (logged), `ENOENT` tolerated, other errors logged without throwing (verified in spec `privacy.service.spec.ts:258-318`).

## Findings
- [Minor] `scripts/compose-smoke-test.sh:430` — step 8f hardcodes `127.0.0.1:3100` for the in-container liveness probe.
  - Evidence: The compose healthcheck now honors `WORKER_HEALTH_PORT` (docker-compose.yml:170), but the smoke test probe is fixed at the default port. A deployment that customizes `WORKER_HEALTH_PORT` would still pass the compose healthcheck but fail smoke step 8f.
  - Required fix: derive the port in the smoke probe from `WORKER_HEALTH_PORT` (as the healthcheck does) or document that the smoke test is bound to the default port.

## Verification
- Tests/checks reviewed: the five fix-sites and their specs (worker-heartbeat.service.spec.ts, audit/monitoring controller specs, privacy.service.spec.ts), RolesGuard/ROLES_KEY semantics, HealthController spec (worker field), settings-catalog schema parity, app-config schema defaults, and the smoke-test steps 8f-8l.
- Important areas inspected: docker-compose.yml worker healthcheck/env, privacy delete flow + file cleanup, documents storeFile/resolveSafePath, worker main.ts bootstrap wiring, HealthController `/ready`, settings-catalog bootstrap entries, docs 03/05/07/08/13 and ADR-008, `.env.example`.
- Remaining risks: full gate re-run not performed (read-only); symlink-following caveat in the file-cleanup guard (documented above, not a realistic attack path); smoke step 8f port coupling (Minor finding above).
