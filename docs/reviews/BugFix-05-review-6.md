# BugFix-05 Review 6 (findings #1–#8, round 4)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_02e9d5078ffelSN64GYdKxs4Mf`), 2026-08-05.

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: **READY TO MERGE**

## Round-3 findings — verification status

### Round-3 Finding 1 (Medium) — `/ready` HTTP 500 when DB down → **VERIFIED RESOLVED**
- `packages/foundation/src/health/health.controller.ts:58-65` — `capabilities.snapshot()` is now called **separately** from the sibling checks and wrapped in its own try/catch with `let capabilities: Record<string, boolean> = {}` default. There is no unhandled rejection path left in `ready()`: the remaining `Promise.all` (lines 45-49) contains only `db.isHealthy()` (`database.service.ts:29-36`, catches → `false`), `redisHealth.isHealthy()` (`redis-health.service.ts:22-29`, catches → `false`), and `workerHeartbeat.getStatus()` (`worker-heartbeat.service.ts:118-142`, catches → `'unknown'`) — all fail-soft.
- Return type annotation (lines 38-44) is unchanged; `{}` satisfies `Record<string, boolean>`.
- Existing spec cases (lines 41-86, 110-140) are unchanged and still consistent.
- New spec case `health.controller.spec.ts:88-108` ("liefert status degraded statt 500, wenn der Capability-Snapshot fehlschlaegt (DB down)") correctly asserts `status='degraded'`, `database='down'`, and `capabilities === {}` when `snapshot` rejects — it exercises the actual fail path rather than masking it.

### Round-3 Finding 2 (Minor) — form reset on policyId change + unguarded setFormError → **VERIFIED RESOLVED**
- All three tabs reset form state in the effect body **before** reload: `covered-persons-tab.tsx:78-87`, `documents-tab.tsx:80-89`, `portal-links-tab.tsx:84-93` — each sets `setShowForm(false)`, clears `editingId`/`file`, resets the `form` object, and `setFormError(null)`.
- `handleSubmit` captures `const seq = requestSeq.current;` **before** the awaits (covered-persons-tab.tsx:96, documents-tab.tsx:102, portal-links-tab.tsx:102) and the catch only calls `setFormError` when `seq === requestSeq.current` (covered-persons-tab.tsx:130-132, documents-tab.tsx:125-127, portal-links-tab.tsx:138-140). The seq **read** (not increment) is correct — the reload functions perform the increment.
- Pattern is identical across all three tabs. No legitimate submit error is swallowed: the only case skipped is after a policyId change, which is the intended behavior (A's error must not render under B). No lint risk (exhaustive-deps not registered; deps `[policyId]` with explanatory comment).

### Round-3 Finding 3 (Minor) — page-level fetch no reset/seq-guard → **VERIFIED RESOLVED**
- `apps/web/src/app/policies/[id]/page.tsx:74-94` — the effect now calls `setPolicy(null)` / `setLoading(true)` at the start and uses a `cancelled` flag (set to `true` in cleanup) guarding **every** setState on the async path: `.then` data branch (line 90), `.catch` (line 91), `.finally` (line 92), plus the 401 branch returns `null` (line 86) so no policy write occurs. `cancelled` prevents setState after unmount on all paths.
- Deps still `[policyId, t]` — acceptable per scope (t-triggered reload is a pre-existing, harmless behavior).

### Round-3 Finding 4 (Minor) — portal-URL normalization untested → **VERIFIED RESOLVED**
- DTO transform `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts:26-37` (`PortalUrlTransform`) produces exactly the asserted values: schema-less input gets `https://` prepended (regex requires `://` to consider a schema present), http(s) unchanged; `@IsUrl({ protocols: ['http','https'], require_protocol: true })` + `@MaxLength(2048)` follow directly behind (lines 229-236, 272-279 on both Create and Update DTOs).
- `main.ts:22` has `transform: true` in the global `ValidationPipe`, so the transform runs during `plainToInstance` **before** `validate()` at runtime — the spec's ordering (`plainToInstance` then `validate`) mirrors this.
- Spec `policy-registry.dto.spec.ts:99-158` — new cases assert the transformed value on the instance (lines 107, 115, 122), `validate()=0` errors, `javascript:`/`data:` rejection after normalization (lines 126-142), and the exact `@MaxLength` message on both DTOs (lines 144-158). Assertions are correct.
- Client helper `apps/web/src/lib/portal-url.ts` + 5-case spec `apps/web/src/__tests__/portal-url.spec.ts` (covers prepend, trim, http(s) unchanged, other schemes left to server, empty). The tab imports it (`portal-links-tab.tsx:13`) and uses it at line 109. Grep confirms **no** leftover duplicate definition of `normalizePortalUrl` anywhere else.

## Re-verification of earlier rounds (no regressions found)
- **OIDC/identity DB-down fallback:** `oidc.strategy.ts:64-79` and `identity.module.ts:48-63` still wrap `isEnabled` in try/catch with env-snapshot fallback; both spec cases (`oidc.strategy.spec.ts:163-203`) unchanged and consistent. Fail-fast only when both methods disabled (line 65-75) — not triggered while local auth is active.
- **Delete-error seq guards:** present in all three tabs (`covered-persons-tab.tsx:153-163`, `documents-tab.tsx:138-148`, `portal-links-tab.tsx:162-172`), unchanged.
- **app-shell.tsx /ready capability effect** keyed on `[pathname]` (`app-shell.tsx:58-74`), cancelled-guard and `.catch → true` fallback intact, unchanged.
- **costs.perYear i18n** usage intact (`costs/page.tsx:175`).

## New findings
- [Minor] `apps/web/src/app/policies/[id]/{covered-persons,documents,portal-links}-tab.tsx` — submit/delete **success path** reload is not seq-guarded and re-fetches the *stale* policyId
  - Evidence: `covered-persons-tab.tsx:128,160`, `documents-tab.tsx:123,145`, `portal-links-tab.tsx:136,169` call `reloadPersons()/reloadDocuments()/reloadLinks()` unconditionally after a successful POST/PATCH/DELETE. The reload function is a closure over the render-time `policyId`. If the user navigates A→B while the request is in flight, the effect cleanup increments `requestSeq`, but the success path never checks `seq === requestSeq.current`; the stale closure then does `++requestSeq.current`, fetches **policy A's** data, and — since no newer load intervenes — writes A's list into the shared state (`if (seq === requestSeq.current) setPersons(...)`). Result: A's data transiently displayed under `/policies/B`, exactly the "keine stale Daten von A unter B" acceptance criterion that the round-3 page.tsx fix guards against.
  - Required fix: on the success path, guard before reloading, e.g. `if (seq !== requestSeq.current) return;` (or compare the captured policyId against the current one), so the stale closure cannot trigger a fetch for the old policy; the new policy's mount effect already loads its own data.

## Scope check
- **PASS.** Every change inspected maps to findings #1–#8 of the work package and the round-3 review-driven fixes. Finding #9 (Dockerfiles/compose-smoke, committed in e1ca357) is untouched. No scope creep found in the reviewed files. (Full `git diff` was not inspectable without a shell; the review covered every file named in the round-4 verification list plus supporting modules/specs.)

## Acceptance condition
- Met: **0 Critical / 0 High / 0 Medium / 1 Minor** (≤ 8 Minor). All four round-3 findings verified resolved; one new Minor finding (transient stale-data race on the tab submit/delete success path) is non-blocking and can be fixed in a follow-up pass.

## Verification
- Tests/checks reviewed: `health.controller.spec.ts` (new snapshot-rejection case + all pre-existing cases), `policy-registry.dto.spec.ts` (new transform/security/length cases), new `portal-url.spec.ts`, `oidc.strategy.spec.ts` DB-down cases, capability-flags service spec references. The Docker Compose gate (build 4/4, lint 3/3, typecheck, 590 API + 47 web tests, i18n guard) was reported green and trusted per instructions, not re-run.
- Important areas inspected: health controller fail-soft completeness (all three sibling checks confirmed catching), DTO transform ordering vs. `transform: true` ValidationPipe, form-reset + seq-guard consistency across all three tabs, page.tsx cancelled-flag coverage, app-shell pathname effect, OIDC/identity boot fallbacks, i18n key usage, no duplicate `normalizePortalUrl`.
- Remaining risks: the Minor submit/delete success-path race above; otherwise none material.
