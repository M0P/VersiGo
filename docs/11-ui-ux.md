# UI/UX

## Design System (AP-13)

### Architecture
The VersiGo design system is built on **CSS custom properties** and **@layer cascade** with five explicit layers:
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
| `--versigo-accent` | Primary action colour (HSL, user-customisable) |
| `--versigo-accent-light` | Tinted accent for hover backgrounds |
| `--versigo-accent-dark` | Shaded accent for hover states |
| `--versigo-accent-soft` | Subtle accent background |
| `--versigo-accent-text` | Text on accent backgrounds |
| `--versigo-bg` | Page background |
| `--versigo-bg-elevated` | Elevated surface background |
| `--versigo-surface` | Card/surface background |
| `--versigo-surface-hover` | Surface hover state |
| `--versigo-border` | Default border colour |
| `--versigo-border-strong` | Strong border colour |
| `--versigo-text-primary` | Primary text |
| `--versigo-text-secondary` | Secondary text |
| `--versigo-text-muted` | Muted/hint text |
| `--versigo-success` / `--versigo-warning` / `--versigo-danger` / `--versigo-info` | Semantic colours |
| `--versigo-*-soft` | Semantic background tints |

#### Typography
| Token | Value |
|-------|-------|
| `--versigo-font-family` | `system-ui, -apple-system, ...` |
| `--versigo-font-mono` | Monospace stack |
| `--versigo-font-size-base` | `1rem` (16px) |
| Scale | `xs` (0.75rem) to `4xl` (2.25rem) |
| Weights | `normal` (400), `medium` (500), `semibold` (600), `bold` (700) |

#### Spacing
A 4-step scale: `--versigo-space-1` (4px) to `--versigo-space-16` (64px).

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
- The frontend applies the accent via CSS custom properties (`--versigo-accent-h`, `--versigo-accent-s`).
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
  Anzeigename editierbar via `PATCH /user/profile`.
- **Sprache (AP-21):** Sprachauswahl über den `LanguageSelector`
  (`/user/language`, Sprachcodes `en`/`de`). Englisch ist der globale
  Standard; die Wahl wird für `USER`/`ADMIN` persistent in `users.locale`
  gespeichert.
- Design-Anpassung (Farbmodus, Akzentfarbe) bleibt über `AppearanceSettings`
  erreichbar (persönliche UI-Präferenz `ui:accentColour`, Allowlist `theme`).
- `READ_ONLY` sieht eine Hinweis-Meldung („Nur-Lese-Zugriff") und –
  **ausschließlich** – den `LanguageSelector` mit Sitzungshinweis
  (Sprache gilt nur für diese Browser-Sitzung, wird nicht gespeichert).
  Alle anderen Profil-/Präferenz-Endpunkte blockiert die API für `READ_ONLY`
  mit 403.

#### Internationalisierung (AP-21)
- Alle sichtbaren Texte der Web-App laufen über die typsicheren Kataloge
  `apps/web/src/i18n/locales/en.ts` (Quelle der Wahrheit) und `de.ts`
  (strukturgleich per TypeScript erzwungen); Zugriff über `t()` (`useI18n`).
- Die Sprache wird initial aus dem Cookie `versigo:locale` gelesen und nach
  dem Setzen gesetzt; `<html lang>` und Metadaten folgen der Sprache.
- Fallback-Kette: gewählte Sprache → Englisch → roher Schüssel (nie leerer
  Text). Ein i18n-Guard (`pnpm --filter @versigo/web run test:i18n`)
  verhindert hartkodierte deutsche UI-Texte in `src/`.

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
