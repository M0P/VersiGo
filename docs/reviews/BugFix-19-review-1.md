# BugFix-19 Review — Iteration 1

- Work package: BugFix-19 — fix `relaxedFetch` body serialization so the OIDC token-exchange POST (`URLSearchParams`) reaches the IdP; bump to 1.0.0-beta.4
- Review date: 2026-08-16
- Reviewer: code-reviewer subagent (DeepSeek), independent read-only review
- Reviewed against: the work package, project conventions, correctness/regressions, security, tests, maintainability

## Reviewer output (verbatim task result)

- Critical: 0
- High: 0
- Medium: 0
- Minor: 4
- Verdict: ACCEPT

Minors:

1. `apps/api/src/common/connectivity/relaxed-fetch.ts` — doc comment overstates that `ReadableStream` is "not used by openid-client"; the statement is not verifiable against openid-client's public contract and could go stale. Narrow the wording.
2. `apps/api/src/common/connectivity/__tests__/relaxed-fetch.spec.ts` — no test covers the `ArrayBuffer.isView` branch with a non-zero `byteOffset`/`byteLength` (the exact case introduced by `Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)`), and no test covers a caller-provided `content-length` header passing through unchanged.
3. `apps/api/src/common/connectivity/__tests__/relaxed-fetch.spec.ts` — the `payload.buffer as ArrayBuffer` cast is unnecessary; the raw `ArrayBuffer` body case can be tested without a cast (and the isView branch is what needs coverage).
4. `apps/api/src/common/connectivity/relaxed-fetch.ts` — `NormalizedBody.value` is loosely typed (`string | Buffer | null | undefined`); a discriminated union (`{ unsupported: true } | { unsupported: false; value?: string | Buffer }`) makes the unsupported case explicit and type-safe.

## Coordinator classification

0 Critical / 0 High / 0 Medium / 4 Minor — **ACCEPT with minors to fix**. All four minors are reasonable, safe fixes; fixing them before commit.

## Disposition

All four minors were fixed before iteration 2 (see `BugFix-19-review-2.md` and `BugFix-19-review-3.md`).
