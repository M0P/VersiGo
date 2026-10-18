import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateCostEntryDto, UpdateCostEntryDto } from '../dto/cost-tracking.dto';

/**
 * A cost entry records exactly ONE amount (the former gross/net pair is
 * gone). The DTO makes it mandatory when creating; that an update may not
 * CLEAR it is enforced in the service (see cost-tracking.service.spec.ts),
 * because `@IsOptional()` also lets `null` through.
 */
async function errorsFor(
  dtoClass: new () => object,
  raw: unknown,
): Promise<ValidationError[]> {
  return validate(plainToInstance(dtoClass, raw as object));
}

describe('CreateCostEntryDto (single amount field)', () => {
  it('accepts an entry with an amount', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      amount: 1200,
      frequency: 'MONTHLY',
    });
    expect(errors).toHaveLength(0);
  });

  it('requires an amount', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      frequency: 'MONTHLY',
    });
    expect(errors.map((e) => e.property)).toContain('amount');
  });

  it('rejects a non-numeric amount', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      amount: 'viel',
      frequency: 'MONTHLY',
    });
    expect(errors.map((e) => e.property)).toContain('amount');
  });

  it('rejects a negative amount', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      amount: -5,
      frequency: 'MONTHLY',
    });
    expect(errors.map((e) => e.property)).toContain('amount');
  });

  it('still requires validFrom and frequency', async () => {
    const errors = await errorsFor(CreateCostEntryDto, { amount: 10 });
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('validFrom');
    expect(fields).toContain('frequency');
  });

  it('does not accept the former gross/net fields any more', async () => {
    const errors = await errorsFor(CreateCostEntryDto, {
      validFrom: '2025-01-01',
      grossAmount: 1200,
      netAmount: 1000,
      frequency: 'MONTHLY',
    });
    // The unknown properties are dropped by class-transformer; the missing
    // `amount` is what the validation reports.
    expect(errors.map((e) => e.property)).toContain('amount');
  });
});

describe('UpdateCostEntryDto (single amount field)', () => {
  it('accepts a partial update without an amount', async () => {
    const errors = await errorsFor(UpdateCostEntryDto, { note: 'Korrektur' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a negative amount', async () => {
    const errors = await errorsFor(UpdateCostEntryDto, { amount: -1 });
    expect(errors.map((e) => e.property)).toContain('amount');
  });
});
