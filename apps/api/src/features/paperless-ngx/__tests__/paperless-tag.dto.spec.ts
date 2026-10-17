import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreatePaperlessTagDto } from '../dto/paperless-tag.dto';

/**
 * AP-22 follow-up: a whitespace-only tag name is invalid input (HTTP 400) and
 * must never reach Paperless as an empty name – that path reported the
 * misleading 502 `PAPERLESS_TAG_CREATE_FAILED`.
 *
 * The transform mirrors the global ValidationPipe options
 * (`whitelist`/`forbidNonWhitelisted`/`transform`, see `apps/api/src/main.ts`).
 */
async function validateName(raw: unknown) {
  const dto = plainToInstance(CreatePaperlessTagDto, raw as object);
  return {
    dto,
    errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  };
}

describe('CreatePaperlessTagDto', () => {
  it('accepts a name and trims surrounding whitespace', async () => {
    const { dto, errors } = await validateName({ name: '  KFZ  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('KFZ');
  });

  it('rejects a whitespace-only name as a client error', async () => {
    const { dto, errors } = await validateName({ name: '   ' });

    expect(dto.name).toBe('');
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('name');
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('rejects a missing or non-string name', async () => {
    expect((await validateName({})).errors.length).toBeGreaterThan(0);
    expect((await validateName({ name: 42 })).errors.length).toBeGreaterThan(0);
  });
});
