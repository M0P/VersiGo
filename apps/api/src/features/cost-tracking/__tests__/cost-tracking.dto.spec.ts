import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateCostEntryDto, UpdateCostEntryDto } from '../dto/cost-tracking.dto';

/**
 * BugFix-22: the gross amount is no longer a mandatory field. The DTO accepts
 * an entry with only a net amount (and vice versa); the rule "at least one
 * amount" is enforced in the service (see cost-tracking.service.spec.ts).
 */
async function errorsFor(
  dtoClass: new () => object,
  raw: unknown,
): Promise<ValidationError[]> {
  return validate(plainToInstance(dtoClass, raw as object));
}

describe('CreateCostEntryDto (BugFix-22: gross OR net)', () => {
  it('accepts an entry with only a gross amount', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      grossAmount: 1200,
      frequency: 'MONTHLY',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an entry with only a net amount', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      netAmount: 1000,
      frequency: 'MONTHLY',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-numeric amount', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      grossAmount: 'viel',
      frequency: 'MONTHLY',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('still requires validFrom and frequency', async () => {
    const errors = await errorsFor(CreateCostEntryDto, { netAmount: 10 });
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('validFrom');
    expect(fields).toContain('frequency');
  });
});

describe('UpdateCostEntryDto (BugFix-22)', () => {
  it('accepts clearing the gross amount (net stays)', async () => {
    const errors = await errorsFor(UpdateCostEntryDto, { grossAmount: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts a partial update without amounts', async () => {
    const errors = await errorsFor(UpdateCostEntryDto, { note: 'Korrektur' });
    expect(errors).toHaveLength(0);
  });
});
