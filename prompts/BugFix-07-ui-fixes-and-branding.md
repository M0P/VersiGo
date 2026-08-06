# BugFix-07 – UI/manual-test findings: Admin-Settings, OIDC, Paperless, Portal-URL, Branding, Docker-Size

Source: user batch (2026-08-06) – "bugs / technical / new feature" list, decisions Q1–Q8.

## Scope (Package A only)

### 1. Admin settings as the single page (Q1)
- `/admin/settings` becomes the **only** configuration page: friendly feature cards
  (KI, OIDC, Paperless, Storage, Familien-Freigaben – currently `/admin/features`)
  at the top, followed by the full settings catalog below (search, filters,
  sources, restart badges).
- **No duplicates:** the catalog section below must **exclude** the feature keys
  already shown in the feature cards.
- Nav: add `/admin/settings`, remove `/admin/features`.
- `/admin/features` redirects to `/admin/settings`.
- The page must be user-friendly (existing patterns: cards, badges, filters).

### 2. OIDC login button / readiness (bug "no OIDC login button")
- The login page button only renders when the OIDC strategy is *ready*
  (`/auth/config`). Readiness fails when the API was not restarted after enabling
  OIDC (restart-category) or when IdP discovery failed at boot.
- Extend `GET /auth/config` with `oidcReady: boolean` and `oidcError: string | null`
  (last discovery error). Login page: show the OIDC button when ready; when
  `OIDC_ENABLED` is set but not ready, show a clear warning instead of nothing.
- Keep the "501 when not ready" behavior of `/auth/login`.

### 3. OIDC account linking from the profile page (Q2)
- Self-service while logged in, **no admin approval**, **no email auto-link**.
- API:
  - `GET /auth/oidc/link` (auth) → `{ linked: boolean, issuer?, subject? }`
  - `POST /auth/oidc/link` (auth) → starts the flow, returns `{ url }`
  - `DELETE /auth/oidc/link` (auth) → removes the binding
  - Callback (`GET /auth/callback`) in link mode: bind `(issuer, subject)` to the
    **authenticated session user** instead of logging in; conflicts (already bound
    to another account) → clear error; not authenticated → error.
- UI on `/settings` (Mein Profil): "OIDC-Anmeldung verbinden" / provider shown
  with "Trennen" when linked.
- Must respect the existing `(oidcIssuer, oidcSubject)` unique constraint and
  issuer normalization (`normalizeIssuerUrl`).

### 4. Paperless documents → insurance linking (Q3)
- API:
  - `GET /paperless/documents?search=` (auth) → search documents in Paperless-ngx.
  - `POST /policies/:id/documents/paperless` `{ paperlessDocumentId }` → creates a
    `PolicyDocument` row (`storageType: PAPERLESS_LINK`), **deduplicated** per
    (policyId, storageRef).
  - Unlink = existing document delete endpoint (household-scoped).
- UI: policy detail view – "Dokumente" section: list linked Paperless documents
  (title, date, category) + "Paperless-Dokument verbinden" action (live search,
  select any number) + remove.

### 5. Portal URL https (bug)
- Missing scheme → `https://` is prepended automatically; explicit `http://`
  stays; invalid schemes → 400. Applied to `insurerPortalUrl` (policy) and
  `PortalAccountLink.portalUrl` on create/update. Shared helper + tests.

### 6. Branding icon + favicon (new feature, Q7b – file drop)
- New repo folder `branding/` with default `favicon.svg` / `icon.svg`.
- Web Dockerfile copies `branding/` into the web image so files placed there
  **override** the defaults (rebuild required).
- Default assets live in `apps/web/public/branding/`, metadata references
  `/branding/icon.svg` (+ favicon).
- Document in `docs/docker-image-guide.md` (and end-user guide where fitting).

### 7. Docker image size reduction (Q6)
- Move `prisma migrate deploy` **out** of the api/worker runtime images into a
  dedicated migration build target / the Compose `migration` service.
- Remove Prisma CLI + schema engine + `postgresql16-client` (if unused) from the
  api/worker runners; `@prisma/client` query engine stays.
- `docker/start.sh` no longer runs migrations (documented); the Compose
  `migration` service remains the canonical migration path (fresh-clone contract).
- Try to get images smaller than the current api/worker ~490 MB, web ~207 MB;
  document the new sizes.

## Out of scope (Package B – separate work package for another agent)
- Costs overhaul + separate costs overview page (per user Q4/Q5).

## Acceptance
- All gates (lint, typecheck, unit/integration, i18n guard, smoke) green.
- Compose fresh-clone contract intact (`docker compose up --build` works;
  migrations run via the migration service).
- Review loop (code-reviewer) with 0 Critical/High/Medium, ≤8 Minor.
