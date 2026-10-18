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
   * The amount the policyholder pays. Required – a cost entry without an
   * amount would contribute nothing to any sum. The rule is enforced in the
   * service as well, because a partial update must not be able to clear it.
   */
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount!: number;

  @IsIn(COST_FREQUENCIES, { message: 'frequency must be MONTHLY, QUARTERLY or ANNUAL' })
  frequency!: PaymentFrequency;

  @IsOptional()
  @IsString()
  bookingSource?: string;

  @IsOptional()
  @IsString()
  note?: string;

  /**
   * AP-24 (§4.2): billing document this entry was derived from.
   *
   * Optional – manually typed entries have no source. The service verifies
   * that the document belongs to the policy and is classified as BILLING.
   */
  @IsOptional()
  @IsString()
  sourceDocumentId?: string;
}

export class UpdateCostEntryDto {
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  /**
   * Optional so that a partial update can leave the amount untouched; it can
   * never be cleared (the service rejects a null amount).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount?: number;

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
