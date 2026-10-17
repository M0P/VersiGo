## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: PASS

## Findings

- [Minor] `apps/api/src/features/paperless-ngx/paperless-ngx.service.ts:689-697` (with `apps/worker/src/paperless-tag.client.ts` equivalent branch) — `assignTagToDocument`'s fallback error code is derived from `bulk.status` rather than from the operation that actually failed, so `DOCUMENT_NOT_FOUND` can be reported for a document that demonstrably exists.
  - The additive `bulk_edit` path is tried first; when it is unavailable (404/405) the code falls back to `PATCH /documents/:id/` with a merged tag list. `before` was already read with status 200 in that case, i.e. the document exists. If the fallback PATCH then fails, the error code is still taken from `bulk.status` (404/405) and therefore surfaces as `DOCUMENT_NOT_FOUND` — misleading for older Paperless builds without `bulk_edit`. The assignment itself is still safe (no tag is written), and the worker client has the same shape.
  - Suggested fix (not required for acceptance): remember the fallback result and map the code from the failing operation (`401/403 → AUTH_FAILED`, `404 → DOCUMENT_NOT_FOUND`, `null → UNREACHABLE`, else `API_ERROR`) in both the API adapter and the worker client.

## Verification

- All five round-5 fixes verified correct and complete:
  1. **High (DI):** `apps/worker/src/paperless-tag.client.ts` now carries `@Injectable()` and imports `SettingsResolverService` as a value (not `import type`), so `emitDecoratorMetadata` (tsc) emits `design:paramtypes` and Nest can inject the resolver. The new `apps/worker/src/__tests__/paperless-tag.client.spec.ts` guards the injectable watermark and the runtime value import; it correctly does **not** assert `design:paramtypes` because vitest/esbuild does not implement `emitDecoratorMetadata`. Without the fix every worker tag job would have failed at runtime while the processor unit tests (which hand-build the client) passed.
  2. **Medium (stale `APPLIED` short-circuit):** the early return on `document.taggingStatus === 'APPLIED'` in `applyManualLinkOrigin` is gone; the method always records `linkOriginManual: true`, sets `taggingStatus: 'PENDING'` and reuses/creates the durable `TAG_DOCUMENT` row unless no tag is configured. The `round-5 fix` api test asserts the durable assignment; the `round-4 fix` tag-origin test remains valid; the caller still enqueues only after commit and tolerates `tagJobId: null`.
  3. **Minor (`NOT_FOUND` → `DOCUMENT_NOT_FOUND`):** the missing-document case and the fallback branch both return `DOCUMENT_NOT_FOUND`; `NOT_FOUND` is now produced only by tag lookups, matching the interface comment and `docs/04-data-model.md`.
  4. **Minor (stuck spinner):** the `!editing || term.length < 2` branch clears the searching flag.
  5. **Minor (draft comment):** replaced with the factual rationale around `created.push({ id: existing.id })`.
- Round-3/round-4 fixes confirmed intact and undisturbed: the three transactional `updateMany` calls in `removeTag` (archive tag-only rows → clear dual-origin rows → reset tagging state of all live manual links); the reconcile tick registered by both the API and the worker with identical name/options/jobId; `reconcileAssignments` reporting the abort with `handleSyncPolicy` writing `SKIPPED`/`STALE_CONFIG` and skipping the `ACTIVE` write and the backfill; the `scheduleManualLinkBackfill` config-version re-check and its null-safe `OR` filter; and the `handleTagDocument` connection-drift guard placed after the config/archived checks and before any external call.
- Module wiring, role-guard split on the new controller, additive migration (`ON DELETE CASCADE`, partial unique index filtered by `archivedAt IS NULL`), settings-catalogue/env/compose/smoke-test additions and the docs updates were reviewed as part of the diff.

## Residual risk / limits

- Static, read-only review: no shell was available, so the reviewer executed no `pnpm run test`/`typecheck`/`lint` or compose run; the above conclusions are derived from the code. The coordinator ran the full containerised gate (migrate, lint, typecheck, unit/integration tests, dependency licences, version sync, i18n guard) green on this revision.

## Acceptance

**Acceptance bar met: 0 Critical, 0 High, 0 Medium, 1 Minor (≤ 8). Verdict: PASS.**
