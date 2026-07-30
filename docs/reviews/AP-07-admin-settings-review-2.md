# Review 2: AP-07-admin-settings

**Reviewer:** opencode/big-pickle (manual review)
**Commit / state:** uncommitted changes (all admin-settings files untracked except `admin-settings.module.ts` which is staged)
**Date:** 2026-07-30

## Summary

| Severity | Before | After |
|----------|--------|-------|
| Critical | 0 | 0 |
| High     | 0 | 0 |
| Medium   | 3 | 0 |
| Minor    | 6 | 6 |

All three Medium findings from review 1 have been fixed. Six Minor findings remain — none are regressions from the fixes.

---

## Critical (0)

None.

---

## High (0)

None.

---

## Medium (0)

All three Medium findings have been resolved:

### ~~M1 (Medium): Empty string `""` treated as falsy~~ ✅ Fixed

**File:** `settings-store.service.ts:68, 102, 198, 240`

Changed `if (valuePlain)` to `if (valuePlain !== undefined)` in `createGlobalSetting`, `createHouseholdSetting`, `updateGlobalSetting`, and `updateHouseholdSetting`. Empty string `""` is now correctly treated as a valid value.

### ~~M2 (Medium): Database connectivity test is a no-op~~ ✅ Fixed

**File:** `admin-settings.controller.ts:173-176`

- Injected `DatabaseService` into the controller constructor.
- Replaced the no-op `result.success = true` with a real `await this.db.isHealthy()` call.
- Returns `success: true` only when the database reports healthy.
- Added two new tests verifying this behavior (`testConnectivity mit database ruft isHealthy auf` and `testConnectivity mit unbekanntem Key ohne Endpoint gibt Fehler`).

### ~~M3 (Medium): Error state never cleared after successful mutation~~ ✅ Fixed

**Files:** `apps/web/src/app/admin/settings/page.tsx`, `apps/web/src/app/admin/feature-flags/page.tsx`

Added `setError(null)` before every mutation handler (`handleCreate`, `handleUpdate`, `handleDelete`, `handleToggle`). This ensures stale errors are cleared on the next successful operation.

---

## Minor (6)

Unchanged from review 1. None are regressions from the Medium fixes.

| ID | Severity | Finding | File | Notes |
|----|----------|---------|------|-------|
| m1 | Minor | `logger` property unused after conversion to `@Logger()` decorator | `settings-store.service.ts` | Low severity, no behavioral impact |
| m2 | Minor | Error messages hardcoded in German while codebase uses mixed English/German | `settings-store.service.ts`, `feature-flags.service.ts`, `admin-settings.controller.ts` | Convention across existing code is mixed; consistent change would be a separate refactoring |
| m3 | Minor | Some DTO classes omit `@ApiProperty` decorators used elsewhere in the API | `dto/admin-settings.dto.ts` | Swagger docs partial but not worse than other modules |
| m4 | Minor | Test: `describe` blocks prefix with German "sollte" vs "should" | `__tests__/*.spec.ts` | Matches existing conventions in the codebase |
| m5 | Minor | Several web UI pages contain inline `fetch()` calls instead of a shared API client | `apps/web/src/app/admin/*/page.tsx` | Consistent with existing web pages; not introduced here |
| m6 | Minor | No E2E tests for admin UI pages | (no file) | E2E testing is outside the current test infrastructure |

---

## Lint, Type-check, Tests

| Check | Status | Details |
|-------|--------|---------|
| Lint (API) | ✅ Pass | 0 errors |
| Lint (Web) | ✅ Pass | 0 errors |
| Tests (admin-settings) | ✅ Pass | 47/47 pass (controller 13, settings-store 18, feature-flags 12, household-isolation 4) |
| Tests (API all) | ⚠️ 7 pre-existing failures | All 7 in `documents` module — none related to admin-settings |
| Type-check (API) | ⚠️ Pre-existing errors | All in `documents`, `cost-tracking`, `identity` modules — none related to admin-settings |
| Type-check (Web) | ⚠️ Pre-existing error | `policies/[id]/costs/page.tsx:66` — unrelated to admin-settings |

**Conclusion:** All changes pass lint and all 47 new admin-settings tests pass. No regressions introduced. The acceptance condition is met (0 Critical, 0 High, 0 Medium, 6 Minor).

---

## Remaining Minor Findings Notes

The six Minor findings are low-impact and consistent with the existing codebase conventions. They do not block acceptance.
