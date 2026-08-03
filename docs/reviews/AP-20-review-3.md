# AP-20 Review – Round 3 (2026-08-03)

Reviewer: @code-reviewer (read-only subagent, invoked via Task tool)
Verdict: CHANGES REQUIRED
Counts: 0 Critical, 0 High, 2 Medium, 8 Minor

## Findings

**1. [Medium] `docs/docker-image-guide.md:120-144` (+ `README.md:41-54`, `.env.example:25,75-87`) — Documented beta/deploy path never requires `NODE_ENV=production`; the security guarantees stated in §5 do not hold for the documented install steps**
- Evidence: §5 "Deploy (Frische Installation)" instructs `cp .env.example .env` + `docker compose up --build -d` and then asserts "Der initiale Administrator wird **niemals automatisch** angelegt" and "der `.env.example`-Platzhalter ... wird in Produktion abgelehnt". However, `.env.example` sets `NODE_ENV=development`, `LOCAL_AUTH_ENABLED=true` and the placeholder password. Following the documented steps therefore starts the stack in development mode where `LOCAL_AUTH_ENABLED` defaults to `true` (app-config.schema.ts:170) and the placeholder password is **accepted** (`local-admin.bootstrap.ts:84-94` only rejects it when `isProduction`). This is exactly the "automatisch angelegter Default-Admin / Platzhalter-Passwort" scenario AP-20 P5 (line 62) forbids in productive operation. The guide never tells the operator to set `NODE_ENV=production`.
- Required fix: Add an explicit step in §5 (and in the beta-install path of README) "NODE_ENV=production setzen" before `docker compose up`, and state that the placeholder-rejection / no-auto-admin / fail-fast guarantees apply only when `NODE_ENV=production`.

**2. [Medium] `scripts/compose-smoke-test.sh:41-45,81-116,999-1018` — Smoke test verifies only the failure path in production; the production success path is never exercised**
- Evidence: The smoke script copies `.env.example` (NODE_ENV=development) to `.env` and runs the whole stack with it, so steps 1–10 verify the **development** runtime. `NODE_ENV=production` is only used in step 11, which asserts the *refusal to start* (fail-fast). The AP-20 acceptance criterion "Produktionsimages ... starten im Compose-Produktionspfad erfolgreich" and P4's "frische Installation ... muss die dokumentierte Beta-Installation nachvollziehen" are therefore not verified end-to-end for the production runtime (cookie `Secure` flag, bootstrap rejection semantics, HOSTNAME binding, etc.). The CI `compose-smoke` job (`.github/workflows/ci.yml:60-61`) has the same issue.
- Required fix: Run the smoke stack with `NODE_ENV=production` (using a generated strong `LOCAL_ADMIN_PASSWORD`, not the placeholder) so the production success path including admin bootstrap, login and household actions is verified; or document the measured dev-mode limitation explicitly and add a dedicated production-mode pass.

**3. [Minor] `docs/ui-control-matrix.md:131` vs `docs/beta-release-checklist.md:19` / `PR_DESCRIPTION.md:114` — contradictory test counts (589 vs 593 API tests)**
- Evidence: The round-3 change updated the checklist and PR to "593 API-Tests (55 Files)", but the control matrix still states "55 Test Files, 589 Tests". Both documents are release artifacts and must agree.
- Suggested fix: Align the control matrix count with the actual test run and the other two documents (or verify the true number once).

**4. [Minor] `scripts/compose-smoke-test.sh:56-64` — cleanup comment claims "exakte Artefaktliste", but implementation is still a prefix glob; parallel runs are not actually protected**
- Evidence: `rm -f /tmp/versigo-smoke-* ...` still deletes any file with that prefix (the round-2 change only narrowed `/tmp/versigo-*` to `/tmp/versigo-smoke-*`), and parallel smoke runs use identical filenames (e.g. `/tmp/versigo-smoke-cookies.txt`), so one run's EXIT trap can delete another run's artifacts mid-run — the exact scenario the comment claims to prevent. `versigo-smoke-failfast.log` is also listed explicitly although the glob already covers it.
- Suggested fix: Use an explicit, complete file list (or per-run namespaced paths under a PID-specific directory) and adjust the comment to match.

**5. [Minor] `apps/api/src/features/identity/local-admin.bootstrap.ts:156-175` — misleading error/warn messages after a successful admin creation**
- Evidence: If `ensureDefaultHousehold` fails after the admin user was committed (first-create path), the outer catch logs "Initialer Admin-Bootstrap fehlgeschlagen" although the admin exists; a P2002 raised by `household.create` (replica race) is logged as "Admin-Bootstrap uebersprungen (Duplikat)" although the admin **was** created — only the household step was skipped.
- Suggested fix: Distinguish the two phases (admin creation vs. household/membership repair) in the log messages so operators can diagnose correctly.

**6. [Minor] `apps/api/src/features/identity/local-admin.bootstrap.ts:187-223` — membership upsert on the repair path is not audited**
- Evidence: When the default household already exists but the admin membership is missing (partial state), the `householdMembership.upsert` creates the membership without any `AuditEvent`, so a membership grant can happen without an audit trail (the `BOOTSTRAP_DEFAULT_HOUSEHOLD` event is only written when the household is created).
- Suggested fix: Write an audit event when the upsert actually creates a membership (e.g. `BOOTSTRAP_DEFAULT_HOUSEHOLD_MEMBER`), on both paths.

**7. [Minor] `apps/api/src/features/identity/__tests__/local-admin.bootstrap.spec.ts:164-189` — missing test cases for the repair path with an existing household and for idempotency**
- Evidence: The new repair-path test only covers the "household does not exist" branch. There is no test that the repair path (a) does **not** call `household.create` and does **not** emit a duplicate `BOOTSTRAP_DEFAULT_HOUSEHOLD` audit event when the household already exists, and (b) is idempotent when `ensureDefaultHousehold` is invoked twice.
- Suggested fix: Add both cases (mock `household.findUnique` returning an existing household; run `bootstrap()` twice and assert single creation/audit).

**8. [Minor] `apps/api/src/features/identity/local-admin.bootstrap.ts:104-116` — repair path grants default-household membership to any user matching `LOCAL_ADMIN_USERNAME` without role/status check; upgrade path for existing users not documented**
- Evidence: `findUnique` matches only on the normalized username. If an ACTIVE non-admin user with the same name exists (e.g. registered before the bootstrap first ran), the repair path grants that user membership in the default household (data access) even though they are not the bootstrap admin. Conversely, pre-AP-20 installations with other existing users are not migrated into the default household on upgrade, so those users lose access to household-scoped UI.
- Suggested fix: Verify `role === GlobalRole.ADMIN && status === UserStatus.ACTIVE` before granting membership on the repair path, and document the upgrade path for existing non-admin users in `docs/08-admin-operations.md`.

**9. [Minor] `docker-compose.yml:160-161` vs `docs/07-security-privacy.md:20-21` / `PR_DESCRIPTION.md:137` — worker health port 3100 is published to the host, contradicting the "internal only" security claim**
- Evidence: `docker-compose.yml` maps `"${WORKER_HEALTH_PORT:-3100}:3100"` to the host, and `WorkerLivenessService` binds `0.0.0.0`. `docs/07-security-privacy.md` states "Nur öffentliche Ports: Web (3000), API (3001)" and `PR_DESCRIPTION.md` claims the 3100 exposure is "nur intern auf das Compose-Netz begrenzt" — both are inaccurate. Impact is low (endpoint returns only `{"status":"ok"}`), but the security documentation is factually wrong.
- Suggested fix: Either remove the host port mapping (keep it internal for the healthcheck) or correct the documentation to list 3100 as a published port with rationale.

**10. [Minor] `docs/docker-image-guide.md:263-265` — dev-tools leak-check grep pattern `@nestjs\\+cli` can never match**
- Evidence: In the image-content verification snippet, `grep -Ei "^(eslint|vitest|@nestjs\\+cli)@"` — the double backslash in ERE matches one-or-more literal backslashes, not a literal `+`. The pnpm directory is `@nestjs+cli@...`, so the `@nestjs+cli` case never triggers "LEAK" and the check always prints a false "OK".
- Suggested fix: Use a single escaped plus (`@nestjs\+cli`) in the ERE pattern (or grep for `@nestjs\+cli@`).

## Work package coverage (AP-20 requirements not fully satisfied)

- **P3 (line 47-48 / 50):** API-only functions lack the required documented exception rationale. The control matrix marks "Audit-Log", "Monitoring: Queues/Integrationen", "Worker-Health" and "Datenexport (DSGVO)" as "API only", but the mandatory justification ("ausschließlich technische, nicht durch Endanwender steuerbare Betriebsfunktion und dokumentiere die Begründung") exists only for Notifications. The GDPR privacy export is a user-relevant function with no UI entry point at all.
- **P3 (line 54):** No systematic browser-level smoke test covering the most important buttons/navigation per role exists. `compose-smoke-test.sh` drives the API via curl; web coverage is unit-level only (no Playwright/E2E in `apps/web/package.json`).
- **P5 (line 74):** The env-var reference is only partially systematic: README groups variables (category/required/service) and `.env.example` has inline comments, but "sicherer Beispielwert" and "Sicherheitsrelevanz" per variable are not given consistently; the checklist row 21 claims this is complete ("✅"), which is overstated.
- **P6 (line 84/87):** The Docker image guide does not state supported architectures and has no optional multi-platform Buildx section ("sofern vom Projekt unterstützt" is left unaddressed).
- **P7 (line 103):** Accessibility (keyboard operability, visible focus, labels, contrast) shows no evidence of an audit or tests in the changed files.
- **P1 (line 35):** "Produktionsbuild ohne unkontrollierte Netzwerkzugriffe zur Laufzeit" is not explicitly verified or documented (build-time reproducibility via frozen lockfile is covered).

## Verification notes from reviewer

- Tests/checks reviewed: `local-admin.bootstrap.spec.ts` (new repair-path test, dev-with-placeholder test, production placeholder rejection, P2002 race, non-P2002 error handling, username normalization); assertions for `household.findUnique/create` and `householdMembership.upsert` match the implementation. Coverage gaps noted in Finding 7.
- Key areas inspected: `local-admin.bootstrap.ts` (idempotency, both paths, audit events, placeholder rejection intact before both paths, `identity.module.ts` call site), `user-admin.service.ts` `approve()` default-household membership, `family-sharing` controller/service and members endpoint, `docker-compose.yml`/`docker-compose.test.yml`, all three app Dockerfiles + `Dockerfile.test` + `.dockerignore`, `docker/start.sh`, `prisma/schema.prisma` + the AP-20 drift migration (verified additive and ordered after all earlier migrations), `app-config.schema.ts` (`LOCAL_AUTH_ENABLED` default semantics, empty-string handling), CI + publish workflows, and all docs (README, image guide, security/privacy, admin ops, checklist, control matrix, release notes, PR description).
- Remaining risks: The production-path verification gap (Findings 1–2) is the main release-readiness risk; multi-replica bootstrap races produce only transient, self-healing inconsistencies (covered by Findings 5–7); no critical/high defects found in the changed code itself.
