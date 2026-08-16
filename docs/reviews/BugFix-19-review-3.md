# BugFix-19 Review — Iteration 3 (final)

- Work package: BugFix-19 — fix `relaxedFetch` body serialization so the OIDC token-exchange POST (`URLSearchParams`) reaches the IdP; bump to 1.0.0-beta.4
- Review date: 2026-08-16
- Reviewer: code-reviewer subagent (DeepSeek), independent read-only review
- Scope: delta from round 2 (rewritten subarray test)

## Reviewer output (verbatim task result)

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Findings

CRITICAL:
- None.

HIGH:
- None.

MEDIUM:
- None.

MINOR:
- None.

## Verification

**Rewritten subarray test (`relaxed-fetch.spec.ts:137-160`) — verified correct and unambiguous:**
- `expected = '{"a":1}'` is 7 characters (`{`, `"`, `a`, `"`, `:`, `1`, `}` — the closing quote after `a` is present, confirming the round-2 Medium was a miscount false positive).
- `backing = 'XX{"a":1}YY'` is 11 bytes; `subarray(2, 2 + expected.length)` = `subarray(2, 9)` covers indices 2..8 = exactly `{"a":1}` (7 bytes).
- Assertions are internally consistent and self-deriving: `payload.byteOffset === 2` (the intended non-zero offset), `payload.byteLength === expected.length` (7), and `receivedBody === expected` (wire-level confirmation). No hand-counted byte math remains that could drift.
- Cross-checked against production code: `relaxed-fetch.ts:111-117` (`ArrayBuffer.isView` → `Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)`) copies exactly the view's 7 bytes; `content-length` at line 46 is derived from that Buffer, so the server receives precisely `{"a":1}`. The test exercises the non-zero `byteOffset`/`byteLength` branch end-to-end.

**No new findings introduced by the rewrite.** The only theoretical fragility (using `expected.length`, a UTF-16 code-unit count, as a byte length) is moot for this pure-ASCII payload and would be a hypothetical, not an evidence-based defect.

**Remaining work-package delta:** `relaxed-fetch.ts` is unchanged from round 2 (all four round-1 minors confirmed fixed; `URLSearchParams` normalization, content-length guard, discriminated union all correct). The other 8 spec tests are unchanged and consistent with the implementation. `docs/reviews/BugFix-19-review-2.md` accurately documents the false-positive disposition and the mitigation.

**Checks reviewed:** full spec file (216 lines), `relaxed-fetch.ts` (120 lines), review-2 doc. Coordinator verification (typecheck PASS, lint PASS, 59 files / 688 tests PASS incl. 9/9 relaxed-fetch) is consistent with the current tree.

**Remaining risks:** none material. The `2` offset in `subarray(2, ...)` is still a literal tied to the `XX` prefix, but it is the intended non-zero offset under test and is asserted explicitly, so it cannot silently drift.

ACCEPT

## Coordinator verification (final tree, after round-3 delta)

- API typecheck: PASS
- API lint: PASS
- API unit tests: 59 files / 688 tests PASS (incl. 9/9 `relaxed-fetch.spec.ts`)
- Full compose gate (`docker compose -p versigo-test -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test`): exit 0, "All checks passed!" — lint 4/4, typecheck 4/4, 688 API tests, license check (578 packages) OK, version-sync OK ("1.0.0-beta.3"), i18n guard OK (54 files)

## Acceptance condition

0 Critical / 0 High / 0 Medium / 0 Minor — met. **ACCEPTED** for commit.
