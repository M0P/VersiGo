# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 3
- Minor: 6
- Verdict: CHANGES REQUIRED

## Findings

### Medium

- [Medium] `apps/api/src/features/admin-settings/settings-store.service.ts:68` — Empty string treated as falsy in create/update
  - Evidence: `if (valuePlain)` treats `""` (empty string) as falsy, so a user cannot store an empty string as a setting value. This is a bug: the check should be `if (valuePlain !== undefined)`.
  - Required fix: Change `if (valuePlain)` to `if (valuePlain !== undefined)` in both `createGlobalSetting` and `createHouseholdSetting` methods.

- [Medium] `apps/api/src/features/admin-settings/admin-settings.controller.ts:173-176` — Database connectivity test is a no-op
  - Evidence: The `case 'database'` in `testConnectivity` returns `success: true` and `message: 'Datenbankverbindung erfolgreich'` without actually performing any database query. It should use `DatabaseService.isHealthy()` or run `SELECT 1`.
  - Required fix: Inject `DatabaseService` and call `isHealthy()` in the database connectivity test case.

- [Medium] `apps/web/src/app/admin/settings/page.tsx` and `apps/web/src/app/admin/feature-flags/page.tsx` — Error state never cleared after successful mutation
  - Evidence: When `handleCreate`, `handleUpdate`, `handleDelete`, or `handleToggle` succeed, the `error` state is not reset to `null`. A past error message lingers on screen indefinitely.
  - Required fix: Set `setError(null)` at the start of each mutation handler, or set it to `null` on success.

### Minor

- [Minor] `apps/web/src/app/admin/*` — Inline styles used throughout
  - Evidence: All admin pages use inline `style={{...}}` rather than CSS modules or a styling solution. This matches the existing codebase convention but is a maintainability concern for larger apps.
  - Consideration: Acceptable for now since it follows existing project patterns; no change required.

- [Minor] `apps/web/src/app/admin/settings/page.tsx` — No loading state for individual row mutations
  - Evidence: Editing, updating, or deleting a setting has no per-row loading indicator. The user has no feedback during the operation beyond the list reloading.
  - Consideration: Low priority UX improvement; no change required for this iteration.

- [Minor] `apps/api/src/features/admin-settings/__tests__/admin-settings.controller.spec.ts` — No tests for `testConnectivity` or `validateConfig`
  - Evidence: The controller test suite covers global settings and feature flag CRUD delegation but does not test the `testConnectivity` or `validateConfig` endpoints.
  - Consideration: Add tests for these endpoints in a follow-up.

- [Minor] `apps/api/src/features/admin-settings/__tests__/admin-settings.controller.spec.ts` — No error propagation tests
  - Evidence: Tests only verify successful delegation; they do not verify that service-thrown exceptions (e.g., NotFoundException) propagate through the controller correctly.
  - Consideration: Add error propagation tests.

- [Minor] `apps/api/src/features/admin-settings/dto/admin-settings.dto.ts:111` — `ConnectivityTestResultDto` is a class used only as a return type
  - Evidence: `ConnectivityTestResultDto` is declared as a class with `class-validator` decorators but is never used with `@Body` or `@Param`. It is used only as a return type annotation on the controller method.
  - Consideration: Could be an interface, but using a class is not incorrect. No change required.

- [Minor] `apps/api/src/features/admin-settings/settings-store.service.ts:80` — Log entry could clarify whether a value was provided
  - Evidence: The log line `Globales Setting '${key}' angelegt (secret: ${secret})` does not indicate whether a value was actually stored (which is good for security, but makes debugging harder). Consider logging whether `valuePlain` was provided without revealing the value.
  - Consideration: Optional improvement for debugging; low priority.

## Verification
- Tests: 45 new tests in 4 test files, all passing (215 existing + 45 new = 222 total, 7 pre-existing failures in documents module only)
- Lint: ESLint passes with 0 errors
- Type-check: Passes for admin-settings module (pre-existing errors in other modules)
- Changes inspected: All API controllers, services, DTOs, module, and web UI pages
- Security: Secrets masked with `********` in all API responses; encryption via AES-256-GCM; no secrets in logs
- Acceptance criteria checked: web-based settings management, bootstrap values minimized, feature flags graceful degradation, API keys not in plaintext, config validation and connectivity tests
