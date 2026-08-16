# BugFix-19 Review — Iteration 2

- Work package: BugFix-19 — fix `relaxedFetch` body serialization so the OIDC token-exchange POST (`URLSearchParams`) reaches the IdP; bump to 1.0.0-beta.4
- Review date: 2026-08-16
- Reviewer: code-reviewer subagent (DeepSeek), independent read-only review
- Scope: delta only (fixes for the four round-1 minors)

## Reviewer output (verbatim task result)

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 0
- Verdict: CHANGES REQUESTED

## Findings

MEDIUM:
- `apps/api/src/common/connectivity/__tests__/relaxed-fetch.spec.ts:145-153` — subarray test byte math is wrong; the test as written cannot pass
  - Evidence: The backing string `'XX{"a":1}YY'` is **10** bytes (X,X,{,",a,:,1,},Y,Y), not 11. `subarray(2, 9)` returns bytes at indices 2..8 = `{`, `"`, `a`, `:`, `1`, `}`, `Y` → `'{"a":1}Y'` (7 bytes), **not** `'{"a":1}'` (which is 6 bytes). The assertion `expect(receivedBody).toBe('{"a":1}')` therefore fails against the actual wire body `'{"a":1}Y'`. The inline comment `// offset 2, length 7: '{"a":1}'` is internally inconsistent for the same reason. This contradicts the reported "688 tests PASS" — either the verification ran on different code or the suite is currently red. The production code (`Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)`) is correct; only the test's expected value is wrong.
  - Required fix: Change the call to `backing.subarray(2, 8)` (offset 2, length 6) and keep the expected body `'{"a":1}'`, updating the comment accordingly. Alternatively keep `subarray(2, 9)` and change the expected body to `'{"a":1}Y'`. If a 7-byte JSON payload is desired, use a 7-char JSON such as `'{"a":12}'` with backing `'XX{"a":12}YY'` (11 bytes) and `subarray(2, 9)`.

## Verification
- Reviewed both files in full (current state).
- Fix 1 (doc comment): line 96 now reads "not used by the app's OIDC flows" — accurate, no overstatement. ✓
- Fix 2 (tests): caller-provided content-length test (lines 156-175) is correct — `headers.has('content-length')` guard at `relaxed-fetch.ts:45` prevents override; GET test now asserts `contentLength` is undefined (line 93), consistent with `body.value === undefined`. ✓
- Fix 3 (cast removal): raw `new ArrayBuffer(7)` test (lines 118-135) is correct — `'payload'` is 7 bytes, `Buffer.from(rawBody)` yields the full range. ✓
- Fix 4 (discriminated union): `relaxed-fetch.ts:87-89` — `{ unsupported: true } | { unsupported: false; value?: string | Buffer }` is properly narrowed at lines 45 and 80. ✓
- Remaining risk: the subarray test (the core artifact of minor #2) is mathematically broken and would fail; the reported test-pass verification is inconsistent with the current tree.

## Coordinator disposition

The single Medium finding was investigated and is a **false positive**.

- The backing string in the reviewed file is `'XX{"a":1}YY'` = **11** characters, not 10: `{`, `"`, `a`, `"`, `:`, `1`, `}` (JSON object notation `{"a":1}` is 7 bytes, with the closing quote after `a`). The reviewer omitted the second `"` when counting.
- Empirically verified against the actual file (byte dump + Node): `subarray(2, 9)` yields exactly `'{"a":1}'` (7 bytes), matching the assertion. The test passed (`relaxed-fetch.spec.ts` 9/9; full API suite 59 files / 688 tests green; typecheck and lint green on the reviewed tree) — the "suite is currently red" claim does not match the verification runs.
- Remaining fixes 1, 2, 3, 4 were all confirmed correct by the reviewer (✓ items above).

### Mitigation (defense-in-depth)

The subarray test was rewritten to derive the indices from the expected payload instead of hard-coding them:

```ts
const expected = '{"a":1}';
const backing = new TextEncoder().encode(`XX${expected}YY`);
const payload = backing.subarray(2, 2 + expected.length);
expect(payload.byteOffset).toBe(2);
expect(payload.byteLength).toBe(expected.length);
expect(receivedBody).toBe(expected);
```

This keeps full coverage of the non-zero `byteOffset`/`byteLength` branch while removing any hand-counted byte math from the source, so the concern cannot recur. Re-verified after the rewrite: `relaxed-fetch.spec.ts` 9/9, full API suite 59 files / 688 tests, typecheck OK, lint OK.
