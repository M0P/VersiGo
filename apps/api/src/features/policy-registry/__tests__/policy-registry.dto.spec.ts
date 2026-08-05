import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreatePortalAccountLinkDto, UpdatePortalAccountLinkDto } from '../dto/policy-registry.dto';

/**
 * Prueft die DTO-Validierung des HTTP-Pfads (AP-18): Verschachtelte
 * PortalCredentialsDto werden nur mit @ValidateNested() wirklich validiert.
 * Die "mindestens ein Zugangsdatenfeld"-Regel wird bewusst im Service
 * durchgesetzt (Single Source of Truth); die DTO-Schicht validiert Typ und
 * Laengen. Whitelist-Optionen spiegeln das globale ValidationPipe-Verhalten
 * (whitelist/forbidNonWhitelisted/transform) wider.
 */
async function errorsFor(
  dtoClass: typeof CreatePortalAccountLinkDto | typeof UpdatePortalAccountLinkDto,
  raw: unknown,
  options: { whitelist?: boolean } = {},
): Promise<ValidationError[]> {
  return validate(plainToInstance(dtoClass, raw as object), {
    ...(options.whitelist ? { whitelist: true, forbidNonWhitelisted: true } : {}),
  });
}

function messages(errors: ValidationError[]): string[] {
  const own = errors.flatMap((e) => Object.values(e.constraints ?? {}));
  const children = errors.flatMap((e) => (e.children ?? []).flatMap((c) => Object.values(c.constraints ?? {})));
  return [...own, ...children];
}

describe('PortalCredentialsDto / Portal-Link DTOs (AP-18)', () => {
  it('akzeptiert gueltige Zugangsdaten (beide Felder)', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'max', portalPassword: 'geheim' },
    });
    expect(errors).toHaveLength(0);
  });

  it('akzeptiert nur einen Benutzernamen (at-least-one wird im Service erzwungen)', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'max' },
    });
    expect(errors).toHaveLength(0);
  });

  it('leere Zugangsdaten (credentials: {}) passieren die DTO-Ebene (Service lehnt ab)', async () => {
    // Design-Entscheidung AP-18: Alle Felder sind optional, daher ist `{}`
    // strukturell gueltig; die at-least-one-Regel wird ausschliesslich im
    // Service (encryptCredentials) durchgesetzt. Dieser Test fixiert die
    // DTO/Service-Trennung, damit sie nicht versehentlich verschoben wird.
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: {},
    });
    expect(errors).toHaveLength(0);
  });

  it('lehnt Nicht-http(s)-portalUrl ab (kein javascript:/data:-Deeplink)', async () => {
    // `ftp://example.com` ist eine wohlgeformte URL, die ohne die
    // protocols-Option von @IsUrl akzeptiert wuerde – der Test pinnt damit
    // tatsaechlich die http(s)-Beschraenkung (nicht einen Nebenfehler).
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: 'ftp://example.com',
    });
    expect(errors.length).toBeGreaterThan(0);

    const ok = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: 'https://mein-portal.example.com/login',
    });
    expect(ok).toHaveLength(0);
  });

  it('lehnt Nicht-String-Werte in Zugangsdaten ab', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'max', portalPassword: 123 },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors)).toContain('portalPassword must be a string');
  });

  it('lehnt ueberlaenge Zugangsdaten ab (MaxLength)', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'x'.repeat(257) },
    });
    expect(messages(errors)).toContain('portalUsername must be shorter than or equal to 256 characters');
  });

  it('Update: credentials: null ist gueltig (Loesch-Semantik)', async () => {
    const errors = await errorsFor(UpdatePortalAccountLinkDto, { credentials: null });
    expect(errors).toHaveLength(0);
  });

  it('normalisiert portalUrl: https://-Praefix wenn Schema fehlt, http(s) unveraendert', async () => {
    // BugFix-05 (Befund 2): Der @PortalUrlTransform ergaenzt das Schema vor
    // der @IsUrl-Validierung; der transformierte Wert muss auf der Instanz
    // ankommen (class-transformer laeuft vor class-validator).
    const withoutSchema = plainToInstance(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: 'www.portal.de/login',
    });
    expect(withoutSchema.portalUrl).toBe('https://www.portal.de/login');
    const errorsWithoutSchema = await validate(withoutSchema);
    expect(errorsWithoutSchema).toHaveLength(0);

    const withHttp = plainToInstance(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: 'http://portal.example.com',
    });
    expect(withHttp.portalUrl).toBe('http://portal.example.com');
    expect(await validate(withHttp)).toHaveLength(0);

    const withHttps = plainToInstance(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: 'https://portal.example.com/login',
    });
    expect(withHttps.portalUrl).toBe('https://portal.example.com/login');
    expect(await validate(withHttps)).toHaveLength(0);
  });

  it('lehnt javascript:/data:-Eingaenge auch nach der Normalisierung ab', async () => {
    // BugFix-05 (Befund 2): Ohne Schema wird https:// vorangestellt, wodurch
    // `javascript:…`/`data:…` nie durchrutschen; mit `://` bleiben sie
    // unveraendert und scheitern an der protocols-Whitelist von @IsUrl.
    for (const raw of [
      'javascript:alert(1)',
      'javascript://alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data://alert(1)',
    ]) {
      const errors = await errorsFor(CreatePortalAccountLinkDto, {
        providerKey: 'huk-coburg',
        portalUrl: raw,
      });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('lehnt ueberlange portalUrl ab (MaxLength 2048)', async () => {
    // BugFix-05 (Befund 2): Explizites 2048-Zeichen-Limit auf beiden DTOs.
    const long = plainToInstance(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: `https://portal.example.com/${'a'.repeat(2100)}`,
    });
    const errors = await validate(long);
    expect(messages(errors)).toContain('portalUrl must be shorter than or equal to 2048 characters');

    const longUpdate = plainToInstance(UpdatePortalAccountLinkDto, {
      portalUrl: `https://portal.example.com/${'a'.repeat(2100)}`,
    });
    const errorsUpdate = await validate(longUpdate);
    expect(messages(errorsUpdate)).toContain('portalUrl must be shorter than or equal to 2048 characters');
  });

  it('Update: lehnt Nicht-http(s)-portalUrl ab, erlaubt aber null (Loesch-Semantik)', async () => {
    // `ftp://example.com` ist eine wohlgeformte URL, die ohne die
    // protocols-Option von @IsUrl akzeptiert wuerde – der Test pinnt damit
    // tatsaechlich die http(s)-Beschraenkung (nicht einen Nebenfehler).
    const errors = await errorsFor(UpdatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: 'ftp://example.com',
    });
    expect(errors.length).toBeGreaterThan(0);

    const ok = await errorsFor(UpdatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: 'https://mein-portal.example.com/login',
    });
    expect(ok).toHaveLength(0);

    const cleared = await errorsFor(UpdatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      portalUrl: null,
    });
    expect(cleared).toHaveLength(0);
  });

  it('Update: credentials nicht angegeben ist gueltig (unveraendert lassen)', async () => {
    const errors = await errorsFor(UpdatePortalAccountLinkDto, { providerKey: 'allianz' });
    expect(errors).toHaveLength(0);
  });

  it('whitelist: unbekannte Zusatzfelder in credentials werden abgewiesen', async () => {
    // Das globale ValidationPipe (forbidNonWhitelisted) weist beliebige
    // Fremdfelder ab; die at-least-one-Regel bleibt Service-seitig erzwungen.
    const errors = await errorsFor(
      CreatePortalAccountLinkDto,
      { providerKey: 'huk-coburg', credentials: { atLeastOneCredential: 'x' } },
      { whitelist: true },
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
