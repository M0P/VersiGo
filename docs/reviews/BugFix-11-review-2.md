# BugFix-11 Review – Iteration 2

**Date:** 2026-08-09
**Package:** `prompts/BugFix-11-release-readiness.md`
**Branch:** `fix/BugFix-09-ci-fix-community-standards-dockerhub`
**Reviewer:** DeepSeek code-reviewer subagent (Task tool)
**Verdict:** PASS
**Counts:** Critical 0 / High 0 / Medium 0 / Minor 1

---

## Review result (verbatim)

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: PASS

## Findings

- [Minor] `apps/worker/src/ai-extraction.processor.ts:214-237` — allowlist comment added to only one of the two adapters with German LLM prompts
  - Evidence: The English allowlist comments (lines 88-93 and 112-113) were added above the German prompts in `WorkerOllamaAdapter`, but the identical German prompt strings in `WorkerOpenAiCompatAdapter` (`extractContractFacts` lines 214-221, `summarizeCoverage` lines 232-237) have **no** such comment. Both adapters are intentional allowlist entries (functional LLM prompts requesting German output, transliterated without umlauts), so the documentation is inconsistent: a future umlaut-grep verification would flag the OpenAI-compat prompts without the explanatory comment, and the "documented allowlist" claim in the work package (item 6) is only half-true.
  - Required fix: add the same English allowlist comment above the German prompts in `WorkerOpenAICompatAdapter` (lines 214 and 232), mirroring the Ollama adapter wording.

## Verification

**Fix 1 — ai-extraction processor comments (verified, one gap):**
- `apps/worker/src/ai-extraction.processor.ts:88-93` and `112-113`: English comments are accurate — they correctly document the prompts as intentional allowlist entries (functional LLM prompts requesting German output, transliterated without umlauts). Verified the prompts contain no umlauts (`gueltiges`, `praegnante`, `Vertraege`) so the "not caught by the umlaut-grep" claim holds.
- The prompt strings themselves were **not** translated — they remain German in both adapters (lines 94-101, 114-119, 214-221, 232-237), preserving the German-summary feature. The only gap is the missing comment on the OpenAI-compat adapter (see finding).

**Fix 2 — checklist test counts:** `docs/beta-release-checklist.md:19` reads "660 API-Tests, 58 Test-Files, Web 47, Worker 4, Foundation 107" — matches the requested text and the verified container state.

**Fix 3 — vitest version:** `docs/beta-release-checklist.md:29` and `:68` both say "vitest 3.2.x", consistent with `docs/release-notes-v1.0.0-beta.1.md:74-75` ("vitest 3.2.x everywhere" / "vitest 3.2.x in api/web/foundation/worker") and the manifests (`"vitest": "^3.2.6"` in all four `package.json` files — verified).

**@IsUrl decorator restored:** `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts:240-241` (`CreatePortalAccountLinkDto.portalUrl`) and `:283-284` (`UpdatePortalAccountLinkDto.portalUrl`) both carry `@IsUrl({ protocols: ['http', 'https'], require_protocol: true })` with `@PortalUrlTransform()` + `@MaxLength(2048)`, identical to the sibling policy DTOs (lines 50, 120).

**Round-1 findings re-checked (all fixed):**
- Probe-cache pinning: `paperless-ngx.service.ts:154-163` now returns `DEFAULT_DIALECT` without caching on a null probe and logs a warning; `probeDialect` returns `null` on non-406 errors (line 184). New spec test at `paperless-ngx.service.spec.ts:438-472` covers the re-probe behavior.
- Translation sweep: `oidc.strategy.ts`, `app-shell.tsx`, `use-current-user.ts`, `middleware.ts`, `portal-url.ts` are all English now (no umlauts). Remaining umlauts in `apps/api` are only in `portal-catalog.ts:132,135` (user-visible display name/description — allowlisted) and i18n/test files.
- `insura` URLs: `CONTRIBUTING.md:15,36-38` and `SECURITY.md:24` now use `M0P/VersiGo`.
- Double `resolveDialect`: `searchDocuments` (line 373) resolves once and passes the dialect explicitly to `get()` (line 378).

**Tooling note:** No shell/bash or git tooling was available; all verification was done by reading files directly. The working-tree state was reviewed as-is.

**Remaining risks:** None beyond the single Minor. The probe-on-every-call behavior during a Paperless outage (each `searchDocuments` re-probes before failing) is documented behavior, not a defect.

## Verification
- Tests/checks reviewed: `paperless-ngx.service.spec.ts` (dialect tests incl. new transient-probe test), `ai-extraction.processor.spec.ts` (no German prompt assertions), package.json vitest constraints, release notes, checklist, DTO decorators.
- Important areas inspected: worker AI adapters, Paperless dialect negotiation, policy-registry DTOs, CONTRIBUTING/SECURITY rename fallout, web translation sweep, checklist/release-notes consistency.
- Remaining risks: none material.

---

## Resolution of findings (after this review round)

The single Minor finding was fixed in a follow-up edit (not re-reviewed in a separate review round):
- `apps/worker/src/ai-extraction.processor.ts`: added the identical English allowlist comment above the German LLM prompts in `WorkerOpenAiCompatAdapter.extractContractFacts` and `.summarizeCoverage`, mirroring the `WorkerOllamaAdapter` wording.

## Post-fix verification (executed in the test container)

- `pnpm run lint`: 3/3 tasks successful
- `pnpm run typecheck`: 4/4 tasks successful
- `pnpm run test`: 5/5 tasks successful (API 58 files / 660 tests, web 47, foundation 107, worker 4)
- i18n guard: OK

Acceptance condition met: 0 Critical / 0 High / 0 Medium / ≤ 8 Minor (1 Minor, fixed).
