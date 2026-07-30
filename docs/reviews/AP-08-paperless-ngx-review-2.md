# AP-08-paperless-ngx Review 2

**Date**: 2026-07-30  
**Reviewer**: code-reviewer subagent

## Summary

- Critical: 0
- High: 0
- Medium: 0
- Minor: 5
- Verdict: PASS

## Findings

### [Minor] Module exports concrete PaperlessNgxService alongside the PAPERLESS_ADAPTER interface token
- **Fix**: Removed `PaperlessNgxService` from module exports and barrel index. Consumers should use `@Inject(PAPERLESS_ADAPTER)`.

### [Minor] Redundant API calls for tag names (N+1 when Paperless API v2 returns inline names)
- **Not fixed** (reasonable to defer - the current code handles both v1 number-only and v2 object formats safely).

### [Minor] Sequential foreign-key resolution in getDocumentMetadata instead of parallel
- **Fix**: Refactored to use `Promise.all` for correspondent, document_type, and tag resolution.

### [Minor] searchDocuments returns only the first page from Paperless API
- **Fix**: Added JSDoc documenting the single-page limitation.

### [Minor] Missing test for HTTPS protocol warning
- **Fix**: Added 3 tests verifying warning emission for HTTP URLs, no warning for HTTPS URLs, and no warning when disabled.

## Verification

- All 23 paperless-ngx tests pass.
- Lint: 0 errors.
- All acceptance criteria met: optional integration, graceful degradation, port/interface, error isolation, mock-based tests.
