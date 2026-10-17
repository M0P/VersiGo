import { IsString, IsOptional, IsDateString, IsNumber, Min, IsIn } from 'class-validator';
import { PaymentFrequency } from '@prisma/client';
import { Type } from 'class-transformer';

/**
 * BugFix-08 (Q4): frequencies allowed for NEW cost entries.
 * SEMI_ANNUAL stays as a legacy value for existing data in the enum
 * (loss-free decision, no migration) and is still calculated correctly,
 * but can no longer be created.
 */
export const COST_FREQUENCIES: PaymentFrequency[] = [
  PaymentFrequency.MONTHLY,
  PaymentFrequency.QUARTERLY,
  PaymentFrequency.ANNUAL,
];

export class CreateCostEntryDto {
  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  /**
   * BugFix-22: gross and net are both optional – at least one of them must be
   * provided. The rule is enforced in the service (single source of truth,
   * because it also has to hold for partial updates, where the "at least one"
   * check needs the existing row).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  grossAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  netAmount?: number;

  @IsIn(COST_FREQUENCIES, { message: 'frequency must be MONTHLY, QUARTERLY or ANNUAL' })
  frequency!: PaymentFrequency;

  @IsOptional()
  @IsString()
  bookingSource?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateCostEntryDto {
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  grossAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  netAmount?: number;

  @IsOptional()
  @IsIn(COST_FREQUENCIES, { message: 'frequency must be MONTHLY, QUARTERLY or ANNUAL' })
  frequency?: PaymentFrequency;

  @IsOptional()
  @IsString()
  bookingSource?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
