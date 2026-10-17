# BugFix-22 Review – Round 1

> **Process deviation (recorded deliberately):** This review was supposed to be
> performed by the `code-reviewer` subagent (model
> `opencode/deepseek-v4-flash-free`). Three invocation attempts failed with
> `Model unavailable: opencode/deepseek-v4-flash-free`. Per explicit user
> instruction ("try again, otherwise do the review yourself"), the review below
> was performed manually by the coordinating agent. It follows the same review
> criteria (work package conformance, conventions, correctness/regressions,
> security, tests, maintainability), but it is **not** an independent third-party
> review. This limitation carries over into the final report.

**Scope reviewed:** all uncommitted changes on branch `fix/policy-delete-ui`
(BugFix-22 original scope + Extension A "AI functions unavailable"), against
`prompts/BugFix-22-ui-ux-documents-masterdata-costs-persons.md`.

**Validation basis:** full Docker Compose test gate (lint + typecheck +
tests + `prisma migrate deploy`) green: web 141, foundation 107, worker 48,
api 805 tests, exit code 0.

---

## Findings

### [Medium] 1 – `docs/end-user-guide.md`: existing Paperless troubleshooting row was replaced, not extended

`docs/end-user-guide.md` (section 11, Troubleshooting). The new AI-troubleshooting
row was inserted by *replacing* the pre-existing row

> `| Tag search finds nothing, or creating a tag fails with *"the tag could not
> be created in Paperless"* | ... |`

so the documented failure mode for Paperless tag search/tag creation is now
missing from the end-user guide. This is a documentation regression unrelated to
the work package's intent (which was to *add* an AI explanation). Both rows must
coexist.

**Status: fixed in round 1 (row restored, AI row kept).**

### [Minor] 2 – i18n reason strings rely on leading spaces for concatenation

`apps/web/src/i18n/locales/de.ts` / `en.ts` (`ai.reason*`): every reason string
starts with a hard-coded leading space so that plain concatenation in
`coverage-summary-section.tsx` reads correctly. This mirrors the existing
`ai.unavailableConfig`/`unavailableProvider` pattern, so it follows the project
convention, but it is fragile (a translator trimming whitespace produces a
missing separator). **Accepted as-is (consistent with existing convention).**

### [Minor] 3 – Fallback health probe can incur a small provider cost

`apps/api/src/features/ai-assist/openai-compat.adapter.ts`
(`probeCompletionFallback`): when a provider does not implement `GET /models`,
the health check falls back to a minimal `POST /chat/completions` ("ping").
Providers that meter tokens may bill a tiny amount per probe after the 60 s
memo window expires. Mitigated by the 5 s timeout, the 60 s reuse window and the
minimal payload; deliberately accepted (the alternative is reporting a healthy
provider as down). **Accepted as-is.**

### [Minor] 4 – Name sorting hard-codes the `de` locale

`apps/web/src/lib/documents-view.ts` (`compareNames`): collation uses
`localeCompare(..., 'de', ...)`. The web app also supports English (AP-21);
German collation for file names under an English UI is a negligible practical
difference (numeric + base-sensitivity), and using the ambient locale would make
the sort order machine-dependent for the unit tests. **Accepted as-is.**

### [Minor] 5 – Runtime verdict runs on every AI connectivity test

`apps/api/src/features/system-config/system-config.service.ts`
(`aiRuntimeVerdict`): every admin "Test" click on an AI key additionally performs
a live adapter health check (up to 5 s probe timeout, potentially + one minimal
completion). Admin-triggered and infrequent; the alternative would reintroduce
the misleading "HTTP 200: OK" verdict. **Accepted as-is.**

### [Minor] 6 – New end-user troubleshooting row is very technical

`docs/end-user-guide.md`: the AI row enumerates all six reason codes and settings
keys, which is dense for end users. Acceptable for a self-hosted product whose
admins read this guide; the coverage-summary panel itself shows only the
human-readable hint. **Accepted as-is.**

---

## Explicitly verified as correct (no findings)

- **Schema/migration** (`prisma/schema.prisma`,
  `20261017130000_bugfix22_cost_amount_optional_covered_subjects`): additive only
  (`DROP NOT NULL`, new enum with `PERSON` default); applies cleanly and matches
  the schema (`prisma migrate deploy` green in the gate).
- **Cost "gross OR net"**: service enforces the rule on create *and* update
  (partial updates resolve against the existing row); `effectiveAmount` is the
  single calculation basis; audit records keep `null` instead of coercing to 0;
  privacy export serialises `null`; the Web edit form sends `null` only for
  changed amounts, and `@IsOptional()` correctly passes `null` through
  class-validator/class-transformer to Prisma.
- **Covered subjects**: `subjectType` defaults to `PERSON` on create; empty
  relation is trimmed to `null`; birth date is cleared (`null`) when a subject is
  switched to `OBJECT` (API treats explicit `null` as clear, `undefined` as
  unchanged); privacy export includes `subjectType`; UI icon has an accessible
  name (`role="img"` + `aria-label`).
- **Documents tab**: sorting is copy-based and stable; undated documents sort
  last in both date directions; the Paperless deep-link text is gone (button
  remains the single entry point); the origin icon keeps an accessible name and a
  tooltip explaining auto-managed assignments.
- **Portal link**: `insurerPortalUrl` removed from new/edit/detail; legacy value
  pre-fills the portal-link mask; no destructive migration.
- **AI health (Extension A)**: keyless OpenAI-compatible operation implemented in
  both API and worker adapters; `Authorization` header omitted when no key is
  configured; reasons are a closed, coarse enum — no URLs, hostnames, response
  bodies or credentials reach the UI, the admin test message or logs
  (verified for `classifyAiHealthError`, the adapter probes and
  `aiRuntimeVerdict`); SSRF guard still runs before every endpoint probe;
  module import `SystemConfigModule → AiAssistModule` is one-directional (no
  cycle); monitoring still reads only `{enabled, provider, connected}` and is
  structurally compatible with the extended health result.
- **Tests**: new behaviour is covered (adapter probes incl. fallback, memo,
  timeout, unauthorized; error classification; service reason mapping; NoOp
  `not-configured`; system-config cross-check incl. downgrade, secret-freedom and
  non-AI-key exclusion; Web sorting/origin/cost-amount/subject-type guards).
- **Scope**: no unrelated features; no other work package started.

## Summary verdict

**Not acceptable as-is in round 1** (1 Medium). After the fix (restore the
Paperless troubleshooting row): **0 Critical / 0 High / 0 Medium / 6 Minor** –
within the acceptance condition (0/0/0/≤8). All Minor findings are deliberately
accepted as documented above.
