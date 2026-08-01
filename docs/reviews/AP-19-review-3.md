# AP-19 Review — Round 3

- Date: 2026-08-01
- Reviewer: code-reviewer subagent (read-only)
- Scope: final confirmation — verification of the Round-2 Minor fix (smoke step 8f port), regression check
- Status: PASS

## Result (verbatim)

All verification checks are complete. Let me compile my final review.

## Analysis Summary

**Fix verification (step 8f):**
- `scripts/compose-smoke-test.sh:431` — the in-container probe now reads `process.env.WORKER_HEALTH_PORT || '3100'`, exactly mirroring the compose healthcheck at `docker-compose.yml:170`.
- The worker container receives `WORKER_HEALTH_PORT` via `docker-compose.yml:154` (`WORKER_HEALTH_PORT: "${WORKER_HEALTH_PORT:-3100}"`), so `$COMPOSE exec -T worker node -e "..."` executes inside the worker container where the env var is present — matching how the healthcheck resolves the port. Correct and consistent.
- Fallback default `3100` is consistent everywhere: `app-config.schema.ts:77` (`.default(3100)`), `settings-catalog.ts:552` (`defaultValue: 3100`), `.env.example:114`, and the compose default `:-3100`.
- Echo text at line 429 updated to `WORKER_HEALTH_PORT/health`; comment at 428 updated. Correct.
- Quoting is safe: the JS has no `$` characters, so no bash interpolation risk inside the double-quoted `node -e` string; single quotes inside are fine.
- Exit-code handling: node exits 0 only on HTTP 200, the `|| { ... }` failure branch under `set -euo pipefail` correctly reports and dumps worker logs. Liveness payload `{"status":"ok"}` matches the grep at line 443.

**No new issues since Round 2:** The only change since Round 2 is the smoke-test step 8f fix. All Round-1 fixes are still in place: env-based compose healthcheck (docker-compose.yml:170), atomic audit-write comment + ADR-008 (privacy.service.ts:307-324), stale-heartbeat pruning (worker-heartbeat.service.ts:40,60,70-81), 403 negative tests in both `audit.controller.spec.ts:20-49` and `monitoring.controller.spec.ts:29-56`, and the TOCTOU residual-risk documentation (ADR-008:112).

**Diff spot-check:** `packed-refs` confirms branch `feat/AP-19-audit-privacy-monitoring` with `origin/main` at 7050ad3; no stray port references remain in compose files (only the env-driven ones), and no other `.yml` hardcodes `3100`.

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Findings
- No findings.

## Verification
- **Smoke test fix (step 8f):** Verified `scripts/compose-smoke-test.sh:429-444` — probe derives the port from the in-container `WORKER_HEALTH_PORT` env with `3100` fallback, mirroring `docker-compose.yml:170` byte-for-byte in port logic; echo/comment text updated; quoting and exit-code handling correct under `set -euo pipefail`.
- **Consistency matrix:** `app-config.schema.ts:77`, `settings-catalog.ts:544-557`, `.env.example:114`, and `docker-compose.yml:154` all agree on default 3100; the worker liveness server binds `0.0.0.0` (`worker-liveness.service.ts:46`), so `127.0.0.1` probing from inside the container is valid.
- **Regression check:** All Round-1 fixes confirmed present and unchanged (compose healthcheck env-driven; privacy.service.ts atomic audit comment; heartbeat pruning; 403 controller specs; ADR-008 TOCTOU paragraph). The only code change in this round is the step 8f fix.
- **Checks trusted (per instructions):** full canonical docker-compose.test.yml suite (lint, typecheck, 506 API tests) and `compose-smoke-test.sh --build` run twice — all green.
- **Remaining risks:** The previously documented (Round 2) symlink-following caveat in `removeFileSafely` remains theoretical and out of scope for this round's change; no new risk introduced.
