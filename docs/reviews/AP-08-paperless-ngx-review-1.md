# AP-08-paperless-ngx Review 1

**Date**: 2026-07-30  
**Reviewer**: code-reviewer subagent

## Summary

- Critical: 0
- High: 0
- Medium: 2
- Minor: 4
- Verdict: CHANGES REQUIRED

## Findings

### [Medium] `apps/api/src/features/paperless-ngx/paperless-ngx.module.ts:8-16` — PAPERLESS_ADAPTER token always resolves to NoOp adapter

The provider factory unconditionally returns `new NoOpPaperlessAdapter()`. No mechanism exists for a consumer injecting `@Inject(PAPERLESS_ADAPTER)` to ever receive the real adapter.

**Fix**: Made the factory conditional using CapabilityFlagsService to return PaperlessNgxService when enabled, NoOpPaperlessAdapter when disabled.

### [Medium] `dependency-policy.md:35-40` — Dependency policy documents different versions than actually installed

Policy records `@nestjs/axios ^3.1.0` and `axios ^1.7.0`, but `^4.0.1` and `^1.18.1` are installed.

**Fix**: Updated policy to reflect actual installed versions.

### [Minor] `paperless-ngx.service.ts:52-54` — Uses AppConfigService directly instead of CapabilityFlagsService

**Fix**: Replaced with `CapabilityFlagsService.isEnabled('paperless')`.

### [Minor] Missing test coverage for disabled-state of getDocumentMetadata and searchDocuments

**Fix**: Added two test cases for disabled state.

### [Minor] `@Global()` on feature module makes HttpModule globally available

**Fix**: Removed `@Global()` from the feature module.

### [Minor] No HTTPS validation warning for Paperless URL

**Fix**: Added startup warning when URL does not use HTTPS.
