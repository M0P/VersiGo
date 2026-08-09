import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreatePortalAccountLinkDto, UpdatePortalAccountLinkDto, CreatePolicyDto, UpdatePolicyDto } from '../dto/policy-registry.dto';

/**
 * Tests the DTO validation of the HTTP path (AP-18): nested
 * PortalCredentialsDto are only really validated with @ValidateNested().
 * The "at least one credentials field" rule is deliberately enforced in the
 * service (single source of truth); the DTO layer validates type and length.
 * Whitelist options mirror the global ValidationPipe behavior
 * (whitelist/forbidNonWhitelisted/transform).
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
  it('accepts valid credentials (both fields)', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'max', portalPassword: 'secret' },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts a single username (at-least-one is enforced in the service)', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'max' },
    });
    expect(errors).toHaveLength(0);
  });

  it('empty credentials (credentials: {}) pass the DTO layer (the service rejects them)', async () => {
    // Design decision AP-18: all fields are optional, so `{}` is structurally
    // valid; the at-least-one rule is enforced exclusively in the service
    // (encryptCredentials). This test pins the DTO/service separation so it
    // is not accidentally moved.
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: {},
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects non-http(s) portalUrl (no javascript:/data: deeplink)', async () => {
    // `ftp://example.com` is a well-formed URL that would be accepted without
    // the protocols option of @IsUrl – the test therefore pins the actual
    // http(s) restriction (not an unrelated error).
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

  it('rejects non-string values in credentials', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'max', portalPassword: 123 },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors)).toContain('portalPassword must be a string');
  });

  it('rejects overlong credentials (MaxLength)', async () => {
    const errors = await errorsFor(CreatePortalAccountLinkDto, {
      providerKey: 'huk-coburg',
      credentials: { portalUsername: 'x'.repeat(257) },
    });
    expect(messages(errors)).toContain('portalUsername must be shorter than or equal to 256 characters');
  });

  it('Update: credentials: null is valid (delete semantics)', async () => {
    const errors = await errorsFor(UpdatePortalAccountLinkDto, { credentials: null });
    expect(errors).toHaveLength(0);
  });

  it('normalizes portalUrl: https:// prefix when schema is missing, http(s) unchanged', async () => {
    // BugFix-05 (finding 2): @PortalUrlTransform adds the schema before the
    // @IsUrl validation; the transformed value must arrive on the instance
    // (class-transformer runs before class-validator).
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

  it('rejects javascript:/data: inputs even after normalization', async () => {
    // BugFix-05 (finding 2): without a schema https:// is prepended, so
    // `javascript:…`/`data:…` can never slip through; with `://` they stay
    // unchanged and fail the protocols whitelist of @IsUrl.
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

  it('rejects an overlong portalUrl (MaxLength 2048)', async () => {
    // BugFix-05 (finding 2): explicit 2048-character limit on both DTOs.
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

  it('Update: rejects non-http(s) portalUrl but allows null (delete semantics)', async () => {
    // `ftp://example.com` is a well-formed URL that would be accepted without
    // the protocols option of @IsUrl – the test therefore pins the actual
    // http(s) restriction (not an unrelated error).
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

  it('Update: credentials omitted is valid (leave unchanged)', async () => {
    const errors = await errorsFor(UpdatePortalAccountLinkDto, { providerKey: 'allianz' });
    expect(errors).toHaveLength(0);
  });

  it('whitelist: unknown extra fields in credentials are rejected', async () => {
    // The global ValidationPipe (forbidNonWhitelisted) rejects arbitrary
    // foreign fields; the at-least-one rule remains enforced in the service.
    const errors = await errorsFor(
      CreatePortalAccountLinkDto,
      { providerKey: 'huk-coburg', credentials: { atLeastOneCredential: 'x' } },
      { whitelist: true },
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

// BugFix-07 (finding 1): insurerPortalUrl on CreatePolicyDto/UpdatePolicyDto
// goes through the same https:// normalization + http(s) validation as the
// portal link URLs. Previously the URL was stored unprocessed and a
// `www.portal.de` input produced a relative/invalid link in the web app.
describe('insurerPortalUrl (BugFix-07, finding 1)', () => {
  async function policyErrors(
    dtoClass: typeof CreatePolicyDto | typeof UpdatePolicyDto,
    raw: object,
  ): Promise<ValidationError[]> {
    return validate(plainToInstance(dtoClass, raw as object));
  }

  function basePolicy(): object {
    return {
      type: 'HAFTPFLICHT',
      insurerName: 'Muster-Versicherung',
      contractNumber: 'VN-123',
      startDate: '2024-01-01',
    };
  }

  it('adds https:// when the schema is missing (Create)', async () => {
    const dto = plainToInstance(CreatePolicyDto, {
      ...basePolicy(),
      insurerPortalUrl: 'www.portal.de/login',
    });
    expect(dto.insurerPortalUrl).toBe('https://www.portal.de/login');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('leaves http(s) unchanged (Create)', async () => {
    const dto = plainToInstance(CreatePolicyDto, {
      ...basePolicy(),
      insurerPortalUrl: 'http://portal.example.com',
    });
    expect(dto.insurerPortalUrl).toBe('http://portal.example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects javascript:/data: inputs even after normalization (Create)', async () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const errors = await policyErrors(CreatePolicyDto, { ...basePolicy(), insurerPortalUrl: raw });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects an overlong insurerPortalUrl (MaxLength 2048, Create + Update)', async () => {
    const create = await policyErrors(CreatePolicyDto, {
      ...basePolicy(),
      insurerPortalUrl: `https://portal.example.com/${'a'.repeat(2100)}`,
    });
    expect(create.some((e) => Object.values(e.constraints ?? {}).some((m) => m.includes('2048')))).toBe(true);

    const update = await policyErrors(UpdatePolicyDto, {
      insurerPortalUrl: `https://portal.example.com/${'a'.repeat(2100)}`,
    });
    expect(update.some((e) => Object.values(e.constraints ?? {}).some((m) => m.includes('2048')))).toBe(true);
  });

  it('Update: adds https:// and allows an empty update', async () => {
    const dto = plainToInstance(UpdatePolicyDto, { insurerPortalUrl: 'www.portal.de' });
    expect(dto.insurerPortalUrl).toBe('https://www.portal.de');
    expect(await validate(dto)).toHaveLength(0);

    const untouched = plainToInstance(UpdatePolicyDto, { insurerName: 'neu' });
    expect(await validate(untouched)).toHaveLength(0);
  });
});
