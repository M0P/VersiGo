# UI/UX

## Design System (AP-13)

### Architecture
The Insura design system is built on **CSS custom properties** and **@layer cascade** with five explicit layers:
1. `design-tokens` – base shared tokens (colours, typography, spacing, etc.)
2. `theme` – light/dark overrides via `[data-theme]` attribute
3. `base` – element resets and typography
4. `components` – reusable component CSS classes (`.btn`, `.card`, `.table`, etc.)
5. `utilities` – one-off helper classes (`.sr-only`, `.text-muted`, `.mt-4`, etc.)

All components must consume token variables rather than hard-coded values.

### File Location
- **CSS tokens & component styles**: `apps/web/src/styles/globals.css`
- **React component primitives**: `apps/web/src/components/ui/`
- **Theme context (colour customisation)**: `apps/web/src/contexts/theme-context.tsx`
- **Navigation config**: `apps/web/src/components/ui/nav-config.ts`

### Design Tokens

#### Colour
| Token | Purpose |
|-------|---------|
| `--insura-accent` | Primary action colour (HSL, user-customisable) |
| `--insura-accent-light` | Tinted accent for hover backgrounds |
| `--insura-accent-dark` | Shaded accent for hover states |
| `--insura-accent-soft` | Subtle accent background |
| `--insura-accent-text` | Text on accent backgrounds |
| `--insura-bg` | Page background |
| `--insura-bg-elevated` | Elevated surface background |
| `--insura-surface` | Card/surface background |
| `--insura-surface-hover` | Surface hover state |
| `--insura-border` | Default border colour |
| `--insura-border-strong` | Strong border colour |
| `--insura-text-primary` | Primary text |
| `--insura-text-secondary` | Secondary text |
| `--insura-text-muted` | Muted/hint text |
| `--insura-success` / `--insura-warning` / `--insura-danger` / `--insura-info` | Semantic colours |
| `--insura-*-soft` | Semantic background tints |

#### Typography
| Token | Value |
|-------|-------|
| `--insura-font-family` | `system-ui, -apple-system, ...` |
| `--insura-font-mono` | Monospace stack |
| `--insura-font-size-base` | `1rem` (16px) |
| Scale | `xs` (0.75rem) to `4xl` (2.25rem) |
| Weights | `normal` (400), `medium` (500), `semibold` (600), `bold` (700) |

#### Spacing
A 4-step scale: `--insura-space-1` (4px) to `--insura-space-16` (64px).

#### Breakpoints
| Name | Min-width | Target |
|------|-----------|--------|
| Mobile | 0 | Narrow touch screens |
| Tablet | 640px | Intermediate layouts |
| Desktop | 1024px | Multi-column, full navigation |

Breakpoints are defined as reference custom properties but used via CSS media queries in `globals.css`.

### Component Conventions

All UI primitives live in `apps/web/src/components/ui/` and use the CSS classes from `globals.css`:

| Component | File | CSS class(es) |
|-----------|------|---------------|
| AppShell | `app-shell.tsx` | `.app-shell`, `.app-sidebar`, `.app-topbar`, `.app-main` |
| Button | `button.tsx` | `.btn`, `.btn-primary`, `.btn-secondary`, etc. |
| Card | `card.tsx` | `.card`, `.card-header`, `.card-footer` |
| PageHeader | `page-header.tsx` | `.page-header`, `.section-header` |
| Alert | `alert.tsx` | `.alert`, `.alert-{info,success,warning,danger}` |
| EmptyState | `empty-state.tsx` | `.empty-state` |
| Loading | `loading.tsx` | `.loading-page`, `.loading-spinner` |
| Dialog | `dialog.tsx` | `.dialog-overlay`, `.dialog-panel` |
| FormField / Input / Select / Textarea | `form-field.tsx` | `.form-group`, `.form-input`, `.form-select`, `.form-textarea` |

### Accessibility Rules
- All form elements have labels via `FormField` or explicit `<label>`.
- Buttons have `:focus-visible` outlines with accent colour.
- `prefers-reduced-motion` disables all transitions and animations.
- Dialog implements focus trapping and escape-to-close.
- Data tables on mobile use `aria-label` / `data-label` patterns for accessible row display.
- Colour contrast is maintained through derived accent values; transparency is only used on decorative non-essential surfaces with solid fallback.

### Colour Customisation
- Users can select one of 8 preset accent colours or enter a custom hex value.
- The colour is stored as a user-preference (`UserPreference` model, key `ui:accentColour`).
- The API validates hex values before persisting.
- The frontend applies the accent via CSS custom properties (`--insura-accent-h`, `--insura-accent-s`).
- Dark/light mode detects `prefers-color-scheme` automatically; a toggle is available in the top bar and settings page.
- Colour preference is per-user and never shared between users/households.
- A flash of the wrong theme is avoided by using `suppressHydrationWarning` and applying theme attributes in a client-side effect.

### Responsive Behaviour
- **Mobile (< 640px)**: Single-column layouts, stacked card navigation, hidden sidebar with overlay toggle, stacked table rows with `data-label`, full-width buttons.
- **Tablet (640–1023px)**: 2-column grid layouts, visible sidebar.
- **Desktop (≥ 1024px)**: 3-column grids, larger content padding, comfortable navigation.
- Tables use `.table-container` for horizontal scroll fallback and mobile-friendly stacked rows.

### Settings UI (AP-17)

#### Mein Profil (`/settings`, `USER`/`ADMIN`)
- Profilinformationen (Benutzername, Rolle, Kontoerstellt) schreibgeschützt;
  Anzeigename und Sprache (Locale-Allowlist) editierbar via `PATCH /user/profile`.
- Design-Anpassung (Farbmodus, Akzentfarbe) bleibt über `AppearanceSettings`
  erreichbar (persönliche UI-Präferenz `ui:accentColour`, Allowlist `theme`).
- `READ_ONLY` sieht ausschließlich eine Hinweis-Meldung („Nur-Lese-Zugriff"),
  keine editierbaren Felder; die API blockiert alle Profil-/Präferenz-Endpunkte
  mit 403.

#### Systemeinstellungen (`/admin/settings`, nur `ADMIN`)
- Katalogbasierte Ansicht, gruppiert nach Katalog-Gruppe; Toolbar mit Suche
  (Schlüssel/Gruppe/Beschreibung) und Filtern: Quelle (`UI`/`.env`/`Default`),
  „Nur ungültige UI-Werte", „Nur Neustart erforderlich".
- Pro Schlüssel: Quellen-Badge, effektiver Wert (Secrets maskiert als
  „••••••••"/„Nicht gesetzt"), Fallback-Grund, Warnung bei ungültigem UI-Wert,
  „Neustart erforderlich"-Badge, letzter Änderungszeitpunkt/-akteur,
  Connectivity-Test-Ergebnis.
- Aktionen: Bearbeiten/Speichern (atomar validiert, typabhängiges Eingabefeld
  inkl. `allowedValues`-Select und Zahlen-Min/Max), Zurücksetzen auf Fallback
  (mit Bestätigungsdialog), „Verbindung testen" nur für testbare Schlüssel.
- CSS-Klassen: `.settings-toolbar`, `.settings-filter-checks`,
  `.settings-entry*` (in `globals.css`), Wiederverwendung der Badge-/Form-/
  Alert-Komponenten.

### Tested Viewport Sizes
- 360px (mobile)
- 768px (tablet)
- 1280px (desktop)

### Intentionally Deferred
- Full dark-mode colour palette refinement (current dark theme is functional but uses reduced saturation).
- Animation and micro-interaction polish.
- Fine-tuned responsive data-table column visibility (currently all columns render).
- Per-component dark mode customisation (currently driven by CSS custom properties).
