# AP-13 — Design System and Responsive UI

## Goal

Create a shared, accessible, responsive design system for Insura and apply it to the existing web application without changing existing business behaviour.

The UI must feel modern and calm, inspired by Material You: expressive colour, large readable surfaces, rounded components, clear hierarchy, subtle elevation, and restrained transparency/liquid-glass effects. It must work well on mobile, tablet, and desktop and provide a consistent foundation for all current and future views.

This is a vertical slice: deliver the design tokens, reusable UI primitives, theme selection, responsive application shell, and migration of representative existing views in one feature.

## Read first

Before changing code, inspect and follow:

- `AGENTS.md`
- `docs/01-product-vision.md`
- `docs/02-requirements.md`
- `docs/03-architecture.md`
- `docs/11-ui-ux.md`
- `docs/10-quality-and-library-policy.md`
- `dependency-policy.md`
- Existing web routes, layouts, components, tests, Docker files, and all relevant prior prompts
- Existing conventions for environment variables, API clients, authentication, and error handling

Do not introduce a UI library or styling dependency unless it is permitted by the repository dependency policy. Prefer the project’s existing styling approach; if none is suitable, introduce the smallest maintainable solution and document the decision.

## Scope

### 1. Shared design system

Create one authoritative styling system for the whole web application.

- Define semantic design tokens for colour, typography, spacing, shape, elevation, opacity, motion, breakpoints, focus states, and z-index.
- Use CSS custom properties or the project’s established equivalent so all components consume shared tokens rather than hard-coded colours or duplicated values.
- Support light and dark appearance if feasible within the existing architecture. Do not make this a prerequisite for completing the slice if it would substantially enlarge scope.
- Create reusable primitives/components for at least:
  - Application shell and responsive navigation
  - Page header and section header
  - Surface/card
  - Button variants
  - Text input, select, textarea, and form-field validation state
  - Alert/notice and empty state
  - Loading state
  - Table/list container suitable for narrow screens
  - Dialog or confirmation surface where an existing view needs one
- Ensure keyboard navigation, visible focus states, adequate target sizes, semantic HTML, labels, and sensible contrast.

### 2. Material You visual direction

Implement the visual direction through tokens and components rather than per-page styling.

- Use soft rounded corners, tonal hierarchy, readable typography, and restrained shadows.
- Add subtle transparency and liquid-glass effects only to non-essential decorative surfaces such as the top bar, navigation, or elevated panels.
- Always provide a solid-colour fallback and maintain readable contrast; transparency must not obscure content or controls.
- Respect `prefers-reduced-motion`; avoid distracting animation.

### 3. Responsive layouts

Make the web application responsive by design rather than by shrinking desktop layouts.

- Mobile: optimize for narrow touch screens, single-column content, large controls, and compact navigation.
- Tablet: use intermediate layouts and avoid wasted space.
- Desktop: use responsive max-width content areas, sensible multi-column layouts where useful, and efficient navigation.
- Define documented breakpoints in the shared styling system.
- Tables and dense data must remain usable on small screens through responsive columns, stacked rows, or an equivalent accessible pattern; do not require horizontal scrolling for core actions unless unavoidable.
- Test representative widths around 360px, 768px, and 1280px or equivalent project breakpoints.

### 4. User-selected colour

Allow a signed-in user to choose an accent colour and define a custom colour.

- Provide a clear settings entry point appropriate to the existing settings/admin/user-information architecture.
- Offer a small set of accessible preset colours plus a custom colour picker or validated colour value input.
- Apply the selected colour across the shared semantic accent tokens, including primary actions, active navigation, focus treatments where appropriate, and selected states.
- Validate and sanitize custom colour input. Derive accessible foreground/contrast variants instead of blindly using the raw value everywhere.
- Persist the choice using the existing persistence and household/user-scoping conventions. Do not leak one user’s preference to another user or household.
- Use a stable default when no preference is configured.
- Avoid a flash of the wrong theme where practical.

### 5. Migrate current views

Apply the new system to the existing application shell and representative established routes, including authentication, policy, household/cost, and admin/settings views where present.

- Preserve all routes, API contracts, permissions, and existing feature behaviour.
- Remove or consolidate duplicated page-specific styling where safe.
- Do not rewrite unrelated feature logic.
- Ensure future pages can be built entirely from the new tokens and primitives.

## Backend and data requirements

If persistence is required, implement it as a complete vertical slice:

- Add a Prisma migration when schema changes are needed.
- Add a narrowly scoped API endpoint/service only if the existing settings mechanism cannot safely support the preference.
- Authenticate and authorize every endpoint.
- Scope reads and writes to the current user according to the established identity and household model.
- Validate DTOs and return safe errors.
- Add unit and integration tests appropriate to the changed layer.

Do not store user-specific preferences only in browser storage when the product already has authenticated persistence; browser storage may be used as a temporary rendering cache but not as the source of truth.

## Docker Compose requirement

`docker compose up --build` must run the complete application from a fresh clone after this feature.

- Preserve or improve the existing Compose developer experience.
- Ensure the web app, API, worker, database, Redis, and any required dependencies start in the correct order and communicate through documented configuration.
- Add health checks and readiness handling where the current setup lacks them and they are needed for reliable startup.
- Update `.env.example` with any new non-secret configuration.
- Do not commit secrets, generated credentials, local volumes, or machine-specific paths.
- Verify the feature in the Compose environment, including theme preference persistence where applicable.

This Compose requirement is part of the feature’s acceptance criteria and remains mandatory for every subsequent feature.

## Tests and quality gates

Add or update:

- Unit tests for colour parsing/normalization and contrast/derived-token logic.
- API/service tests for preference authorization and persistence, if applicable.
- Component tests for key primitives and colour preference behaviour where the repository supports them.
- Responsive visual or browser tests if the existing test stack supports them; otherwise document a concise manual responsive verification procedure.
- Existing lint, type-check, unit-test, build, and migration checks.

Do not weaken, skip, or delete existing tests to make the feature pass.

## Documentation

Update:

- `docs/11-ui-ux.md` with the design tokens, breakpoints, component conventions, accessibility rules, and colour-customization behaviour.
- `docs/04-data-model.md` if persistence changes.
- `docs/03-architecture.md` if a new UI architecture or persistence boundary is introduced.
- `README.md` with the Compose startup command and how to choose a colour.
- Create an ADR only if a consequential new styling framework, persistence strategy, or theming architecture is selected.

## Acceptance criteria

- Existing and migrated views share one design-token and component system.
- The application is usable and visually coherent at mobile, tablet, and desktop widths.
- A user can select a preset accent colour or a valid custom colour; it persists safely and affects the UI consistently.
- The UI remains accessible, including keyboard focus, labels, contrast, and reduced-motion behaviour.
- Existing functionality and access controls remain intact.
- Database migrations, tests, linting, type checks, and production build pass.
- From a fresh clone with documented environment values, `docker compose up --build` starts a usable application.
- The final implementation is documented and contains no unrelated refactors.

## Delivery report

In the final response, provide:

1. Files changed and why.
2. The design-system architecture and token location.
3. Responsive behaviour and tested viewport sizes.
4. How colour preferences are stored, validated, and scoped.
5. Exact commands run, including Compose verification.
6. Any intentionally deferred work and rationale.
