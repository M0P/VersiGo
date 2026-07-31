'use client';

import { useState, type ReactElement } from 'react';
import { useTheme, ACCENT_PRESETS } from '../../contexts/theme-context';
import { validateHex, hexToHSL } from '../../lib/colour-utils';
import { Card, CardHeader } from './card';
import { SectionHeader } from './page-header';
import { Button } from './button';
import { Input } from './form-field';
import { Alert } from './alert';

/**
 * Appearance settings panel for colour customisation.
 *
 * Shows preset accent colour swatches and a custom hex colour input.
 * Changes are persisted via the ThemeContext/API and applied immediately.
 */
export function AppearanceSettings(): ReactElement {
  const { accentH, accentS, setAccent, theme, toggleTheme } = useTheme();
  const [customHex, setCustomHex] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentPresetIndex = ACCENT_PRESETS.findIndex(
    (p) => p.h === accentH && p.s === accentS,
  );

  const handlePresetSelect = (h: number, s: number) => {
    setError(null);
    void setAccent(h, s);
  };

  const handleCustomSubmit = () => {
    setError(null);
    const cleaned = customHex.trim();
    if (!cleaned) return;

    const valid = validateHex(cleaned);
    if (!valid) {
      setError('Ungültiger Hex-Farbwert. Erwartet wird z. B. #1a73e8 oder #1ae.');
      return;
    }

    const hsl = hexToHSL(valid);
    if (hsl) {
      void setAccent(hsl.h, hsl.s);
      setCustomHex('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Design-Anpassung" />
      </CardHeader>

      <div className="form-group">
        <label className="form-label">Farbmodus</label>
        <div className="btn-group">
          <Button
            variant={theme === 'light' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => { if (theme !== 'light') toggleTheme(); }}
          >
            Hell
          </Button>
          <Button
            variant={theme === 'dark' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => { if (theme !== 'dark') toggleTheme(); }}
          >
            Dunkel
          </Button>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Akzentfarbe</label>
        <div style={{ display: 'flex', gap: 'var(--insura-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className={`color-swatch ${currentPresetIndex === ACCENT_PRESETS.indexOf(preset) ? 'selected' : ''}`}
              style={{ backgroundColor: `hsl(${preset.h}, ${preset.s}%, 50%)` }}
              onClick={() => handlePresetSelect(preset.h, preset.s)}
              aria-label={`Akzentfarbe: ${preset.name}`}
              aria-pressed={currentPresetIndex === ACCENT_PRESETS.indexOf(preset)}
              title={preset.name}
            />
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="custom-colour">
          Eigene Farbe (Hex)
        </label>
        <div style={{ display: 'flex', gap: 'var(--insura-space-2)', alignItems: 'center' }}>
          <Input
            id="custom-colour"
            type="text"
            placeholder="#1a73e8"
            value={customHex}
            onChange={(e) => { setCustomHex(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
            error={error ?? undefined}
            style={{ maxWidth: 180 }}
          />
          <Button variant="secondary" size="sm" onClick={handleCustomSubmit}>
            Übernehmen
          </Button>
        </div>
        {error && <Alert variant="danger" id="custom-colour-error">{error}</Alert>}
      </div>
    </Card>
  );
}
