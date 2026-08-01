# AP-18 review — Iteration 1

Reviewer: `code-reviewer` subagent (read-only)
Date: 2026-08-01
Scope: Uncommitted changes for AP-18 portal-connectors on branch `feat/AP-18-portal-connectors`.

## Summary
- Critical: 0
- High: 0
- Medium: 2
- Minor: 5
- Verdict: CHANGES REQUIRED

## Findings

- [Medium] `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts:232,273` — Nested `PortalCredentialsDto` is never validated by the HTTP ValidationPipe (missing `@ValidateNested()`)
  - Evidence: `CreatePortalAccountLinkDto.credentials` and `UpdatePortalAccountLinkDto.credentials` are annotated only with `@IsObject()` + `@Type(() => PortalCredentialsDto)`. class-validator only recurses into nested objects when `@ValidateNested()` is present; `@Type()` only affects transformation, not validation. The project's own convention confirms this — `apps/api/src/features/ai-assist/ai-assist.dto.ts:51-52` pairs `@ValidateNested({ each: true })` with `@Type(() => ...)`. Consequence: the `@ValidateIf`/`@IsString` "at-least-one" trick inside `PortalCredentialsDto` (lines 193-197) never fires through the HTTP pipe, and neither do `@IsString`/`@MaxLength` on `portalUsername`/`portalPassword`. Only the service-layer guard in `encryptCredentials` (policy-registry.service.ts:400-403) catches the fully-empty `{}` case, so the acceptance criterion survives — but malformed payloads such as `credentials: { portalPassword: 123 }` are accepted and stored (encrypted) as-is, and the intended 400 message never surfaces.
  - Required fix: Add `@ValidateNested()` next to `@Type(() => PortalCredentialsDto)` on both `credentials` properties (do not use `{ each: true }` — it is a plain object, not an array).

- [Medium] `apps/api/src/features/policy-registry/policy-registry.service.ts:172-177` — `update()` returns raw `portalLinks` including `credentialsEncrypted` ciphertext
  - Evidence: `update()` uses `include: { portalLinks: true }` and returns the raw Prisma row, so `PATCH /households/:h/policies/:id` on a policy that already has portal links with stored credentials returns the `credentialsEncrypted` blob in the response. This directly contradicts the invariant documented in `portal-connector.service.ts:38` and the service JSDoc ("`credentialsEncrypted` wird NIE zurueckgegeben – nur `credentialsSet`"). `create()` has the same `include` but no links exist at creation time, so no leak there; `update()` is the real gap. The ciphertext alone is not directly usable without the server key, but it is an unnecessary exposure and breaks the API contract that only `credentialsSet` is exposed.
  - Required fix: Enrich portal links in `update()`'s return path the same way `findAll`/`findOne` do (map through `portalConnectors.enrichPortalLink(link, policy.contractNumber)`), or strip `credentialsEncrypted` before returning.

- [Minor] `apps/api/src/features/policy-registry/policy-registry.service.ts:406-411` — JSON `null` values in credentials are stored inside the encrypted payload
  - Evidence: `encryptCredentials` filters with `!== undefined`, so a body like `credentials: { portalPassword: null }` passes the guard (`!credentials.portalUsername && !credentials.portalPassword` is false when a username is set) and stores `portalPassword: null` inside the encrypted JSON.
  - Required fix: Filter with `!= null` (or validate the fields as strings in the DTO so `null` is rejected), so only real string values are persisted.

- [Minor] `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts:193-197` — The `@ValidateIf` at-least-one guard is bypassable via its own virtual field
  - Evidence: If a client sends `credentials: { atLeastOneCredential: "x" }` with neither username nor password, the condition `!o.portalUsername && !o.portalPassword` is true but `@IsString` passes because `atLeastOneCredential` is a string. This only matters if `@ValidateNested()` is added (see Medium #1); the service-level guard in `encryptCredentials` still rejects the payload, so this is defense-in-depth hardening, not an active hole today.
  - Required fix: Rely on the service guard as the single source of truth, or remove the virtual-field trick and enforce at-least-one only in the service.

- [Minor] `apps/api/src/features/policy-registry/__tests__/` — No test exercises the DTO/ValidationPipe path
  - Evidence: All credential-validation tests (empty object, null-clear, redacted audit) construct `PolicyRegistryService` directly and never run class-validator. The `@ValidateIf` behavior and the nested-DTO question (Medium #1) are therefore untested — which is why the gap went unnoticed.
  - Required fix: Add a unit test that calls `validate()`/`plainToInstance()` on `CreatePortalAccountLinkDto`/`UpdatePortalAccountLinkDto` (including `credentials: null` and `credentials: {}`), asserting the at-least-one rule and that `null` passes while `{}` fails.

- [Minor] `apps/api/src/features/policy-registry/policy-registry.service.ts:510-513` — Partial credential updates use replace-semantics
  - Evidence: Sending only `credentials: { portalPassword: "x" }` overwrites the previously stored username (the encrypted payload is rebuilt from only the supplied fields). This is documented as "setzen/ersetzen", so it is intentional, but a client updating one field silently discards the other. Worth a doc/UI note or a merge-semantics test.
  - Required fix: Either document the replace-semantics in the DTO JSDoc or add an explicit test asserting the replace behavior so it is not accidentally "fixed" later.

- [Minor] `apps/api/src/features/policy-registry/policy-registry.service.ts:13` — Very long import line and growing constructor coupling
  - Evidence: The DTO import spans >200 chars and the constructor now takes four dependencies (`db`, `authService`, `encryption`, `portalConnectors`). This is style/coupling, not functional, but hurts readability relative to the rest of the codebase.
  - Required fix: Split the import into multiple lines; optionally group the cross-feature dependency behind the existing service (already done via `PortalConnectorsModule` import — fine).

## Verification
- Tests or checks reviewed: All four new `portal-connectors` specs (catalog, registry, service, controller) plus the updated `policy-registry.service.spec.ts` and `household-isolation.integration.spec.ts`. Acceptance criteria are covered at the service level: encrypted storage (no plaintext in DB write, roundtrip decrypt test), redacted audit diff, `credentials: null` clearing, degraded/unavailable connector not breaking the deep link, and household isolation retained. No test was executed (no bash tool in this environment); review is static only.
- Important areas inspected: `portal-catalog.ts` (placeholder substitution, URL-encoding, precedence rules), registry/plugin (resilience contract), `enrichPortalLink` (strips `credentialsEncrypted`, computes `credentialsSet`, `deepLinkUrl`, catalog/connector views), controller role wiring (global `SessionAuthGuard` + `RolesGuard` confirmed in `identity.module.ts`), DTO validation semantics, Prisma schema/migration consistency (migration adds exactly the 4 columns present in the schema; `@updatedAt` + `DEFAULT CURRENT_TIMESTAMP` is standard), global `ValidationPipe` settings (`whitelist`, `forbidNonWhitelisted`, `transform`), web page rendering (`deepLinkUrl ?? portalUrl`, experimental badge), and doc updates (03/04/05/06/07 consistent with implementation).
- Remaining risks: The nested-validation claim in Medium #1 is based on class-validator's documented behavior (and the project's own `@ValidateNested` usage in ai-assist); the installed package source under the content-addressed pnpm store could not be opened to confirm byte-for-byte, so it should be verified by running the API test suite once. No HTTP/e2e test covers the new DTOs through the pipe. `update()` ciphertext leak (Medium #2) is the only item with direct API-surface impact.

## Recommendations
1. Add `@ValidateNested()` to both `credentials` properties (fix Medium #1).
2. Enrich (or strip `credentialsEncrypted` from) the `portalLinks` returned by `update()` (fix Medium #2).
3. Tighten `encryptCredentials` to `!= null` and add DTO-path unit tests.
4. Run the full compose test suite (`docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test`) plus `pnpm run typecheck`/`lint` to confirm the constructor-change ripples (only the two spec files construct `PolicyRegistryService`, both already updated — no other consumers found).

---

## Remediation log (iteration 1 → iteration 2)

All findings addressed as follows (verified by the canonical test suite after each change):

- **Medium #1** — Added `@ValidateNested()` to `credentials` on both DTOs. Verified via a new DTO unit spec and an in-container debug script that nested validation fires through `@ValidateNested()` (errors surface in `error.children`).
- **Medium #2** — `update()` now enriches `portalLinks` through `enrichPortalLink` (mirrors `findAll`/`findOne`), so `credentialsEncrypted` never appears in the response.
- **Minor (null values)** — `encryptCredentials` now filters with `!= null` and trims, persisting only real string values; whitespace-only values no longer stored.
- **Minor (bypass vector)** — Removed the virtual-field trick (`@ValidateIf`/`atLeastOneCredential`) entirely. class-validator 0.14.4 types `@Validate` as `PropertyDecorator` only (no `ClassDecorator`), so a class-level constraint is not type-safe; the at-least-one rule is now enforced exclusively in the service (`encryptCredentials`), which is the single source of truth and not bypassable. The global ValidationPipe (`whitelist`/`forbidNonWhitelisted`) rejects arbitrary extra fields.
- **Minor (missing DTO tests)** — Added `policy-registry.dto.spec.ts` covering: valid payloads, non-string rejection, `MaxLength` rejection, `credentials: null` (update), omitted credentials, and whitelist rejection of unknown nested fields.
- **Minor (replace-semantics)** — Documented the replace-semantics in the `PortalCredentialsDto` JSDoc AND added an explicit service test asserting that a partial update persists only the supplied fields.
- **Minor (import line)** — Split the long DTO import into multiple lines.
