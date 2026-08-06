import { IsString, IsOptional, IsDateString, IsNumber, Min, IsIn } from 'class-validator';
import { PaymentFrequency } from '@prisma/client';
import { Type } from 'class-transformer';

/**
 * BugFix-08 (Q4): Fuer NEUE Kosten-Eintraege zulaessige Frequenzen.
 * SEMI_ANNUAL bleibt als Legacy-Wert fuer Bestandsdaten im Enum erhalten
 * (verlustfreie Entscheidung, keine Migration) und wird weiterhin korrekt
 * berechnet, kann aber nicht mehr neu angelegt werden.
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

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  grossAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  netAmount?: number;

  @IsIn(COST_FREQUENCIES, { message: 'Frequenz muss MONTHLY, QUARTERLY oder ANNUAL sein' })
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
  @IsIn(COST_FREQUENCIES, { message: 'Frequenz muss MONTHLY, QUARTERLY oder ANNUAL sein' })
  frequency?: PaymentFrequency;

  @IsOptional()
  @IsString()
  bookingSource?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
